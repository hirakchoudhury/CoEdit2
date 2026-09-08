import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { listDocuments, createDocument, type DocumentDto } from '../api/documents';
import ThemeToggle from '../components/ThemeToggle';
import Avatar from '../components/Avatar';

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
          <span className="brand" style={{ display: 'flex', marginBottom: 2 }}>
            <span className="brand-mark">Co</span>Edit
          </span>
          <h1 style={{ margin: 0, fontSize: 24 }}>Documents</h1>
          <p className="muted" style={{ margin: '6px 0 0' }}>
            Create, open, and collaborate in real time.
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {user?.userId && user?.email && (
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <Avatar userId={user.userId} email={user.email} />
              <span className="muted" style={{ fontSize: 14 }}>{user.email}</span>
            </span>
          )}
          <ThemeToggle />
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
        <button type="button" className="btn btn-ghost" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>All</button>
        <button type="button" className="btn btn-ghost" aria-pressed={filter === 'owned'} onClick={() => setFilter('owned')}>Owned</button>
        <button type="button" className="btn btn-ghost" aria-pressed={filter === 'shared'} onClick={() => setFilter('shared')}>Shared</button>
      </section>

      {loading ? (
        <div className="doc-grid" aria-busy="true" aria-label="Loading documents">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="skeleton" style={{ height: 104 }} />
          ))}
        </div>
      ) : filteredDocs.length === 0 ? (
        <div className="panel" style={{ padding: 20 }}>
          <h3 style={{ margin: '0 0 6px' }}>No documents found</h3>
          <p className="muted" style={{ margin: 0 }}>
            {docs.length === 0 ? 'Create your first document to start collaborating.' : 'Try a different search or filter.'}
          </p>
        </div>
      ) : (
        <ul className="doc-grid" style={{ listStyle: 'none', padding: 0, margin: 0 }}>
          {filteredDocs.map((doc) => {
            const owned = user?.userId ? doc.ownerId === user.userId : false;
            return (
              <li key={doc.id}>
                {/* The whole card is the link, so the hit target matches what
                    the hover state suggests. */}
                <Link to={`/documents/${doc.id}`} className="doc-card">
                  <h3 title={doc.title}>{doc.title}</h3>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <span className={`badge ${owned ? 'badge-owned' : 'badge-shared'}`}>
                      {owned ? 'Owned' : 'Shared'}
                    </span>
                    <span className="muted" style={{ fontSize: 13 }}>
                      Updated {formatRelativeDate(doc.updatedAt)}
                    </span>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
