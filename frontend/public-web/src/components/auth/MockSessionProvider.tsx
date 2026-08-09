"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  MOCK_PERSISTENT_SESSION_KEY,
  MOCK_TRANSIENT_SESSION_KEY,
  MockAuthGateway,
  type MockAirlineSession,
  type MockRegistrationResult,
  type MockSignInResult,
  type MockRegistrationInput,
  type MockSignInInput,
} from "@/lib/mock-auth";

export type MockSessionStatus = "loading" | "anonymous" | "authenticated";

export interface MockSessionContextValue {
  status: MockSessionStatus;
  session: MockAirlineSession | null;
  signIn: (input: MockSignInInput) => Promise<MockSignInResult>;
  register: (input: MockRegistrationInput) => Promise<MockRegistrationResult>;
  signOut: () => void;
}

export interface MockSessionProviderProps {
  children: ReactNode;
  gateway?: MockAuthGateway;
}

const MockSessionContext = createContext<MockSessionContextValue | null>(null);

export function MockSessionProvider({
  children,
  gateway: providedGateway,
}: MockSessionProviderProps) {
  const gateway = useMemo(
    () => providedGateway ?? new MockAuthGateway(),
    [providedGateway],
  );
  const [session, setSession] = useState<MockAirlineSession | null>(null);
  const [status, setStatus] = useState<MockSessionStatus>("loading");

  const hydrateSession = useCallback(() => {
    const restoredSession = gateway.getSession();
    setSession(restoredSession);
    setStatus(restoredSession ? "authenticated" : "anonymous");
  }, [gateway]);

  useEffect(() => {
    const hydrationTask = window.setTimeout(hydrateSession, 0);
    return () => window.clearTimeout(hydrationTask);
  }, [hydrateSession]);

  useEffect(() => {
    const syncAcrossTabs = (event: StorageEvent) => {
      if (
        event.key === MOCK_PERSISTENT_SESSION_KEY ||
        event.key === MOCK_TRANSIENT_SESSION_KEY ||
        event.key === null
      ) {
        hydrateSession();
      }
    };
    window.addEventListener("storage", syncAcrossTabs);
    return () => window.removeEventListener("storage", syncAcrossTabs);
  }, [hydrateSession]);

  const signIn = useCallback(
    async (input: MockSignInInput) => {
      const result = await gateway.signIn(input);
      if (result.ok) {
        setSession(result.session);
        setStatus("authenticated");
      }
      return result;
    },
    [gateway],
  );

  const register = useCallback(
    async (input: MockRegistrationInput) => {
      const result = await gateway.register(input);
      if (result.ok) {
        setSession(result.session);
        setStatus("authenticated");
      }
      return result;
    },
    [gateway],
  );

  const signOut = useCallback(() => {
    gateway.signOut();
    setSession(null);
    setStatus("anonymous");
  }, [gateway]);

  const value = useMemo<MockSessionContextValue>(
    () => ({ status, session, signIn, register, signOut }),
    [register, session, signIn, signOut, status],
  );

  return (
    <MockSessionContext.Provider value={value}>
      {children}
    </MockSessionContext.Provider>
  );
}

export const MockAuthProvider = MockSessionProvider;

export function useMockSession(): MockSessionContextValue {
  const context = useContext(MockSessionContext);
  if (!context) {
    throw new Error(
      "useMockSession debe utilizarse dentro de MockSessionProvider.",
    );
  }
  return context;
}

export default MockSessionProvider;
