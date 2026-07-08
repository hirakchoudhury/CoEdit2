import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listDocuments, createDocument, type DocumentDto } from '../api/documents';

type FilterMode = 'all' | 'owned' | 'shared';

export default function Dashboard() {
  const { user, logout } = useAuth();
  const [searchParams, setSearchParams] = useSearchParams();
  const [docs, setDocs] = useState<DocumentDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [newTitle, setNewTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState<string | null>(searchParams.get('message'));
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<FilterMode>('all');
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    const loadDocuments = async () => {
      try {
        const list = await listDocuments();
        if (!cancelled) setDocs(list);
      } catch {
        // Ignore transient polling errors.
      } finally {
        if (!cancelled) setLoading(false);
      }
    };

    loadDocuments();
    const interval = setInterval(loadDocuments, 3000);

    const onFocus = () => {
      loadDocuments();
    };
    window.addEventListener('focus', onFocus);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, []);

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(() => {
      setNotice(null);
      const next = new URLSearchParams(searchParams);
      next.delete('message');
      setSearchParams(next, { replace: true });
    }, 4500);
    return () => clearTimeout(timeout);
  }, [notice, searchParams, setSearchParams]);

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    if (!newTitle.trim() || creating) return;
    setCreating(true);
    try {
      const doc = await createDocument(newTitle.trim());
      setDocs((prev) => [doc, ...prev]);
      setNewTitle('');
      navigate(`/documents/${doc.id}`);
    } catch {
      setCreating(false);
    }
    setCreating(false);
  }

  function formatRelativeDate(value: string): string {
    const date = new Date(value);
    const diffMs = Date.now() - date.getTime();
    const mins = Math.floor(diffMs / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins}m ago`;
    const hrs = Math.floor(mins / 60);
    if (hrs < 24) return `${hrs}h ago`;
    const days = Math.floor(hrs / 24);
    if (days < 7) return `${days}d ago`;
    return date.toLocaleDateString();
  }

  const filteredDocs = docs.filter((doc) => {
    const matchesQuery = doc.title.toLowerCase().includes(query.trim().toLowerCase());
    if (!matchesQuery) return false;
    if (!user?.userId || filter === 'all') return true;
    if (filter === 'owned') return doc.ownerId === user.userId;
    return doc.ownerId !== user.userId;
  });

  return (
    <div className="page">
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 24, flexWrap: 'wrap' }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 28 }}>Documents</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Create, open, and collaborate in real time.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
          <span className="muted">{user?.email}</span>
          <button
            onClick={() => {
              logout();
              navigate('/login', { replace: true });
            }}
            className="btn btn-ghost"
          >
            Log out
          </button>
        </div>
      </header>

      {notice && (
        <div className="panel" style={{ marginBottom: 16, padding: '10px 12px', color: 'var(--warn)' }}>
          {notice}
        </div>
      )}

      <section className="panel" style={{ marginBottom: 20, padding: 14 }}>
        <form onSubmit={handleCreate} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <input
            type="text"
            placeholder="New document title"
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            className="field"
            style={{ flex: 1, minWidth: 220 }}
          />
          <button
            type="submit"
            disabled={creating || !newTitle.trim()}
            className="btn btn-primary"
          >
            {creating ? 'Creating...' : 'Create'}
          </button>
        </form>
      </section>

      <section className="panel" style={{ marginBottom: 16, padding: 14, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          type="search"
          placeholder="Search documents..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="field"
          style={{ flex: 1, minWidth: 220 }}
        />
        <button type="button" className={`btn ${filter === 'all' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('all')}>All</button>
        <button type="button" className={`btn ${filter === 'owned' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('owned')}>Owned</button>
        <button type="button" className={`btn ${filter === 'shared' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setFilter('shared')}>Shared</button>
      </section>

      {loading ? (
        <p className="muted">Loading documents...</p>
      ) : filteredDocs.length === 0 ? (
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px' }}>No documents found</h3>
          <p className="muted" style={{ margin: 0 }}>
            {docs.length === 0 ? 'Create your first document to start collaborating.' : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filteredDocs.map((doc) => {
            const owned = user?.userId ? doc.ownerId === user.userId : false;
            return (
            <li
              key={doc.id}
              className="panel"
              style={{ padding: 14, marginBottom: 10, background: 'var(--card)' }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center' }}>
                <div>
                  <Link to={`/documents/${doc.id}`} style={{ color: 'inherit', fontWeight: 600, fontSize: 17 }}>
                    {doc.title}
                  </Link>
                  <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <span className={`badge ${owned ? 'badge-owned' : 'badge-shared'}`}>
                      {owned ? 'Owned' : 'Shared'}
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      Updated {formatRelativeDate(doc.updatedAt)}
                    </span>
                  </div>
                </div>
                <Link to={`/documents/${doc.id}`} className="btn btn-ghost" style={{ whiteSpace: 'nowrap' }}>
                  Open
                </Link>
              </div>
            </li>
          );
          })}
        </ul>
      )}
    </div>
  );
}
