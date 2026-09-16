import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { AUTH_EXPIRED_EVENT, login as createSession, logout as closeBackendSession, readSession } from './authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  useEffect(() => {
    const expireSession = () => setSession(null);
    window.addEventListener(AUTH_EXPIRED_EVENT, expireSession);
    return () => window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession);
  }, []);
  const value = useMemo(() => ({
    session,
    async login(credentials) {
      const nextSession = await createSession(credentials);
      setSession(nextSession);
      return nextSession;
    },
    logout() {
      closeBackendSession();
      setSession(null);
    },
  }), [session]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
