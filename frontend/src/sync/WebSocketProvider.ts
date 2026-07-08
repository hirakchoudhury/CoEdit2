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
  ydoc: Y.Doc;
  onSnapshotUpload: (state: Uint8Array) => Promise<void>;
  onPresence?: (users: Record<string, string>, cursors: Record<string, PresenceCursor>) => void;
  onSync?: (connected: boolean) => void;
}

/**
 * Custom Yjs sync over WebSocket: send binary Yjs updates, receive and apply.
 * Presence via text messages (join/leave/cursor). Snapshot upload every N updates or T seconds.
 */
export class WebSocketProvider {
  private ws: WebSocket | null = null;
  private options: WebSocketProviderOptions;
  private updateCount = 0;
  private snapshotTimer: ReturnType<typeof setInterval> | null = null;

  constructor(options: WebSocketProviderOptions) {
    this.options = options;
    const { ydoc, documentId, token, onSync } = options;
    const url = `${WS_BASE}/ws?token=${encodeURIComponent(token)}&documentId=${encodeURIComponent(documentId)}`;
    this.ws = new WebSocket(url);
    this.ws.binaryType = 'arraybuffer';

    this.ws.onopen = () => {
      onSync?.(true);
      this.scheduleSnapshot();
    };

    this.ws.onclose = () => {
      onSync?.(false);
      this.clearSnapshotTimer();
    };

    this.ws.onmessage = (event: MessageEvent) => {
      if (event.data instanceof ArrayBuffer) {
        const update = new Uint8Array(event.data);
        Y.applyUpdate(ydoc, update);
        this.updateCount++;
        if (this.updateCount % SNAPSHOT_UPDATES_THRESHOLD === 0) {
          this.uploadSnapshot();
        }
      } else if (typeof event.data === 'string') {
        try {
          const msg = JSON.parse(event.data);
          if (msg.type === 'presence_snapshot' && this.options.onPresence) {
            const users: Record<string, string> = msg.users || {};
            const cursors: Record<string, PresenceCursor> = {};
            for (const [uid, c] of Object.entries(msg.cursors || {})) {
              const o = c as { index?: number; length?: number };
              cursors[uid] = { index: o.index ?? 0, length: o.length ?? 0 };
            }
            this.options.onPresence(users, cursors);
          } else if ((msg.type === 'JOIN' || msg.type === 'LEAVE' || msg.type === 'CURSOR') && this.options.onPresence) {
            // Server sends PresenceMessage; we could refetch snapshot or merge incrementally. For simplicity re-request not implemented; presence_snapshot on join is enough.
          }
        } catch {
          // ignore
        }
      }
    };

    ydoc.on('update', (update: Uint8Array) => {
      if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
      this.ws.send(update);
      this.updateCount++;
      if (this.updateCount % SNAPSHOT_UPDATES_THRESHOLD === 0) {
        this.uploadSnapshot();
      }
    });
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
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }
}
