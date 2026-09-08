import { useEffect, useRef, useState } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import * as Y from 'yjs';
import {
  getDocument,
  getSnapshot,
  grantPermissionByEmail,
  listPermissions,
  revokePermission,
  uploadSnapshot,
  type PermissionDto,
} from '../api/documents';
import { WebSocketProvider, type PresenceCursor } from '../sync/WebSocketProvider';
import { diffSplice, transformCaret } from '../sync/textDiff';
import RemoteCursors from '../components/RemoteCursors';
import Avatar from '../components/Avatar';
import ThemeToggle from '../components/ThemeToggle';
import type { DocumentDto } from '../api/documents';

export default function Editor() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [docMeta, setDocMeta] = useState<DocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [cursors, setCursors] = useState<Record<string, PresenceCursor>>({});
  // Mirrors the textarea value so the cursor overlay can re-measure.
  const [text, setText] = useState('');
  const [shareOpen, setShareOpen] = useState(false);
  // Snapshot uploads are the only durable save; surface them rather than
  // leaving the user guessing whether their work is persisted.
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [connected, setConnected] = useState(false);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<'READ' | 'WRITE'>('WRITE');
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);
  const currentUserId = localStorage.getItem('userId');
  const isOwner = !!(docMeta && currentUserId && docMeta.ownerId === currentUserId);
  const canWrite = !!(isOwner || permissions.some((p) => p.userId === currentUserId && p.permission === 'WRITE'));

  useEffect(() => {
    if (!documentId) return;
    const token = localStorage.getItem('token');
    if (!token) {
      navigate('/login');
      return;
    }

    let cancelled = false;
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    Promise.all([getDocument(documentId), getSnapshot(documentId), listPermissions(documentId)])
      .then(([meta, snapshot, perms]) => {
        if (cancelled) return;
        setDocMeta(meta);
        setPermissions(perms);
        if (snapshot.crdtState) {
          const raw = snapshot.crdtState;
          const state =
            typeof raw === 'string'
              ? Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))
              : new Uint8Array(raw);
          if (state.length > 0) Y.applyUpdate(ydoc, state);
        }
      })
      .catch((err) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load');
      });

    const provider = new WebSocketProvider({
      documentId,
      token,
      userId: currentUserId,
      ydoc,
      onSnapshotUpload: async (state) => {
        if (!cancelled) setSaveState('saving');
        try {
          await uploadSnapshot(documentId, state);
          if (!cancelled) setSaveState('saved');
        } catch (err) {
          if (!cancelled) setSaveState('idle');
          throw err;
        }
      },
      onPresence: (u, c) => {
        if (!cancelled) {
          setUsers(u);
          setCursors(c);
        }
      },
      onSync: (c) => {
        if (!cancelled) setConnected(c);
      },
    });
    providerRef.current = provider;

    return () => {
      cancelled = true;
      provider.destroy();
      providerRef.current = null;
      ydocRef.current = null;
    };
  }, [documentId, navigate, currentUserId]);

  useEffect(() => {
    const ydoc = ydocRef.current;
    const textarea = editorRef.current;
    if (!ydoc || !textarea) return;

    const ytext = ydoc.getText('content');

    // Render Yjs -> textarea, preserving the caret across remote edits.
    const render = () => {
      const next = ytext.toString();
      const prev = textarea.value;
      if (prev === next) return; // local echo: textarea is already correct

      const hadFocus = document.activeElement === textarea;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;

      textarea.value = next;
      setText(next);

      // A remote caret is an index into the old text. When the document
      // changes underneath it, shift it by the same edit or it drifts.
      setCursors((prevCursors) => {
        const entries = Object.entries(prevCursors);
        if (entries.length === 0) return prevCursors;
        let changed = false;
        const moved: Record<string, PresenceCursor> = {};
        for (const [uid, c] of entries) {
          const i = transformCaret(prev, next, c.index);
          const e = transformCaret(prev, next, c.index + c.length);
          if (i !== c.index || e - i !== c.length) changed = true;
          moved[uid] = { index: i, length: Math.max(0, e - i) };
        }
        return changed ? moved : prevCursors;
      });

      if (hadFocus) {
        // Assigning .value drops the caret at the end; put it back where the
        // user actually was, shifted by whatever the remote edit did.
        textarea.selectionStart = transformCaret(prev, next, selStart);
        textarea.selectionEnd = transformCaret(prev, next, selEnd);
      }
    };
    ytext.observe(render);
    render();
    setText(ytext.toString());

    // Apply textarea -> Yjs as the single splice that actually changed, so
    // concurrent edits at different positions merge instead of clobbering.
    const onInput = () => {
      const newText = textarea.value;
      setText(newText);
      const splice = diffSplice(ytext.toString(), newText);
      if (splice) {
        const { start, endPrev, endNext } = splice;
        ydoc.transact(() => {
          if (endPrev > start) ytext.delete(start, endPrev - start);
          if (endNext > start) ytext.insert(start, newText.slice(start, endNext));
        });
      }
      providerRef.current?.sendCursor(textarea.selectionStart, textarea.selectionEnd - textarea.selectionStart);
    };

    const onSelect = () => {
      const pos = textarea.selectionStart;
      providerRef.current?.sendCursor(pos, textarea.selectionEnd - pos);
    };

    textarea.addEventListener('input', onInput);
    textarea.addEventListener('select', onSelect);
    textarea.addEventListener('keyup', onSelect);
    textarea.addEventListener('mouseup', onSelect);
    textarea.addEventListener('focus', onSelect);

    return () => {
      ytext.unobserve(render);
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('select', onSelect);
      textarea.removeEventListener('keyup', onSelect);
      textarea.removeEventListener('mouseup', onSelect);
      textarea.removeEventListener('focus', onSelect);
    };
  }, [docMeta]);

  useEffect(() => {
    if (!documentId) return;
    let cancelled = false;

    const verifyAccess = async () => {
      try {
        await getDocument(documentId);
        const perms = await listPermissions(documentId);
        if (!cancelled) {
          setPermissions(perms);
        }
      } catch (err) {
        if (cancelled) return;
        const message = err instanceof Error ? err.message.toLowerCase() : '';
        if (message.includes('access denied') || message.includes('document not found')) {
          providerRef.current?.destroy();
          providerRef.current = null;
          navigate('/?message=You have been removed from this document', { replace: true });
        }
      }
    };

    const interval = setInterval(verifyAccess, 3000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [documentId, navigate]);

  if (error) {
    return (
      <div className="page-narrow">
        <div className="panel" style={{ padding: 24, textAlign: 'center' }}>
          <p className="error-text" style={{ marginTop: 0 }}>{error}</p>
          <Link to="/" className="btn btn-ghost" style={{ marginTop: 8 }}>
            Back to documents
          </Link>
        </div>
      </div>
    );
  }

  if (!docMeta) {
    return (
      <div className="page">
        <div className="skeleton" style={{ height: 28, width: 220, marginBottom: 16 }} />
        <div className="skeleton" style={{ height: 420 }} />
      </div>
    );
  }

  const userList = Object.entries(users).filter(([id]) => id !== localStorage.getItem('userId'));

  async function handleShare(e: React.FormEvent) {
    e.preventDefault();
    if (!documentId || !shareEmail.trim() || sharing) return;
    setSharing(true);
    setShareError(null);
    try {
      const permission = await grantPermissionByEmail(documentId, shareEmail.trim(), sharePermission);
      setPermissions((prev) => {
        const filtered = prev.filter((p) => p.userId !== permission.userId);
        return [...filtered, permission];
      });
      setShareEmail('');
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to share document');
    } finally {
      setSharing(false);
    }
  }

  async function handleRevoke(targetUserId: string) {
    if (!documentId) return;
    try {
      await revokePermission(documentId, targetUserId);
      setPermissions((prev) => prev.filter((p) => p.userId !== targetUserId));
    } catch (err) {
      setShareError(err instanceof Error ? err.message : 'Failed to revoke access');
    }
  }

  const wordCount = text.trim() ? text.trim().split(/\s+/).length : 0;

  return (
    <div className="page">
      <header
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          gap: 12,
          marginBottom: 18,
          flexWrap: 'wrap',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
          <Link to="/" className="btn btn-ghost btn-sm" aria-label="Back to documents">
            &larr; Documents
          </Link>
          <h1
            style={{
              margin: 0,
              fontSize: 20,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={docMeta.title}
          >
            {docMeta.title}
          </h1>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {/* Everyone else currently in the document. The avatar colour is the
              same hash the cursor overlay uses, so the circle here matches the
              caret in the text. */}
          {userList.length > 0 && (
            <span className="avatar-stack" title={userList.map(([, e]) => e).join(', ')}>
              {userList.slice(0, 4).map(([id, email]) => (
                <Avatar key={id} userId={id} email={email} />
              ))}
              {userList.length > 4 && (
                <span className="badge" style={{ marginLeft: 6 }}>+{userList.length - 4}</span>
              )}
            </span>
          )}

          {isOwner && (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              aria-expanded={shareOpen}
              onClick={() => setShareOpen((v) => !v)}
            >
              Share
            </button>
          )}
          <ThemeToggle />
        </div>
      </header>

      {isOwner && shareOpen && (
        <section className="panel" style={{ marginBottom: 16, padding: 16 }}>
          <h2 style={{ margin: '0 0 12px', fontSize: 15, fontWeight: 600 }}>Share document</h2>

          <form
            onSubmit={handleShare}
            className="stack-mobile"
            style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}
          >
            <input
              type="email"
              className="field"
              placeholder="Email address"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              style={{ flex: 1, minWidth: 200 }}
              required
            />
            <select
              className="field"
              value={sharePermission}
              onChange={(e) => setSharePermission(e.target.value as 'READ' | 'WRITE')}
              style={{ width: 'auto' }}
              aria-label="Permission level"
            >
              <option value="WRITE">Editor</option>
              <option value="READ">Reader</option>
            </select>
            <button type="submit" className="btn btn-primary" disabled={sharing || !shareEmail.trim()}>
              {sharing ? 'Sharing...' : 'Share'}
            </button>
          </form>

          {shareError && (
            <p className="error-text" role="alert" style={{ margin: '0 0 12px' }}>
              {shareError}
            </p>
          )}

          {permissions.length > 0 && (
            <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'grid', gap: 8 }}>
              {permissions.map((perm) => (
                <li
                  key={perm.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    fontSize: 14,
                  }}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                    <Avatar userId={perm.userId} email={perm.userEmail || perm.userId} size={24} />
                    <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>
                      {perm.userEmail || perm.userId}
                    </span>
                    <span className="badge">{perm.permission}</span>
                  </span>
                  <button type="button" className="btn btn-danger btn-sm" onClick={() => handleRevoke(perm.userId)}>
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      {!canWrite && (
        <p className="badge" style={{ marginBottom: 10, color: 'var(--warn)', borderColor: 'var(--warn)' }}>
          Read-only access
        </p>
      )}

      <div className="editor-toolbar">
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' }}>
          <span className={connected ? 'status-ok' : 'status-wait'}>
            {connected ? '\u25CF Synced' : '\u25CB Connecting'}
          </span>
          <span>
            {saveState === 'saving'
              ? 'Saving...'
              : saveState === 'saved'
                ? 'All changes saved'
                : 'Changes sync live'}
          </span>
        </span>
        <span>
          {wordCount} {wordCount === 1 ? 'word' : 'words'} &middot; {text.length} characters
        </span>
      </div>

      {/* position: relative anchors the cursor overlay to the textarea box. */}
      <div className="editor-shell">
        <textarea
          ref={editorRef}
          className="editor-area"
          placeholder="Start typing..."
          readOnly={!canWrite}
          spellCheck
        />
        <RemoteCursors
          textareaRef={editorRef}
          text={text}
          cursors={cursors}
          users={users}
          selfId={currentUserId}
        />
      </div>
    </div>
  );
}
