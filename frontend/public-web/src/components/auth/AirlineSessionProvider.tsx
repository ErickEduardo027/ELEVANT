"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ElevantApiError, type AirlineContractPageResponse,
  type AirlineOperationalRequestPageResponse, type AirlineOperationPageResponse,
  type AirlinePreinvoicePageResponse,
  type AirlinePreinvoiceDetailResponse,
  type AirlinePortalBootstrapResponse, type AirlinePortalOperationResponse,
  type SessionActorResponse } from "@elevant/api-client";
import { createPublicWebApiClient } from "@/lib/elevant-api";
import { createPublicAirlineChangeObserver } from "@/lib/airline-change-observer";

export const AIRLINE_SESSION_STORAGE_KEY = "elevant-airline-session-v1";

export interface AirlineSessionData {
  actor: SessionActorResponse;
  bootstrap: AirlinePortalBootstrapResponse;
  expiresAt: string;
}

export interface AirlineDraftData {
  id: string; contractId: string; contractCode: string; airline: string; status: string;
  validFrom: string; validTo: string | null; currencyCode: string; terms: string | null;
  stations: string[];
  rates: { id: string; serviceName: string; billingUnit: string; unitPrice: number; minimumQuantity: number; isConfirmed: boolean }[];
  comments: { id: string; author: string; body: string; at: string; isAirline: boolean }[];
}

export type AirlineSessionStatus = "loading" | "anonymous" | "ready" | "unavailable";
export type AirlineSignInResult =
  | { ok: true }
  | { ok: false; reason: "invalid" | "forbidden" | "context" | "password-change-required" | "rate-limited" | "unavailable" };
export type AirlinePasswordChangeResult = { ok: true } | { ok: false; reason: "invalid" | "policy" | "rate-limited" | "unavailable" };

interface AirlineSessionContextValue {
  status: AirlineSessionStatus;
  session: AirlineSessionData | null;
  signIn(input: { email: string; password: string }): Promise<AirlineSignInResult>;
  changePassword(input: { email: string; currentPassword: string; newPassword: string }): Promise<AirlinePasswordChangeResult>;
  signOut(): void;
  retry(): Promise<void>;
  getContracts(page?: number): Promise<AirlineContractPageResponse>;
  getOperations(page?: number): Promise<AirlineOperationPageResponse>;
  getOperation(operationId: string): Promise<AirlinePortalOperationResponse>;
  getRequests(page?: number): Promise<AirlineOperationalRequestPageResponse>;
  getPreinvoices(page?: number): Promise<AirlinePreinvoicePageResponse>;
  getPreinvoice(preinvoiceId: string): Promise<AirlinePreinvoiceDetailResponse>;
  acceptPreinvoice(preinvoiceId: string): Promise<void>;
  operationRevision: number;
  financeRevision: number;
  getDrafts(): Promise<AirlineDraftData[]>;
  commentDraft(versionId: string, body: string): Promise<void>;
  draftRevision: number;
}

const AirlineSessionContext = createContext<AirlineSessionContextValue | null>(null);

interface StoredSession {
  accessToken: string;
  expiresAt: string;
}

class AirlineAccessDenied extends Error {}

function authorizedAirline(actor: SessionActorResponse, organizationId?: string): boolean {
  return actor.roles.some((role) => role.code === "AIRLINE_CLIENT" && role.portal === "airline_portal")
    && actor.memberships.some((membership) => membership.kind === "airline_client"
      && membership.organizationType === "airline_customer"
      && (!organizationId || membership.organizationId === organizationId));
}

function clearStoredSession() {
  try { window.sessionStorage.removeItem(AIRLINE_SESSION_STORAGE_KEY); } catch { /* Memory-only if storage is unavailable. */ }
}

function readStoredSession(): StoredSession | null {
  try {
    const raw = window.sessionStorage.getItem(AIRLINE_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const value: unknown = JSON.parse(raw);
    if (typeof value !== "object" || value === null || Array.isArray(value)) throw new Error("Invalid session");
    const record = value as Record<string, unknown>;
    if (typeof record.accessToken !== "string" || !record.accessToken
      || typeof record.expiresAt !== "string" || Date.parse(record.expiresAt) <= Date.now()
      || !Number.isFinite(Date.parse(record.expiresAt))) throw new Error("Expired session");
    return { accessToken: record.accessToken, expiresAt: record.expiresAt };
  } catch {
    clearStoredSession();
    return null;
  }
}

function saveStoredSession(value: StoredSession) {
  try { window.sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify(value)); }
  catch { /* The live tab still works when storage is unavailable. */ }
}

function failureReason(error: unknown): Exclude<AirlineSignInResult, { ok: true }>["reason"] {
  if (error instanceof AirlineAccessDenied) return "forbidden";
  if (error instanceof ElevantApiError) {
    if (error.status === 409 && error.code === "password_change_required") return "password-change-required";
    if (error.status === 401) return "invalid";
    if (error.status === 403) return "forbidden";
    if (error.status === 404) return "context";
    if (error.status === 429) return "rate-limited";
  }
  return "unavailable";
}

export function AirlineSessionProvider({ children, baseUrl }: { children: ReactNode; baseUrl?: string }) {
  const [status, setStatus] = useState<AirlineSessionStatus>("loading");
  const [session, setSession] = useState<AirlineSessionData | null>(null);
  const [draftRevision, setDraftRevision] = useState(0);
  const [operationRevision, setOperationRevision] = useState(0);
  const [financeRevision, setFinanceRevision] = useState(0);
  const accountId = session?.actor.accountId;
  const stored = useRef<StoredSession | null>(null);
  const generation = useRef(0);
  const refreshing = useRef(false);

  const load = useCallback(async (record: StoredSession): Promise<AirlineSessionData> => {
    if (Date.parse(record.expiresAt) <= Date.now()) throw new ElevantApiError({ kind: "http", status: 401 });
    const client = createPublicWebApiClient({ baseUrl, getAccessToken: () => record.accessToken });
    const current = await client.getCurrentSession({ cache: "no-store" });
    if (!authorizedAirline(current.actor)) throw new AirlineAccessDenied();
    const bootstrap = await client.getAirlinePortalBootstrap({ cache: "no-store" });
    if (!authorizedAirline(current.actor, bootstrap.organizationId)) throw new AirlineAccessDenied();
    return { actor: current.actor, bootstrap, expiresAt: record.expiresAt };
  }, [baseUrl]);

  const clear = useCallback(() => {
    generation.current += 1;
    stored.current = null;
    clearStoredSession();
    setSession(null);
    setStatus("anonymous");
  }, []);

  const validate = useCallback(async (record: StoredSession) => {
    const request = ++generation.current;
    stored.current = record;
    setSession(null);
    setStatus("loading");
    try {
      const live = await load(record);
      if (request !== generation.current) return;
      setSession(live);
      setStatus("ready");
    } catch (error) {
      if (request !== generation.current) return;
      if (["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      else setStatus("unavailable");
    }
  }, [clear, load]);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      const record = readStoredSession();
      if (record) void validate(record);
      else setStatus("anonymous");
    });
    return () => { active = false; generation.current += 1; };
  }, [validate]);

  useEffect(() => {
    if (!session) return;
    const remaining = Date.parse(session.expiresAt) - Date.now();
    if (remaining > 2_147_483_647) return;
    const timer = window.setTimeout(clear, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [clear, session]);

  const refreshLive = useCallback(async () => {
    const record = stored.current;
    if (!record || refreshing.current) return;
    const request = generation.current;
    refreshing.current = true;
    try {
      const live = await load(record);
      if (request === generation.current) {
        setSession(live);
        setOperationRevision(current => current + 1);
        setFinanceRevision(current => current + 1);
      }
    } catch (error) {
      if (request === generation.current &&
          ["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      // Keep the last authorized snapshot during a transient network failure.
    } finally {
      refreshing.current = false;
    }
  }, [clear, load]);

  useEffect(() => {
    if (status !== "ready" || !accountId) return;
    const refresh = () => { void refreshLive(); };
    const visibility = () => { if (document.visibilityState === "visible") refresh(); };
    window.addEventListener("focus", refresh);
    window.addEventListener("online", refresh);
    document.addEventListener("visibilitychange", visibility);
    const timer = window.setInterval(refresh, 25_000);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", refresh);
      window.removeEventListener("online", refresh);
      document.removeEventListener("visibilitychange", visibility);
    };
  }, [accountId, refreshLive, status]);

  useEffect(() => {
    if (status !== "ready" || !accountId) return;
    const observer = createPublicAirlineChangeObserver({ baseUrl,
      getAccessToken: () => stored.current?.accessToken ?? "",
      onChanges: resources => {
        if (resources.includes("airline_operations")) void refreshLive();
        if (resources.includes("airline_contracts")) setDraftRevision(current => current + 1);
        if (resources.includes("airline_preinvoices")) setFinanceRevision(current => current + 1);
      } });
    void observer.start();
    return () => { void observer.stop(); };
  }, [accountId, baseUrl, refreshLive, status]);

  const signIn = useCallback(async (input: { email: string; password: string }): Promise<AirlineSignInResult> => {
    const request = ++generation.current;
    stored.current = null;
    setSession(null);
    clearStoredSession();
    try {
      const unauthenticated = createPublicWebApiClient({ baseUrl });
      const response = await unauthenticated.createSession(input);
      if (!authorizedAirline(response.actor)) throw new AirlineAccessDenied();
      const record = { accessToken: response.accessToken, expiresAt: response.expiresAt };
      const live = await load(record);
      if (request !== generation.current) return { ok: false, reason: "unavailable" };
      stored.current = record;
      saveStoredSession(record);
      setSession(live);
      setStatus("ready");
      return { ok: true };
    } catch (error) {
      if (request === generation.current) setStatus("anonymous");
      return { ok: false, reason: failureReason(error) };
    }
  }, [baseUrl, load]);

  const retry = useCallback(async () => {
    const record = stored.current ?? readStoredSession();
    if (record) await validate(record);
    else clear();
  }, [clear, validate]);

  const changePassword = useCallback(async (input: { email: string; currentPassword: string; newPassword: string }): Promise<AirlinePasswordChangeResult> => {
    try {
      await createPublicWebApiClient({ baseUrl }).changePassword(input);
      return { ok: true };
    } catch (error) {
      if (error instanceof ElevantApiError) {
        if (error.status === 401) return { ok: false, reason: "invalid" };
        if (error.status === 400) return { ok: false, reason: "policy" };
        if (error.status === 429) return { ok: false, reason: "rate-limited" };
      }
      return { ok: false, reason: "unavailable" };
    }
  }, [baseUrl]);

  const getContracts = useCallback(async (page = 1): Promise<AirlineContractPageResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineContracts(
          { page, limit: 20 }, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current &&
          ["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getOperations = useCallback(async (page = 1): Promise<AirlineOperationPageResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineOperations(
          { page, limit: 20 }, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current &&
          ["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getOperation = useCallback(async (operationId: string): Promise<AirlinePortalOperationResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineOperation(
          operationId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getRequests = useCallback(async (page = 1): Promise<AirlineOperationalRequestPageResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineOperationalRequests(
          { page, limit: 20 }, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current &&
          ["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getPreinvoices = useCallback(async (page = 1): Promise<AirlinePreinvoicePageResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlinePreinvoices(
          { page, limit: 20 }, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current &&
          ["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getPreinvoice = useCallback(async (preinvoiceId: string): Promise<AirlinePreinvoiceDetailResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlinePreinvoice(
          preinvoiceId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const acceptPreinvoice = useCallback(async (preinvoiceId: string): Promise<void> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).acceptAirlinePreinvoice(
          preinvoiceId, { requestId: preinvoiceId });
      if (request !== generation.current) throw new AirlineAccessDenied();
      setFinanceRevision(current => current + 1);
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const draftRequest = useCallback(async (path: string, options: RequestInit = {}) => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const origin = (baseUrl ?? process.env.NEXT_PUBLIC_ELEVANT_API_URL)?.replace(/\/$/, "");
    if (!origin) throw new Error("API no configurada");
    const response = await fetch(`${origin}/api/v1${path}`, {
      ...options,
      cache: "no-store",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${record.accessToken}` },
    });
    if (response.status === 401) { clear(); throw new AirlineAccessDenied(); }
    if (!response.ok) throw new Error("No se pudo completar la consulta del borrador.");
    return response.json();
  }, [baseUrl, clear]);

  const getDrafts = useCallback(async (): Promise<AirlineDraftData[]> => {
    const result: unknown = await draftRequest("/airline/contract-drafts");
    if (!Array.isArray(result) || !result.every(item =>
      item && typeof item === "object" && typeof item.id === "string" &&
      typeof item.contractCode === "string" && Array.isArray(item.rates) &&
      Array.isArray(item.comments) && Array.isArray(item.stations)))
      throw new Error("La respuesta de borradores no es válida.");
    return result as AirlineDraftData[];
  }, [draftRequest]);

  const commentDraft = useCallback(async (versionId: string, body: string): Promise<void> => {
    await draftRequest(`/airline/contract-drafts/${encodeURIComponent(versionId)}/comments`, {
      method: "POST", body: JSON.stringify({ body }),
    });
    setDraftRevision(current => current + 1);
  }, [draftRequest]);

  return <AirlineSessionContext.Provider value={{ status, session, signIn, changePassword, signOut: clear, retry, getContracts, getOperations, getOperation, getRequests, getPreinvoices, getPreinvoice, acceptPreinvoice, operationRevision, financeRevision, getDrafts, commentDraft, draftRevision }}>
    {children}
  </AirlineSessionContext.Provider>;
}

export function useAirlineSession(): AirlineSessionContextValue {
  const value = useContext(AirlineSessionContext);
  if (!value) throw new Error("AirlineSessionProvider is required.");
  return value;
}
