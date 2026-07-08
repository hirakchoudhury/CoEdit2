import { useState, useEffect } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

export default function Login() {
  const { user } = useAuth();
  const navigate = useNavigate();
  useEffect(() => {
    if (user) navigate('/', { replace: true });
  }, [user, navigate]);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const { login } = useAuth();

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError('');
    try {
      await login(email, password);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    }
  }

  return (
    <div style={{ maxWidth: 360, margin: '80px auto', padding: 24 }}>
      <h1 style={{ marginBottom: 24 }}>Log in</h1>
      <form onSubmit={handleSubmit}>
        {error && <p style={{ color: '#f87171', marginBottom: 12 }}>{error}</p>}
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Email</label>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #3f3f46' }}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <label style={{ display: 'block', marginBottom: 4 }}>Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            style={{ width: '100%', padding: 8, borderRadius: 6, border: '1px solid #3f3f46' }}
          />
        </div>
        <button
          type="submit"
          style={{
            width: '100%',
            padding: 10,
            background: '#7c9cff',
            color: '#fff',
            border: 'none',
            borderRadius: 6,
          }}
        >
          Log in
        </button>
      </form>
      <p style={{ marginTop: 16 }}>
        No account? <Link to="/register">Register</Link>
      </p>
    </div>
  );
}
