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
  type MockSignInResult,
  type MockSignInInput,
} from "@/lib/mock-auth";
import {
  MockAffiliationGateway,
  type MockAffiliationInput,
  type MockAffiliationResult,
} from "@/lib/mock-affiliation";

export type MockSessionStatus = "loading" | "anonymous" | "authenticated";

export interface MockSessionContextValue {
  status: MockSessionStatus;
  session: MockAirlineSession | null;
  signIn: (input: MockSignInInput) => Promise<MockSignInResult>;
  requestAffiliation: (
    input: MockAffiliationInput,
  ) => Promise<MockAffiliationResult>;
  signOut: () => void;
}

export interface MockSessionProviderProps {
  children: ReactNode;
  gateway?: MockAuthGateway;
  affiliationGateway?: MockAffiliationGateway;
}

const MockSessionContext = createContext<MockSessionContextValue | null>(null);

export function MockSessionProvider({
  children,
  gateway: providedGateway,
  affiliationGateway: providedAffiliationGateway,
}: MockSessionProviderProps) {
  const gateway = useMemo(
    () => providedGateway ?? new MockAuthGateway(),
    [providedGateway],
  );
  const affiliationGateway = useMemo(
    () => providedAffiliationGateway ?? new MockAffiliationGateway(),
    [providedAffiliationGateway],
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

  const requestAffiliation = useCallback(
    async (input: MockAffiliationInput) => affiliationGateway.submit(input),
    [affiliationGateway],
  );

  const signOut = useCallback(() => {
    gateway.signOut();
    setSession(null);
    setStatus("anonymous");
  }, [gateway]);

  const value = useMemo<MockSessionContextValue>(
    () => ({ status, session, signIn, requestAffiliation, signOut }),
    [requestAffiliation, session, signIn, signOut, status],
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
