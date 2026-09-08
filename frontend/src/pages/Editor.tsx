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
  renameDocument,
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
  const [titleDraft, setTitleDraft] = useState<string | null>(null);
  const [titleError, setTitleError] = useState<string | null>(null);
  const [stuck, setStuck] = useState(false);
  // userId -> timestamp of their last cursor movement, used to show who is
  // actively editing. Derived from presence we already receive.
  const [activity, setActivity] = useState<Record<string, number>>({});
  const [now, setNow] = useState(() => Date.now());
  const [connected, setConnected] = useState(false);
  const [permissions, setPermissions] = useState<PermissionDto[]>([]);
  const [shareEmail, setShareEmail] = useState('');
  const [sharePermission, setSharePermission] = useState<'READ' | 'WRITE'>('WRITE');
  const [shareError, setShareError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const ydocRef = useRef<Y.Doc | null>(null);
  const providerRef = useRef<WebSocketProvider | null>(null);
  const stickySentinelRef = useRef<HTMLDivElement>(null);
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
        if (cancelled) return;
        setUsers(u);
        setCursors((prev) => {
          const moved = Object.entries(c).filter(
            ([id, cur]) => !prev[id] || prev[id].index !== cur.index || prev[id].length !== cur.length,
          );
          if (moved.length > 0) {
            const stamp = Date.now();
            setActivity((a) => {
              const next = { ...a };
              for (const [id] of moved) next[id] = stamp;
              return next;
            });
          }
          return c;
        });
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

    // The textarea has no scrollbar of its own; it grows to fit. Reset to
    // auto first so the height can shrink when text is deleted.
    const autoGrow = () => {
      textarea.style.height = 'auto';
      textarea.style.height = `${textarea.scrollHeight}px`;
    };

    // Render Yjs -> textarea, preserving the caret across remote edits.
    const render = () => {
      const next = ytext.toString();
      const prev = textarea.value;
      if (prev === next) return; // local echo: textarea is already correct

      const hadFocus = document.activeElement === textarea;
      const selStart = textarea.selectionStart;
      const selEnd = textarea.selectionEnd;

      textarea.value = next;
      autoGrow();
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
    autoGrow();

    const onResize = () => autoGrow();
    window.addEventListener('resize', onResize);

    // Apply textarea -> Yjs as the single splice that actually changed, so
    // concurrent edits at different positions merge instead of clobbering.
    const onInput = () => {
      const newText = textarea.value;
      autoGrow();
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
      window.removeEventListener('resize', onResize);
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

  // A 1px sentinel sits directly above the sticky header. When it scrolls out
  // of view the header is stuck. IntersectionObserver is used rather than a
  // scroll listener: it does not fire on every frame, and it reports state
  // rather than requiring us to infer it from a scroll offset.
  useEffect(() => {
    const sentinel = stickySentinelRef.current;
    if (!sentinel || typeof IntersectionObserver === 'undefined') return;
    const observer = new IntersectionObserver(
      ([entry]) => setStuck(!entry.isIntersecting),
      { threshold: 1 },
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [docMeta]);

  useEffect(() => {
    // Presence only arrives when someone moves. Without a ticker a "typing"
    // badge would stay lit until their next keystroke.
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

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

  async function handleTitleSave() {
    const next = (titleDraft ?? '').trim();
    setTitleError(null);
    if (!documentId || !next || next === docMeta?.title) {
      setTitleDraft(null);
      return;
    }
    // Optimistic: the title is cosmetic, and reverting on failure is cheap.
    const previous = docMeta;
    setDocMeta((d) => (d ? { ...d, title: next } : d));
    setTitleDraft(null);
    try {
      const updated = await renameDocument(documentId, next);
      setDocMeta(updated);
    } catch (err) {
      setDocMeta(previous);
      setTitleError(err instanceof Error ? err.message : 'Could not rename');
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
  const readingMinutes = Math.max(1, Math.round(wordCount / 200));
  // Someone counts as "typing" if their cursor moved in the last 3 seconds.
  const isActive = (id: string) => now - (activity[id] ?? 0) < 3000;

  return (
    <div className="page">
      {/* Watched by the observer above; height 0 so it changes no layout. */}
      <div ref={stickySentinelRef} aria-hidden="true" style={{ height: 1, marginBottom: -1 }} />

      <header className="doc-header" data-stuck={stuck}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
          <Link to="/" className="btn btn-ghost btn-sm" aria-label="Back to documents">
            &larr;
          </Link>

          {titleDraft !== null ? (
            <input
              className="doc-title"
              value={titleDraft}
              autoFocus
              aria-label="Document title"
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={handleTitleSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  handleTitleSave();
                } else if (e.key === 'Escape') {
                  setTitleDraft(null);
                }
              }}
            />
          ) : (
            <button
              type="button"
              className="doc-title"
              title={canWrite ? 'Click to rename' : docMeta.title}
              disabled={!canWrite}
              onClick={() => canWrite && setTitleDraft(docMeta.title)}
            >
              {docMeta.title}
            </button>
          )}

          {!canWrite && <span className="badge">Read-only</span>}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {userList.length > 0 && (
            <span className="avatar-stack" title={userList.map(([, e]) => e).join(', ')}>
              {userList.slice(0, 4).map(([id, email]) => (
                <span key={id} className={isActive(id) ? 'avatar-active' : undefined} style={{ borderRadius: '50%' }}>
                  <Avatar userId={id} email={email} />
                </span>
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

      {titleError && (
        <p className="error-text" role="alert" style={{ margin: '0 0 10px' }}>
          {titleError}
        </p>
      )}

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

      {/* The sheet. .doc-measure caps the line length; the overlay anchors to
          it because it is the textarea's offset parent. */}
      <div className="doc-sheet">
        <div className="doc-measure editor-shell">
          <textarea
            ref={editorRef}
            className="doc-textarea"
            readOnly={!canWrite}
            aria-label="Document body"
            spellCheck
          />

          {/* Real guidance instead of a bare placeholder. Sits behind the
              textarea, which is transparent, and ignores pointer events so
              clicking it still focuses the text. */}
          {text.length === 0 && (
            <div className="doc-hint" aria-hidden="true">
              {canWrite
                ? 'Start writing. Everything you type syncs to everyone in this document as you go.'
                : 'This document is empty.'}
            </div>
          )}

          <RemoteCursors
            textareaRef={editorRef}
            text={text}
            cursors={cursors}
            users={users}
            selfId={currentUserId}
          />
        </div>
      </div>

      <div className="doc-status">
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
          {wordCount > 0 && <> &middot; {readingMinutes} min read</>}
        </span>
      </div>
    </div>
  );
}
