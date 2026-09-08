import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/ThemeToggle';

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const { login } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page-narrow">
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 8 }}>
        <ThemeToggle />
      </div>

      <div style={{ textAlign: 'center', marginBottom: 26 }}>
        <span className="brand brand-lg">
          <span className="brand-mark">Co</span>Edit
        </span>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 14 }}>
          Real-time collaborative editing
        </p>
      </div>

      <div className="panel" style={{ padding: 24 }}>
        <h1 style={{ margin: '0 0 18px', fontSize: 19, fontWeight: 600 }}>Log in</h1>

        <form onSubmit={handleSubmit}>
          {error && (
            <p className="error-text" role="alert" style={{ margin: '0 0 14px' }}>
              {error}
            </p>
          )}

          <div style={{ marginBottom: 14 }}>
            <label className="label" htmlFor="email">
              Email
            </label>
            <input
              id="email"
              className="field"
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
          </div>

          <div style={{ marginBottom: 20 }}>
            <label className="label" htmlFor="password">
              Password
            </label>
            <input
              id="password"
              className="field"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          </div>

          <button type="submit" className="btn btn-primary" style={{ width: '100%' }} disabled={busy}>
            {busy ? 'Signing in...' : 'Log in'}
          </button>
        </form>
      </div>

      <p className="muted" style={{ marginTop: 16, textAlign: 'center', fontSize: 14 }}>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
