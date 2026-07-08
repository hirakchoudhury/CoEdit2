import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { clearToken, getStoredUser, getToken } from '../api/client';
import * as authApi from '../api/auth';

interface User {
  email: string;
  userId: string;
}

interface AuthContextValue {
  user: User | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const stored = getStoredUser();
    if (getToken() && stored) {
      setUser(stored);
    }
    setLoading(false);
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const res = await authApi.login(email, password);
    setUser({ email: res.email, userId: res.userId });
  }, []);

  const register = useCallback(async (email: string, password: string) => {
    const res = await authApi.register(email, password);
    setUser({ email: res.email, userId: res.userId });
  }, []);

  const logout = useCallback(() => {
    clearToken();
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userId');
    setUser(null);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, register, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
