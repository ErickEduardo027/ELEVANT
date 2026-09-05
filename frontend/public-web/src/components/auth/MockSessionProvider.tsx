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
import { getPrototypeApiUrl } from "@/lib/prototype-api";

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
    async (input: MockAffiliationInput) => {
      if (providedAffiliationGateway || process.env.NODE_ENV === "test") {
        return affiliationGateway.submit(input);
      }
      const localResult = affiliationGateway.submit(input);
      if (!localResult.ok) return localResult;
      try {
        const baseUrl = getPrototypeApiUrl();
        const response = await fetch(`${baseUrl}/api/public/service-requests`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            airline: localResult.request.airline.displayName,
            contactName: localResult.request.representative.fullName,
            contactEmail: localResult.request.representative.email,
            type: "affiliation",
            requestedService: localResult.request.servicesOfInterest,
            details: localResult.request,
          }),
        });
        const created = await response.json();
        if (!response.ok) throw new Error(created.error || "No se pudo enviar la solicitud.");
        return {
          ok: true as const,
          request: {
            ...localResult.request,
            id: created.id,
            reference: created.id,
            submittedAt: created.receivedAt,
          },
        };
      } catch {
        return {
          ok: false as const,
          message: "La solicitud se guardó localmente, pero el endpoint aún no está disponible en la API de Development.",
        };
      }
    },
    [affiliationGateway, providedAffiliationGateway],
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
