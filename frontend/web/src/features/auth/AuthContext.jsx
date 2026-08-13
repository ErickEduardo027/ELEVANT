import { createContext, useContext, useMemo, useState } from 'react';
import { logout as closeBackendSession, mockLogin, readSession } from './authService';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [session, setSession] = useState(() => readSession());
  const value = useMemo(() => ({
    session,
    async login(credentials) {
      const nextSession = await mockLogin(credentials);
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
