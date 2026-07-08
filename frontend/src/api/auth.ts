import { api, setToken, setStoredUser } from './client';

export interface AuthResponse {
  token: string;
  email: string;
  userId: string;
}

export async function register(email: string, password: string): Promise<AuthResponse> {
  const res = await api<AuthResponse>('/api/auth/register', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(res.token);
  setStoredUser(res.email, res.userId);
  return res;
}

export async function login(email: string, password: string): Promise<AuthResponse> {
  const res = await api<AuthResponse>('/api/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setToken(res.token);
  setStoredUser(res.email, res.userId);
  return res;
}
