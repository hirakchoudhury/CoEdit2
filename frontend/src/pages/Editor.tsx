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
import type { DocumentDto } from '../api/documents';

export default function Editor() {
  const { documentId } = useParams<{ documentId: string }>();
  const navigate = useNavigate();
  const [docMeta, setDocMeta] = useState<DocumentDto | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [users, setUsers] = useState<Record<string, string>>({});
  const [cursors, setCursors] = useState<Record<string, PresenceCursor>>({});
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
        await uploadSnapshot(documentId, state);
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

      if (hadFocus) {
        // Assigning .value drops the caret at the end; put it back where the
        // user actually was, shifted by whatever the remote edit did.
        textarea.selectionStart = transformCaret(prev, next, selStart);
        textarea.selectionEnd = transformCaret(prev, next, selEnd);
      }
    };
    ytext.observe(render);
    render();

    // Apply textarea -> Yjs as the single splice that actually changed, so
    // concurrent edits at different positions merge instead of clobbering.
    const onInput = () => {
      const newText = textarea.value;
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

    return () => {
      ytext.unobserve(render);
      textarea.removeEventListener('input', onInput);
      textarea.removeEventListener('select', onSelect);
      textarea.removeEventListener('keyup', onSelect);
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
      <div style={{ padding: 24 }}>
        <p style={{ color: '#f87171' }}>{error}</p>
        <Link to="/">Back to documents</Link>
      </div>
    );
  }

  if (!docMeta) {
    return (
      <div style={{ padding: 24 }}>
        <p>Loading...</p>
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

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: 24 }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          <Link to="/" style={{ color: '#a1a1aa' }}>← Documents</Link>
          <h1 style={{ margin: 0, fontSize: 20 }}>{docMeta.title}</h1>
          {connected ? (
            <span style={{ fontSize: 12, color: '#4ade80' }}>● Synced</span>
          ) : (
            <span style={{ fontSize: 12, color: '#fbbf24' }}>○ Offline / connecting</span>
          )}
        </div>
        {userList.length > 0 && (
          <div style={{ fontSize: 14, color: '#a1a1aa' }}>
            Online:{' '}
            {userList
              .map(([id, email]) => {
                const c = cursors[id];
                return c ? `${email} (@${c.index})` : email;
              })
              .join(', ')}
          </div>
        )}
      </header>

      {isOwner && (
        <section style={{ marginBottom: 16, background: '#27272a', border: '1px solid #3f3f46', borderRadius: 8, padding: 12 }}>
          <h2 style={{ margin: '0 0 8px', fontSize: 16 }}>Share document</h2>
          <form onSubmit={handleShare} style={{ display: 'flex', gap: 8, marginBottom: 10 }}>
            <input
              type="email"
              placeholder="User email"
              value={shareEmail}
              onChange={(e) => setShareEmail(e.target.value)}
              style={{ flex: 1, padding: 10, borderRadius: 6, border: '1px solid #3f3f46', background: '#1f1f23', color: '#e4e4e7' }}
              required
            />
            <select
              value={sharePermission}
              onChange={(e) => setSharePermission(e.target.value as 'READ' | 'WRITE')}
              style={{ padding: 10, borderRadius: 6, border: '1px solid #3f3f46', background: '#1f1f23', color: '#e4e4e7' }}
            >
              <option value="WRITE">Editor</option>
              <option value="READ">Reader</option>
            </select>
            <button
              type="submit"
              disabled={sharing || !shareEmail.trim()}
              style={{ padding: '10px 14px', borderRadius: 6, border: 'none', background: '#7c9cff', color: '#fff' }}
            >
              {sharing ? 'Sharing...' : 'Share'}
            </button>
          </form>
          {shareError && <p style={{ margin: '4px 0 10px', color: '#f87171', fontSize: 14 }}>{shareError}</p>}
          {permissions.length > 0 && (
            <div style={{ display: 'grid', gap: 6 }}>
              {permissions.map((p) => (
                <div key={p.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 14 }}>
                  <span style={{ color: '#d4d4d8' }}>
                    {p.userEmail || p.userId} - {p.permission}
                  </span>
                  <button
                    type="button"
                    onClick={() => handleRevoke(p.userId)}
                    style={{ padding: '4px 10px', borderRadius: 6, border: '1px solid #3f3f46', background: 'transparent', color: '#e4e4e7' }}
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}
        </section>
      )}

      {!canWrite && (
        <p style={{ marginBottom: 10, color: '#fbbf24', fontSize: 14 }}>
          You have read-only access to this document.
        </p>
      )}

      <textarea
        ref={editorRef}
        placeholder="Start typing..."
        readOnly={!canWrite}
        style={{
          width: '100%',
          minHeight: 400,
          padding: 16,
          borderRadius: 8,
          border: '1px solid #3f3f46',
          background: '#27272a',
          color: '#e4e4e7',
          fontSize: 16,
          lineHeight: 1.5,
          resize: 'vertical',
          opacity: canWrite ? 1 : 0.75,
        }}
        spellCheck
      />
    </div>
  );
}
