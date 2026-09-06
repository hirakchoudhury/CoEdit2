import * as Y from 'yjs';

const WS_BASE = (() => {
  if (typeof window === 'undefined') return '';
  const p = window.location;
  return (p.protocol === 'https:' ? 'wss:' : 'ws:') + '//' + p.host;
})();

const SNAPSHOT_UPDATES_THRESHOLD = 50;
const SNAPSHOT_INTERVAL_MS = 60_000;

export type PresenceUser = { userId: string; email: string };
export type PresenceCursor = { index: number; length: number };

export interface WebSocketProviderOptions {
  documentId: string;
  token: string;
  /** Our own user id, so we can ignore our own JOIN echo. */
  userId?: string | null;
  ydoc: Y.Doc;
  onSnapshotUpload: (state: Uint8Array) => Promise<void>;
  onPresence?: (users: Record<string, string>, cursors: Record<string, PresenceCursor>) => void;
  onSync?: (connected: boolean) => void;
}

/**
 * Custom Yjs sync over WebSocket: send binary Yjs updates, receive and apply.
 * Presence via text messages (join/leave/cursor). Snapshot upload every N updates or T seconds.
 *
 * Remote updates are applied with `this` as the transaction origin so the local
 * `update` handler can tell them apart from genuine local edits and not echo
 * them straight back to the server.
 */
export class WebSocketProvider {
  private ws: WebSocket | null = null;
  private options: WebSocketProviderOptions;
  private updateCount = 0;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;
  private users: Record<string, string> = {};
  private cursors: Record<string, PresenceCursor> = {};
  private readonly updateHandler: (update: Uint8Array, origin: unknown) => void;

  constructor(options: WebSocketProviderOptions) {
    this.options = options;
    const { ydoc, documentId, token, onSync } = options;
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&documentId=${encodeURIComponent(documentId)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      onSync?.(true);
      this.scheduleSnapshot();
      // Offer whatever we already have so peers can merge it.
      this.sendFullState();
    };

    this.ws.onclose = () => {
      onSync?.(false);
      this.clearSnapshotTimer();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const update = new Uint8Array(event.data);
        if (update.length === 0) return;
        // Origin `this` marks the change as remote -> updateHandler skips it.
        Y.applyUpdate(ydoc, update, this);
        this.updateCount++;
        if (this.updateCount % SNAPSHOT_UPDATES_THRESHOLD === 0) {
          this.uploadSnapshot();
        }
      } else if (typeof event.data === 'string') {
        this.handlePresenceMessage(event.data);
      }
    };

    this.updateHandler = (update: Uint8Array, origin: unknown) => {
      // Updates we just applied from the network must not be sent back out.
      if (origin === this) return;
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(update);
      this.updateCount++;
      if (this.updateCount % SNAPSHOT_UPDATES_THRESHOLD === 0) {
        this.uploadSnapshot();
      }
    };
    ydoc.on('update', this.updateHandler);
  }

  private handlePresenceMessage(raw: string) {
    let msg: any;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }
    if (!msg || typeof msg !== 'object') return;

    if (msg.type === 'presence_snapshot') {
      this.users = { ...(msg.users || {}) };
      this.cursors = {};
      for (const [uid, c] of Object.entries(msg.cursors || {})) {
        const o = c as { index?: number; length?: number };
        this.cursors[uid] = { index: o.index ?? 0, length: o.length ?? 0 };
      }
      this.emitPresence();
      return;
    }

    const uid = msg.userId != null ? String(msg.userId) : null;
    if (!uid) return;

    if (msg.type === 'JOIN') {
      this.users[uid] = msg.userEmail ?? '';
      this.emitPresence();
      // A peer that just joined has no idea what we have. The server relays
      // binary frames blindly, so pushing our state reaches them directly.
      if (uid !== this.options.userId) this.sendFullState();
    } else if (msg.type === 'LEAVE') {
      delete this.users[uid];
      delete this.cursors[uid];
      this.emitPresence();
    } else if (msg.type === 'CURSOR') {
      if (msg.userEmail) this.users[uid] = msg.userEmail;
      this.cursors[uid] = {
        index: msg.cursor?.index ?? 0,
        length: msg.cursor?.length ?? 0,
      };
      this.emitPresence();
    }
  }

  private emitPresence() {
    this.options.onPresence?.({ ...this.users }, { ...this.cursors });
  }

  private sendFullState() {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    const state = Y.encodeStateAsUpdate(this.options.ydoc);
    if (state.length === 0) return;
    this.ws.send(state);
  }

  private scheduleSnapshot() {
    this.clearSnapshotTimer();
    this.snapshotTimer = setInterval(() => this.uploadSnapshot(), SNAPSHOT_INTERVAL_MS);
  }

  private clearSnapshotTimer() {
    if (this.snapshotTimer) {
      clearInterval(this.snapshotTimer);
      this.snapshotTimer = null;
    }
  }

  private uploadSnapshot() {
    const state = Y.encodeStateAsUpdate(this.options.ydoc);
    if (state.length === 0) return;
    this.options.onSnapshotUpload(state).catch(() => {});
  }

  sendCursor(index: number, length: number) {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(JSON.stringify({ type: 'cursor', index, length }));
  }

  destroy() {
    this.clearSnapshotTimer();
    this.options.ydoc.off('update', this.updateHandler);
    if (this.ws) {
      this.ws.onmessage = null;
      this.ws.onopen = null;
      this.ws.onclose = null;
      this.ws.close();
      this.ws = null;
    }
  }
}
