"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { ElevantApiError, type AirlineContractPageResponse, type ContractDocumentResponse,
  type AirlineApprovedOperationEvidenceResponse, type AirlineServiceOrderResponse,
  type AirlineOperationalRequestPageResponse, type AirlineOperationPageResponse,
  type NonFiscalPaymentLookupResponse,
  type AirlineInvoiceStatementResponse,
  type AirlinePortalBootstrapResponse, type AirlinePortalOperationResponse,
  type SessionActorResponse, type SessionResponse, type AirlinePermitData, type SubmitAirlinePermitInput,
  type ContractTimelineData, type ContractPricingTermsResponse,
  type AirlinePortalStandingResponse, type AirlinePortalUserData, type AirlinePortalUsersData,
  type InviteAirlinePortalUserCommand, type SetAirlinePortalUserSignerCommand,
  type SetAirlinePortalUserStatusCommand } from "@elevant/api-client";
import { createAirlineTreasuryService, type AirlineTreasuryService, type AirlineTreasuryStatement, type AirlineTreasuryInvoiceDetail, type AirlineTreasuryReceipt, type AirlineTreasuryNotes } from "@/lib/airline-treasury-service";
import { createPublicWebApiClient } from "@/lib/elevant-api";
import type { CardPaymentListResponse, CardPaymentResponse, PayInvoiceByCardBody } from "@elevant/api-client";
import { createPublicAirlineChangeObserver } from "@/lib/airline-change-observer";

export const AIRLINE_SESSION_STORAGE_KEY = "elevant-airline-session-v1";

export interface AirlineSessionData {
  actor: SessionActorResponse;
  bootstrap: AirlinePortalBootstrapResponse;
  expiresAt: string;
}

/**
 * A draft of the airline's contract. `version` is the rowversion an observation expects; the API never
 * sends the portal Finance base prices nor the internal reason of a Finance return (1-N05).
 */
export interface AirlineDraftData {
  id: string; contractId: string; contractCode: string; airline: string; status: string;
  validFrom: string; validTo: string | null; currencyCode: string; terms: string | null;
  stations: string[];
  rates: { id: string; serviceName: string; billingUnit: string; unitPrice: number; minimumQuantity: number; isConfirmed: boolean }[];
  comments: { id: string; author: string; body: string; at: string; isAirline: boolean }[];
  versionStatus?: string; financeDecision?: string | null; version?: string;
}

export type AirlineSessionStatus = "loading" | "anonymous" | "ready" | "unavailable";
/**
 * Where the airline stands with AVIAM (2-N32): read with the session and again when its contracts change. A
 * screen that needs it shows its own loading, error and forbidden states.
 */
export type AirlineStandingState =
  | { status: "loading"; data: null }
  | { status: "ready"; data: AirlinePortalStandingResponse }
  | { status: "error" | "forbidden"; data: null };
/** The 6-digit email step of the portal login (ADR-0022). */
export interface AirlineLoginChallenge { challengeId: string; emailHint: string; expiresAt: string }
export type AirlineSignInResult =
  | { ok: true }
  | { ok: false; reason: "code-required"; challenge: AirlineLoginChallenge }
  | { ok: false; reason: "invalid" | "forbidden" | "context" | "password-change-required" | "rate-limited" | "unavailable" };
export type AirlineSignInFailure = Exclude<AirlineSignInResult, { ok: true } | { reason: "code-required" }>["reason"];
/** Result of an activation or reset link: invalid-link covers used and expired links. */
export type AirlineLinkResult = { ok: true } | { ok: false; reason: "invalid-link" | "policy" | "rate-limited" | "unavailable" };
export type AirlinePasswordChangeResult = { ok: true } | { ok: false; reason: "invalid" | "policy" | "rate-limited" | "unavailable" };

interface AirlineSessionContextValue {
  status: AirlineSessionStatus;
  session: AirlineSessionData | null;
  signIn(input: { email: string; password: string }): Promise<AirlineSignInResult>;
  verifyLoginCode(challengeId: string, code: string): Promise<AirlineSignInResult>;
  resendLoginCode(challengeId: string): Promise<AirlineLoginChallenge | null>;
  activateAccount(token: string, newPassword: string): Promise<AirlineLinkResult>;
  requestPasswordReset(email: string): Promise<{ ok: boolean }>;
  resetPassword(token: string, newPassword: string): Promise<AirlineLinkResult>;
  changePassword(input: { email: string; currentPassword: string; newPassword: string }): Promise<AirlinePasswordChangeResult>;
  signOut(): void;
  retry(): Promise<void>;
  getContracts(page?: number): Promise<AirlineContractPageResponse>;
  getContractDocument(versionId: string): Promise<ContractDocumentResponse>;
  downloadContractDocument(versionId: string): Promise<Blob>;
  /** Watermarked review PDF of a draft shared with the airline. */
  downloadContractDraft(versionId: string): Promise<Blob>;
  /** Permit dossier of the airline and its submission (ADR-0024). */
  getPermits(): Promise<AirlinePermitData[]>;
  /** Uploads the scanned permit and answers its private media URL, kept by the intent that sends it. */
  uploadPermitDocument(document: File): Promise<string>;
  /** Submits a permit with the intent's Idempotency-Key: a retry of the same body never duplicates it (2-N09). */
  submitPermit(input: SubmitAirlinePermitInput, idempotencyKey: string): Promise<AirlinePermitData>;
  /**
   * The airline's portal users and what the session may do (2-N20): representatives manage the users and sign;
   * signers sign contracts and submit the permits; everybody else reads.
   */
  getPortalUsers(): Promise<AirlinePortalUsersData>;
  /** A representative invites a user by email with the intent's Idempotency-Key; the activation email is queued. */
  invitePortalUser(command: InviteAirlinePortalUserCommand, idempotencyKey: string): Promise<AirlinePortalUserData>;
  /** A representative deactivates or reactivates another user with the version on screen. */
  setPortalUserStatus(userId: string, command: SetAirlinePortalUserStatusCommand,
    idempotencyKey: string): Promise<AirlinePortalUserData>;
  /** A representative lets another user sign and submit permits, or takes it back, with the version on screen. */
  setPortalUserSigner(userId: string, command: SetAirlinePortalUserSignerCommand,
    idempotencyKey: string): Promise<AirlinePortalUserData>;
  /**
   * Historical stations, read-only and what each contract waits for (2-N32, 2-N35). It is read only once a screen
   * asks for it (`useAirlineStanding`) and again when the airline's contracts change.
   */
  standing: AirlineStandingState;
  requestStanding(): void;
  retryStanding(): void;
  getContractTimeline(versionId: string): Promise<ContractTimelineData>;
  /** Surcharges and packages that apply to an approved version and whether they are signed (2-N04). */
  getContractPricingTerms(versionId: string): Promise<ContractPricingTermsResponse>;
  /** `signatureImagePng` is the drawn signature as a PNG data URL (ADR-0025). */
  signContract(versionId: string, signerName: string, signerTitle: string, documentSha256: string,
    signatureImagePng: string, idempotencyKey: string): Promise<ContractDocumentResponse>;
  getOperations(page?: number): Promise<AirlineOperationPageResponse>;
  getOperation(operationId: string): Promise<AirlinePortalOperationResponse>;
  getApprovedEvidence(operationId: string): Promise<AirlineApprovedOperationEvidenceResponse>;
  /** The Service Order the airline's representative signed on the ramp (ADR-0032). */
  getServiceOrder(operationId: string): Promise<AirlineServiceOrderResponse>;
  downloadServiceOrder(operationId: string): Promise<Blob>;
  getRequests(page?: number): Promise<AirlineOperationalRequestPageResponse>;
  getTreasuryStatement(asOf: string, stationId?: string, signal?: AbortSignal): Promise<AirlineTreasuryStatement>;
  getTreasuryInvoice(invoiceId: string, signal?: AbortSignal): Promise<AirlineTreasuryInvoiceDetail>;
  getTreasuryReceipt(receiptId: string, signal?: AbortSignal): Promise<AirlineTreasuryReceipt>;
  getTreasuryNotes(invoiceId: string, signal?: AbortSignal): Promise<AirlineTreasuryNotes>;
  getInvoicePayment(invoiceId: string): Promise<NonFiscalPaymentLookupResponse>;
  getInvoiceStatement(invoiceId: string): Promise<AirlineInvoiceStatementResponse>;
  getInvoiceDocument(invoiceId: string): Promise<Blob>;
  /** ADR-0036: pays the whole balance with a simulated card; retry an uncertain result with the same key. */
  payInvoiceByCard(invoiceId: string, request: PayInvoiceByCardBody, idempotencyKey: string): Promise<CardPaymentResponse>;
  getInvoiceCardPayments(invoiceId: string): Promise<CardPaymentListResponse>;
  getCardPaymentReceipt(attemptId: string): Promise<Blob>;
  getPaymentReceipt(invoiceId: string): Promise<Blob>;
  operationRevision: number;
  financeRevision: number;
  getDrafts(): Promise<AirlineDraftData[]>;
  /** An observation on a draft, with the draft version on screen and the intent's Idempotency-Key. */
  commentDraft(versionId: string, body: string, expectedVersion: string, idempotencyKey: string): Promise<void>;
  draftRevision: number;
}

const AirlineSessionContext = createContext<AirlineSessionContextValue | null>(null);

interface StoredSession {
  accessToken: string;
  expiresAt: string;
  /** Renews the access token inside this tab (ADR-0021); null when the API issued none. */
  refreshToken: string | null;
}

/** The portal renews this long before the access token expires. */
export const RENEW_BEFORE_MS = 60_000;

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
    const refreshToken = typeof record.refreshToken === "string" && record.refreshToken ? record.refreshToken : null;
    // An expired access token is still a session while it can be renewed.
    if (typeof record.accessToken !== "string" || !record.accessToken
      || typeof record.expiresAt !== "string" || !Number.isFinite(Date.parse(record.expiresAt))
      || (!refreshToken && Date.parse(record.expiresAt) <= Date.now())) throw new Error("Expired session");
    return { accessToken: record.accessToken, expiresAt: record.expiresAt, refreshToken };
  } catch {
    clearStoredSession();
    return null;
  }
}

function saveStoredSession(value: StoredSession) {
  try { window.sessionStorage.setItem(AIRLINE_SESSION_STORAGE_KEY, JSON.stringify(value)); }
  catch { /* The live tab still works when storage is unavailable. */ }
}

function linkFailure(error: unknown): AirlineLinkResult {
  if (error instanceof ElevantApiError) {
    if (error.status === 400 && error.code === "password_policy") return { ok: false, reason: "policy" };
    if (error.status === 400) return { ok: false, reason: "invalid-link" };
    if (error.status === 429) return { ok: false, reason: "rate-limited" };
  }
  if (error instanceof TypeError) return { ok: false, reason: "invalid-link" };
  return { ok: false, reason: "unavailable" };
}

function failureReason(error: unknown): AirlineSignInFailure {
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

  /** Replaces the tokens of the tab; resolves false when the server ended the session. */
  const renew = useCallback(async (record: StoredSession): Promise<boolean | null> => {
    if (!record.refreshToken) return false;
    try {
      const response = await createPublicWebApiClient({ baseUrl }).refreshSession(record.refreshToken);
      Object.assign(record, { accessToken: response.accessToken, expiresAt: response.expiresAt,
        refreshToken: response.refreshToken ?? null });
      saveStoredSession(record);
      return true;
    } catch (error) {
      if (error instanceof ElevantApiError && (error.status === 401 || error.status === 409)) return false;
      return null;
    }
  }, [baseUrl]);

  const validate = useCallback(async (record: StoredSession) => {
    const request = ++generation.current;
    stored.current = record;
    setSession(null);
    setStatus("loading");
    try {
      if (Date.parse(record.expiresAt) - Date.now() <= RENEW_BEFORE_MS) {
        const renewed = await renew(record);
        if (renewed === false) throw new ElevantApiError({ kind: "http", status: 401 });
      }
      const live = await load(record);
      if (request !== generation.current) return;
      setSession(live);
      setStatus("ready");
    } catch (error) {
      if (request !== generation.current) return;
      if (["invalid", "forbidden", "context"].includes(failureReason(error))) clear();
      else setStatus("unavailable");
    }
  }, [clear, load, renew]);

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
    const record = stored.current;
    const renewable = Boolean(record?.refreshToken);
    const remaining = Date.parse(session.expiresAt) - Date.now() - (renewable ? RENEW_BEFORE_MS : 0);
    if (remaining > 2_147_483_647) return;
    const timer = window.setTimeout(() => {
      if (!record || !renewable) { clear(); return; }
      void renew(record).then((renewed) => {
        if (renewed === false) { clear(); return; }
        // After a network failure the session stays and the next attempt comes shortly.
        const expiresAt = renewed ? record.expiresAt : new Date(Date.now() + RENEW_BEFORE_MS * 1.5).toISOString();
        setSession((current) => current && { ...current, expiresAt });
      });
    }, Math.max(0, remaining));
    return () => window.clearTimeout(timer);
  }, [clear, renew, session]);

  const signOut = useCallback(() => {
    const token = stored.current?.refreshToken;
    clear();
    if (token) void createPublicWebApiClient({ baseUrl }).endSession(token).catch(() => {});
  }, [baseUrl, clear]);

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
        // 4-A: the airline no longer reads or decides preinvoices, but the issuance still announces its invoices as
        // airline_preinvoices: it is a hint to re-read «Finanzas».
        if (resources.includes("airline_preinvoices") || resources.includes("airline_treasury")) setFinanceRevision(current => current + 1);
      } });
    void observer.start();
    return () => { void observer.stop(); };
  }, [accountId, baseUrl, refreshLive, status]);

  const establish = useCallback(async (request: number, response: SessionResponse): Promise<AirlineSignInResult> => {
    try {
      if (!authorizedAirline(response.actor)) throw new AirlineAccessDenied();
      const record = { accessToken: response.accessToken, expiresAt: response.expiresAt,
        refreshToken: response.refreshToken ?? null };
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
  }, [load]);

  const signIn = useCallback(async (input: { email: string; password: string }): Promise<AirlineSignInResult> => {
    const request = ++generation.current;
    stored.current = null;
    setSession(null);
    clearStoredSession();
    try {
      const started = await createPublicWebApiClient({ baseUrl }).startSession(input);
      if (started.kind === "code_required") {
        const { challengeId, emailHint, expiresAt } = started.challenge;
        return { ok: false, reason: "code-required", challenge: { challengeId, emailHint, expiresAt } };
      }
      return await establish(request, started.session);
    } catch (error) {
      if (request === generation.current) setStatus("anonymous");
      return { ok: false, reason: failureReason(error) };
    }
  }, [baseUrl, establish]);

  const verifyLoginCode = useCallback(async (challengeId: string, code: string): Promise<AirlineSignInResult> => {
    const request = ++generation.current;
    try {
      return await establish(request, await createPublicWebApiClient({ baseUrl }).verifyLoginCode(challengeId, code));
    } catch (error) {
      if (request === generation.current) setStatus("anonymous");
      return { ok: false, reason: error instanceof TypeError ? "invalid" : failureReason(error) };
    }
  }, [baseUrl, establish]);

  const resendLoginCode = useCallback(async (challengeId: string): Promise<AirlineLoginChallenge | null> => {
    try {
      const { emailHint, expiresAt } = await createPublicWebApiClient({ baseUrl }).resendLoginCode(challengeId);
      return { challengeId, emailHint, expiresAt };
    } catch {
      return null;
    }
  }, [baseUrl]);

  const activateAccount = useCallback(async (token: string, newPassword: string): Promise<AirlineLinkResult> => {
    try {
      await createPublicWebApiClient({ baseUrl }).activateAccount(token, newPassword);
      return { ok: true };
    } catch (error) {
      return linkFailure(error);
    }
  }, [baseUrl]);

  const requestPasswordReset = useCallback(async (email: string) => {
    try {
      await createPublicWebApiClient({ baseUrl }).requestPasswordReset(email);
      return { ok: true };
    } catch {
      return { ok: false };
    }
  }, [baseUrl]);

  const resetPassword = useCallback(async (token: string, newPassword: string): Promise<AirlineLinkResult> => {
    try {
      await createPublicWebApiClient({ baseUrl }).resetPassword(token, newPassword);
      return { ok: true };
    } catch (error) {
      return linkFailure(error);
    }
  }, [baseUrl]);

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

  // Formal contract document and the airline signature (teacher review, Phase 6).
  const withContractClient = useCallback(async <T,>(call: (client: ReturnType<typeof createPublicWebApiClient>) => Promise<T>) => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await call(createPublicWebApiClient({ baseUrl, getAccessToken: () => record.accessToken }));
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      // Only an expired session signs out; a missing or foreign version is just an error.
      if (request === generation.current && failureReason(error) === "invalid") clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getContractDocument = useCallback((versionId: string) =>
    withContractClient(client => client.getContractDocument(versionId, { cache: "no-store" })), [withContractClient]);

  const downloadContractDocument = useCallback((versionId: string) =>
    withContractClient(client => client.downloadContractDocument(versionId, { cache: "no-store" })), [withContractClient]);
  const downloadContractDraft = useCallback((versionId: string) =>
    withContractClient(client => client.downloadContractDraftPdf(versionId, { cache: "no-store" })), [withContractClient]);
  const getPermits = useCallback(() =>
    withContractClient(client => client.getAirlinePermits({ cache: "no-store" })), [withContractClient]);
  const uploadPermitDocument = useCallback((document: File) =>
    withContractClient(client => client.uploadAirlinePermitDocument(document)), [withContractClient]);
  const submitPermit = useCallback((input: SubmitAirlinePermitInput, idempotencyKey: string) =>
    withContractClient(client => client.submitAirlinePermit(input, idempotencyKey)), [withContractClient]);
  // 2-N20: the airline manages its own portal users; the server decides who may and answers the user it changed.
  const getPortalUsers = useCallback(() =>
    withContractClient(client => client.getAirlinePortalUsers({ cache: "no-store" })), [withContractClient]);
  const invitePortalUser = useCallback((command: InviteAirlinePortalUserCommand, idempotencyKey: string) =>
    withContractClient(client => client.inviteAirlinePortalUser(command, idempotencyKey)), [withContractClient]);
  const setPortalUserStatus = useCallback((userId: string, command: SetAirlinePortalUserStatusCommand,
    idempotencyKey: string) => withContractClient(client => client.setAirlinePortalUserStatus(userId, command,
    idempotencyKey)), [withContractClient]);
  const setPortalUserSigner = useCallback((userId: string, command: SetAirlinePortalUserSignerCommand,
    idempotencyKey: string) => withContractClient(client => client.setAirlinePortalUserSigner(userId, command,
    idempotencyKey)), [withContractClient]);

  // 2-N32: the standing is read once a screen asks for it and again when the airline's contracts change.
  const [standingRead, setStandingRead] = useState<{ accountId: string; state: AirlineStandingState } | null>(null);
  const [standingAttempt, setStandingAttempt] = useState(0);
  const [standingWanted, setStandingWanted] = useState(false);
  const requestStanding = useCallback(() => setStandingWanted(true), []);
  useEffect(() => {
    if (!standingWanted || status !== "ready" || !accountId) return;
    let active = true;
    void withContractClient(client => client.getAirlinePortalStanding({ cache: "no-store" }))
      .then(data => { if (active) setStandingRead({ accountId, state: { status: "ready", data } }); })
      .catch(error => {
        if (active) setStandingRead({ accountId, state: { status: error instanceof ElevantApiError && error.status === 403
          ? "forbidden" : "error", data: null } });
      });
    return () => { active = false; };
  }, [accountId, draftRevision, standingAttempt, standingWanted, status, withContractClient]);
  const standing: AirlineStandingState = standingRead && standingRead.accountId === accountId
    ? standingRead.state : { status: "loading", data: null };
  const retryStanding = useCallback(() => {
    setStandingRead(null);
    setStandingAttempt(current => current + 1);
  }, []);
  const getServiceOrder = useCallback((operationId: string) =>
    withContractClient(client => client.getAirlineServiceOrder(operationId, { cache: "no-store" })), [withContractClient]);
  const downloadServiceOrder = useCallback((operationId: string) =>
    withContractClient(client => client.downloadAirlineServiceOrder(operationId, { cache: "no-store" })), [withContractClient]);
  const getContractTimeline = useCallback((versionId: string) =>
    withContractClient(client => client.getContractTimeline(versionId, { cache: "no-store" })), [withContractClient]);
  const getContractPricingTerms = useCallback((versionId: string) =>
    withContractClient(client => client.getContractPricingTerms(versionId, { cache: "no-store" })), [withContractClient]);

  const signContract = useCallback((versionId: string, signerName: string, signerTitle: string,
    documentSha256: string, signatureImagePng: string, idempotencyKey: string) => withContractClient(client =>
    client.signContractVersion(versionId, { signerName, signerTitle, documentSha256, accepted: true, signatureImagePng },
      idempotencyKey)), [withContractClient]);

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

  const getApprovedEvidence = useCallback(async (operationId: string): Promise<AirlineApprovedOperationEvidenceResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineApprovedOperationEvidence(
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

  const readTreasury = useCallback(async <T,>(read: (service: AirlineTreasuryService) => Promise<T>): Promise<T> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await read(createAirlineTreasuryService({ baseUrl, getAccessToken: () => record.accessToken }));
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError && (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);
  const getTreasuryStatement = useCallback((asOf: string, stationId?: string, signal?: AbortSignal) =>
    readTreasury(service => service.getStatement(asOf, stationId, signal)), [readTreasury]);
  const getTreasuryInvoice = useCallback((invoiceId: string, signal?: AbortSignal) =>
    readTreasury(service => service.getInvoice(invoiceId, signal)), [readTreasury]);
  const getTreasuryReceipt = useCallback((receiptId: string, signal?: AbortSignal) =>
    readTreasury(service => service.getReceipt(receiptId, signal)), [readTreasury]);
  const getTreasuryNotes = useCallback((invoiceId: string, signal?: AbortSignal) =>
    readTreasury(service => service.getNotes(invoiceId, signal)), [readTreasury]);

  const getInvoiceStatement = useCallback(async (
    invoiceId: string): Promise<AirlineInvoiceStatementResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineInvoiceStatement(
          invoiceId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getInvoicePayment = useCallback(async (
    invoiceId: string): Promise<NonFiscalPaymentLookupResponse> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlinePaymentByInvoice(
          invoiceId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  const getInvoiceDocument = useCallback(async (invoiceId: string): Promise<Blob> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlineInvoiceDocumentById(
          invoiceId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);

  /** Card commands and reads of the session's airline; a revoked session is cleared, never retried. */
  const portalCall = useCallback(async <T,>(run: (client: ReturnType<typeof createPublicWebApiClient>) => Promise<T>): Promise<T> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await run(createPublicWebApiClient({ baseUrl, getAccessToken: () => record.accessToken }));
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
    } catch (error) {
      if (request === generation.current && error instanceof ElevantApiError &&
          (error.status === 401 || error.status === 403)) clear();
      throw error;
    }
  }, [baseUrl, clear]);
  const payInvoiceByCard = useCallback((invoiceId: string, request: PayInvoiceByCardBody, idempotencyKey: string) =>
    portalCall(client => client.payAirlineInvoiceByCard(invoiceId, request, idempotencyKey)), [portalCall]);
  const getInvoiceCardPayments = useCallback((invoiceId: string) =>
    portalCall(client => client.getAirlineInvoiceCardPayments(invoiceId, { cache: "no-store" })), [portalCall]);
  const getCardPaymentReceipt = useCallback((attemptId: string) =>
    portalCall(client => client.getAirlineCardPaymentReceipt(attemptId, { cache: "no-store" })), [portalCall]);

  const getPaymentReceipt = useCallback(async (invoiceId: string): Promise<Blob> => {
    const record = stored.current;
    if (!record) throw new AirlineAccessDenied();
    const request = generation.current;
    try {
      const result = await createPublicWebApiClient({ baseUrl,
        getAccessToken: () => record.accessToken }).getAirlinePaymentReceipt(
          invoiceId, { cache: "no-store" });
      if (request !== generation.current) throw new AirlineAccessDenied();
      return result;
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

  const commentDraft = useCallback(async (versionId: string, body: string, expectedVersion: string,
    idempotencyKey: string): Promise<void> => {
    await withContractClient(client => client.commentAirlineContractDraft(versionId, { expectedVersion, body },
      idempotencyKey));
    setDraftRevision(current => current + 1);
  }, [withContractClient]);

  return <AirlineSessionContext.Provider value={{ status, session, signIn, verifyLoginCode, resendLoginCode, activateAccount, requestPasswordReset, resetPassword, changePassword, signOut, retry, getContracts, getContractDocument, downloadContractDocument, downloadContractDraft, getPermits, uploadPermitDocument, submitPermit, getPortalUsers, invitePortalUser, setPortalUserStatus, setPortalUserSigner, standing, requestStanding, retryStanding, getContractTimeline, getContractPricingTerms, signContract, getOperations, getOperation, getApprovedEvidence, getServiceOrder, downloadServiceOrder, getRequests, getInvoicePayment, getInvoiceStatement, getTreasuryStatement, getTreasuryInvoice, getTreasuryReceipt, getTreasuryNotes, getInvoiceDocument, payInvoiceByCard, getInvoiceCardPayments, getCardPaymentReceipt, getPaymentReceipt, operationRevision, financeRevision, getDrafts, commentDraft, draftRevision }}>
    {children}
  </AirlineSessionContext.Provider>;
}

export function useAirlineSession(): AirlineSessionContextValue {
  const value = useContext(AirlineSessionContext);
  if (!value) throw new Error("AirlineSessionProvider is required.");
  return value;
}
