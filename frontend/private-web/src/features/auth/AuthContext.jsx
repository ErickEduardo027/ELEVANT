import { createContext, useCallback, useContext, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AUTH_EXPIRED_EVENT, changePassword as changeBackendPassword, login as createSession, logout as closeBackendSession, readSession } from './authService';

const AuthContext = createContext(null);
const sessionListeners = new Set();
let currentSession = null;
let sessionLoaded = false;

function getSessionSnapshot() {
  if (typeof window === 'undefined') return null;
  if (!sessionLoaded) {
    currentSession = readSession();
    sessionLoaded = true;
  }
  return currentSession;
}

function getServerSessionSnapshot() {
  return null;
}

function publishSession(session) {
  currentSession = session;
  sessionLoaded = true;
  sessionListeners.forEach(listener => listener());
}

function subscribeToSession(listener) {
  sessionListeners.add(listener);
  const syncSession = () => publishSession(readSession());
  const expireSession = () => publishSession(null);
  window.addEventListener('storage', syncSession);
  window.addEventListener(AUTH_EXPIRED_EVENT, expireSession);
  return () => {
    sessionListeners.delete(listener);
    window.removeEventListener('storage', syncSession);
    window.removeEventListener(AUTH_EXPIRED_EVENT, expireSession);
  };
}

export function AuthProvider({ children }) {
  const session = useSyncExternalStore(subscribeToSession, getSessionSnapshot, getServerSessionSnapshot);
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  const login = useCallback(async credentials => {
    const nextSession = await createSession(credentials);
    publishSession(nextSession);
    return nextSession;
  }, []);
  const logout = useCallback(() => {
    closeBackendSession();
    publishSession(null);
  }, []);
  const updatePassword = useCallback(credentials => changeBackendPassword(credentials), []);
  const value = useMemo(() => ({
    session,
    ready,
    login,
    changePassword: updatePassword,
    logout,
  }), [login, logout, ready, session, updatePassword]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
