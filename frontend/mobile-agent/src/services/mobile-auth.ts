import {
  SessionMembershipKind,
  SessionOrganizationType,
  SessionPortal,
  type SessionActorResponse,
  type SessionResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  clearStoredMobileSession,
  clearStoredMobileSessionIfCurrent,
  countPendingEvidence,
  forgetEndedMobileSession,
  readEndedMobileSession,
  readStoredMobileSession,
  replaceStoredMobileCredentialIfCurrent,
  subscribeStoredMobileSessionEnd,
  writeStoredMobileSession,
  type EndedMobileSession,
  type MobileSessionEnd,
  type MobileSessionEndReason,
  type PendingEvidenceCount,
} from '../storage/mobile-session';
import { serverNow } from '../synchronization/server-clock';
import {
  asMobileServiceError,
  MobileServiceError,
} from './mobile-service-error';
import {
  registerCurrentMobileDevice,
  releaseCurrentMobileDevice,
} from './mobile-device';

/** v2 (S3) adds until when the refresh token renews the session; v1, the deployed APK's, is still read. */
const SESSION_SCHEMA_VERSION = 2 as const;
const LEGACY_SESSION_SCHEMA_VERSION = 1 as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const BASE64URL_ALPHABET =
  'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/** The session renews its access token this long before it expires, as AVIAM Web does (ADR-0021, ADR-0046). */
export const MOBILE_SESSION_RENEW_BEFORE_MS = 60_000;
/** After a renewal that could not finish (no signal, ELEVANT busy, a lost answer) the next one waits this long. */
export const MOBILE_SESSION_RENEWAL_BACKOFF_MS = 30_000;
/** How long ending the session at ELEVANT may take before the tablet goes on without it (S3). */
export const MOBILE_END_SESSION_TIMEOUT_MS = 5_000;

/**
 * @deprecated Historical prototype adapters are retained only as Vault
 * evidence. Canonical sessions never expose a token, so they cannot call it.
 */
export const MOBILE_API_URL = 'http://127.0.0.1:9';

export type MobileAgentRole = Readonly<{
  roleId: string;
  code: 'RAMP_AGENT';
  name: string;
  portal: 'ramp_mobile_app';
  userType: string;
}>;

export type MobileAgentMembership = Readonly<{
  membershipId: string;
  organizationId: string;
  organizationCode: 'AVIAM';
  organizationName: string;
  organizationType: 'aviam_operator';
  kind: 'internal_staff';
}>;

export type MobileAgentStationScope = Readonly<{
  stationId: string;
  stationCode: string;
}>;

export type MobileAgentActor = Readonly<{
  accountId: string;
  email: string;
  displayName: string;
  role: MobileAgentRole;
  membership: MobileAgentMembership;
  stationScopes: readonly MobileAgentStationScope[];
}>;

/** Compatibility projection for existing profile UI while it adopts actor. */
export type MobileAgent = Readonly<{
  id: string;
  email: string;
  name: string;
  role: 'AGENTE_RAMPA';
  roleLabel: string;
}>;

export type MobileSession = Readonly<{
  actor: MobileAgentActor;
  expiresAt: string;
  /** @deprecated Use actor. This projection contains no credential. */
  user: MobileAgent;
  /** @deprecated Tokens are never exposed by the session service. */
  token?: never;
}>;

export type MobileAuthRequestOptions = Readonly<{
  signal?: AbortSignal;
}>;

type StoredMobileSession = Readonly<{
  schemaVersion: typeof SESSION_SCHEMA_VERSION | typeof LEGACY_SESSION_SCHEMA_VERSION;
  actor: MobileAgentActor;
  /** When the access token expires; past it the session renews it or ends (S3). */
  expiresAt: string;
  /**
   * Until when the refresh token renews the session (v2); null when this session cannot renew: ELEVANT gave no refresh
   * token or its access token lacks `auth_time` (ADR-0046). v1 never renews.
   */
  refreshExpiresAt?: string | null;
}>;

type ActiveSessionState = Readonly<{
  kind: 'active';
  session: MobileSession;
  sessionId: string;
  accessToken: string;
  refreshToken: string | null;
  refreshExpiresAt: string | null;
}>;

type LocalSessionState =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'expired' }>
  | ActiveSessionState;

/**
 * @internal The session as the device holds it, without its credential: enough to queue a tap, keep a draft or
 * reserve an attendance observation without signal (S3).
 */
export type MobileSessionIdentity = Readonly<{
  session: MobileSession;
  sessionId: string;
}>;

/** @internal Credentials never cross into components or public session state. */
export type MobileSessionRequestContext = Readonly<{
  session: MobileSession;
  sessionId: string;
  accessToken: string;
}>;

/**
 * What one renewal left (S3): a new credential stored ('renewed', by this renewal or another one), the session ended
 * because ELEVANT refused it ('ended', with its cause), the session kept with its credential because the renewal could
 * not finish now ('kept': no signal, ELEVANT busy, a lost answer) or another session in its place ('superseded').
 */
type RenewalOutcome =
  | Readonly<{ kind: 'renewed' }>
  | Readonly<{ kind: 'superseded' }>
  | Readonly<{ kind: 'ended'; issue: MobileServiceError }>
  | Readonly<{ kind: 'kept'; issue: MobileServiceError }>;

/** A renewal on its way: the credential it renews, what it leaves and how to cancel its request. */
type Renewal = Readonly<{ accessToken: string; outcome: Promise<RenewalOutcome>; controller: AbortController }>;

/** The renewal on its way, shared by every request that needs it: one refresh token is presented once. */
let renewal: Renewal | null = null;
/** After a renewal that could not finish, no other one before `until` (the tablet's clock), and why. */
let renewalPause: Readonly<{ until: number; issue: MobileServiceError }> | null = null;
/** The access token the last renewal stored, and when (the tablet's clock). */
let lastRenewal: Readonly<{ accessToken: string; at: number }> | null = null;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]) {
  const actual = Object.keys(value);
  return actual.length === keys.length && actual.every((key) => keys.includes(key));
}

function isNonEmptyString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.trim().length > 0 &&
    !/[\u0000-\u001f\u007f]/.test(value)
  );
}

function isUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000'
  );
}

function isInstant(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

/** Whether an instant is still ahead by ELEVANT's clock (3-N18): a tablet whose own clock runs ahead still signs in. */
function isFutureExpiry(value: unknown, now = serverNow().getTime()): value is string {
  return isInstant(value) && Date.parse(value) > now;
}

/** A refresh token as ELEVANT issues it (ADR-0021): Base64URL, the shape the shared client accepts. */
function isRefreshToken(value: unknown): value is string {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{16,128}$/.test(value);
}

/**
 * Whether an access token carries `auth_time`, the start of its session (ADR-0046). The payload is read without
 * checking the signature, which is ELEVANT's job: it only tells the tablet that ELEVANT keeps the session's start when
 * it renews. An older API would open a new binding of the tablet with every renewal, so without it the tablet does not
 * renew.
 */
function carriesSessionStart(accessToken: string) {
  const payload = accessToken.split('.')[1];
  if (!payload || payload.length > 8_192 || !/^[A-Za-z0-9_-]+$/.test(payload)) return false;
  let text = '';
  let buffer = 0;
  let bits = 0;
  for (const character of payload) {
    buffer = ((buffer << 6) | BASE64URL_ALPHABET.indexOf(character)) & 0xffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      text += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  try {
    const claims: unknown = JSON.parse(text);
    return (
      isRecord(claims) &&
      typeof claims.auth_time === 'number' &&
      Number.isFinite(claims.auth_time) &&
      claims.auth_time > 0
    );
  } catch {
    return false;
  }
}

function isMobileAgentRole(value: unknown): value is MobileAgentRole {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['roleId', 'code', 'name', 'portal', 'userType']) &&
    isUuid(value.roleId) &&
    value.code === 'RAMP_AGENT' &&
    isNonEmptyString(value.name) &&
    value.portal === SessionPortal.ramp_mobile_app &&
    isNonEmptyString(value.userType)
  );
}

function isMobileAgentMembership(
  value: unknown,
): value is MobileAgentMembership {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, [
      'membershipId',
      'organizationId',
      'organizationCode',
      'organizationName',
      'organizationType',
      'kind',
    ]) &&
    isUuid(value.membershipId) &&
    isUuid(value.organizationId) &&
    value.organizationCode === 'AVIAM' &&
    isNonEmptyString(value.organizationName) &&
    value.organizationType === SessionOrganizationType.aviam_operator &&
    value.kind === SessionMembershipKind.internal_staff
  );
}

function isMobileAgentStationScope(
  value: unknown,
): value is MobileAgentStationScope {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['stationId', 'stationCode']) &&
    isUuid(value.stationId) &&
    isNonEmptyString(value.stationCode)
  );
}

function isMobileAgentActor(value: unknown): value is MobileAgentActor {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, [
      'accountId',
      'email',
      'displayName',
      'role',
      'membership',
      'stationScopes',
    ]) ||
    !isUuid(value.accountId) ||
    !isNonEmptyString(value.email) ||
    !isNonEmptyString(value.displayName) ||
    !isMobileAgentRole(value.role) ||
    !isMobileAgentMembership(value.membership) ||
    !Array.isArray(value.stationScopes) ||
    value.stationScopes.length === 0 ||
    !value.stationScopes.every(isMobileAgentStationScope)
  ) {
    return false;
  }

  const stationIds = value.stationScopes.map((scope) => scope.stationId);
  return new Set(stationIds).size === stationIds.length;
}

function qualifyingActor(
  actor: SessionActorResponse,
): MobileAgentActor | undefined {
  if (
    !isUuid(actor.accountId) ||
    !isNonEmptyString(actor.email) ||
    !isNonEmptyString(actor.displayName)
  ) {
    return undefined;
  }

  const role = actor.roles.find(
    (candidate) =>
      candidate.code === 'RAMP_AGENT' &&
      candidate.portal === SessionPortal.ramp_mobile_app,
  );
  const membership = actor.memberships.find(
    (candidate) =>
      candidate.organizationCode === 'AVIAM' &&
      candidate.organizationType === SessionOrganizationType.aviam_operator &&
      candidate.kind === SessionMembershipKind.internal_staff,
  );
  if (!role || !membership || actor.stationScopes.length === 0) return undefined;

  const result = {
    accountId: actor.accountId,
    email: actor.email,
    displayName: actor.displayName,
    role: {
      roleId: role.roleId,
      code: 'RAMP_AGENT',
      name: role.name,
      portal: SessionPortal.ramp_mobile_app,
      userType: role.userType,
    },
    membership: {
      membershipId: membership.membershipId,
      organizationId: membership.organizationId,
      organizationCode: 'AVIAM',
      organizationName: membership.organizationName,
      organizationType: SessionOrganizationType.aviam_operator,
      kind: SessionMembershipKind.internal_staff,
    },
    stationScopes: actor.stationScopes.map((scope) => ({
      stationId: scope.stationId,
      stationCode: scope.stationCode,
    })),
  } satisfies MobileAgentActor;

  return isMobileAgentActor(result) ? result : undefined;
}

/**
 * The session's metadata. Its access token may have expired: the storage already ended the session that cannot be
 * renewed, and one with a refresh token in force renews it before a request (S3).
 */
function isStoredMobileSession(value: unknown): value is StoredMobileSession {
  if (!isRecord(value) || !isMobileAgentActor(value.actor) || !isInstant(value.expiresAt)) {
    return false;
  }
  if (value.schemaVersion === LEGACY_SESSION_SCHEMA_VERSION) {
    return hasOnlyKeys(value, ['schemaVersion', 'actor', 'expiresAt']);
  }
  return (
    value.schemaVersion === SESSION_SCHEMA_VERSION &&
    hasOnlyKeys(value, ['schemaVersion', 'actor', 'expiresAt', 'refreshExpiresAt']) &&
    (value.refreshExpiresAt === null || isInstant(value.refreshExpiresAt))
  );
}

/**
 * The metadata of a session ELEVANT issued or renewed (S3). It renews only with a refresh token in force and an access
 * token that carries `auth_time` (ADR-0046); otherwise `refreshExpiresAt` is null and the session ends with its access
 * token, as before.
 */
function sessionMetadata(
  actor: MobileAgentActor,
  issued: SessionResponse,
  refreshToken: string | null,
  now: number,
): StoredMobileSession {
  const renews =
    refreshToken !== null &&
    isFutureExpiry(issued.refreshExpiresAt, now) &&
    carriesSessionStart(issued.accessToken);
  return {
    schemaVersion: SESSION_SCHEMA_VERSION,
    actor,
    expiresAt: issued.expiresAt,
    refreshExpiresAt: renews ? (issued.refreshExpiresAt as string) : null,
  };
}

function publicSession(metadata: StoredMobileSession): MobileSession {
  return {
    actor: metadata.actor,
    expiresAt: metadata.expiresAt,
    user: {
      id: metadata.actor.accountId,
      email: metadata.actor.email,
      name: metadata.actor.displayName,
      role: 'AGENTE_RAMPA',
      roleLabel: metadata.actor.role.name,
    },
  };
}

async function localSessionState(
  retrySupersededSession = true,
): Promise<LocalSessionState> {
  const stored = await readStoredMobileSession();
  if (stored.kind === 'missing') return { kind: 'missing' };
  if (stored.kind === 'expired') return { kind: 'expired' };

  if (!isStoredMobileSession(stored.metadata)) {
    const cleared = await clearStoredMobileSessionIfCurrent(stored.sessionId);
    if (!cleared && retrySupersededSession) return localSessionState(false);
    if (!cleared) throw new MobileServiceError('cancelled');
    return { kind: 'missing' };
  }

  return {
    kind: 'active',
    session: publicSession(stored.metadata),
    sessionId: stored.sessionId,
    accessToken: stored.accessToken,
    refreshToken: stored.refreshToken,
    refreshExpiresAt: stored.metadata.refreshExpiresAt ?? null,
  };
}

/** The session the device holds, or the failure that says why there is none. */
async function activeSessionState(): Promise<ActiveSessionState> {
  const state = await localSessionState();
  if (state.kind === 'expired') throw new MobileServiceError('session_expired');
  if (state.kind === 'missing') throw new MobileServiceError('unauthenticated');
  return state;
}

/**
 * Whether the session can renew its access token (S3): a refresh token in force, from an API that keeps the start of
 * the session (`auth_time`, ADR-0046).
 */
function renewable(state: ActiveSessionState, now: number) {
  return (
    state.refreshToken !== null &&
    isFutureExpiry(state.refreshExpiresAt, now) &&
    carriesSessionStart(state.accessToken)
  );
}

/**
 * The session can still be used: its access token is in force or it can renew it. One that can do neither, an expired
 * token without `auth_time` for one, ends here as an expired session always did, and its marker stays (N5).
 */
async function usableSessionState(): Promise<ActiveSessionState> {
  const state = await activeSessionState();
  const now = serverNow().getTime();
  if (isFutureExpiry(state.session.expiresAt, now) || renewable(state, now)) return state;
  await clearStoredMobileSessionIfCurrent(state.sessionId, state.accessToken, 'expired');
  throw new MobileServiceError('session_expired');
}

/** The pause after a renewal that could not finish, while it lasts; a clock moved back never stretches it. */
function activeRenewalPause() {
  if (!renewalPause) return null;
  const remaining = renewalPause.until - Date.now();
  return remaining > 0 && remaining <= MOBILE_SESSION_RENEWAL_BACKOFF_MS ? renewalPause : null;
}

/** Whether the last renewal stored this access token less than `withinMs` ago. */
function renewedLately(accessToken: string, withinMs: number) {
  if (lastRenewal?.accessToken !== accessToken) return false;
  const elapsed = Date.now() - lastRenewal.at;
  return elapsed >= 0 && elapsed < withinMs;
}

/**
 * A renewal is due in the last minute of the access token, or once it expired. Not during the pause after a renewal
 * that could not finish, nor right after one whose token already looks due: the tablet's clock was not corrected yet,
 * and the next answer from ELEVANT corrects it (3-N18).
 */
function renewalDue(state: ActiveSessionState) {
  const now = serverNow().getTime();
  return (
    Date.parse(state.session.expiresAt) - now <= MOBILE_SESSION_RENEW_BEFORE_MS &&
    !activeRenewalPause() &&
    !renewedLately(state.accessToken, MOBILE_SESSION_RENEWAL_BACKOFF_MS) &&
    renewable(state, now)
  );
}

/**
 * Why a renewal could not finish, as the requests that wait on it fail during the pause (S3). A 409 or 404 of the
 * session endpoint (a lost renewal answer, D-S3b) says nothing about the operation a screen shows: it fails as a request
 * to try again, never as `conflict` or `not_found`.
 */
function renewalFailure(issue: MobileServiceError) {
  return issue.code === 'conflict' || issue.code === 'not_found'
    ? new MobileServiceError('request_failed', { traceId: issue.traceId, retryable: true })
    : issue;
}

function pauseRenewals(failure: MobileServiceError): RenewalOutcome {
  const issue = renewalFailure(failure);
  renewalPause = { until: Date.now() + MOBILE_SESSION_RENEWAL_BACKOFF_MS, issue };
  return { kind: 'kept', issue };
}

/** After the device's session changed under a renewal: the same session renewed elsewhere, or another one. */
async function changedSession(previous: ActiveSessionState): Promise<RenewalOutcome> {
  try {
    const state = await localSessionState();
    return state.kind === 'active' &&
      state.sessionId === previous.sessionId &&
      state.accessToken !== previous.accessToken
      ? { kind: 'renewed' }
      : { kind: 'superseded' };
  } catch (error) {
    return { kind: 'kept', issue: asMobileServiceError(error) };
  }
}

/**
 * Ends the session that cannot go on, only while it still holds that credential; its marker names why (N5), so the
 * account keeps the checklist answers it marks after the end.
 */
async function endRefusedSession(
  state: ActiveSessionState,
  issue: MobileServiceError,
  reason: MobileSessionEndReason,
): Promise<RenewalOutcome> {
  try {
    const cleared = await clearStoredMobileSessionIfCurrent(state.sessionId, state.accessToken, reason);
    return cleared ? { kind: 'ended', issue } : await changedSession(state);
  } catch (error) {
    return { kind: 'kept', issue: asMobileServiceError(error) };
  }
}

/**
 * One renewal of the credential `seen` names (ADR-0021, as AVIAM Web): 200 stores the new credential of the same
 * account under the same revision; 409 re-reads what the device holds; 401 ends the session with its cause; no
 * signal, 429 or 5xx keep the session and pause the renewals. A credential another renewal already replaced is never
 * presented again. `ignorePause`: the agent asked for it (the sign-out), so the pause after a failed renewal does not
 * hold it back.
 */
async function renewCredential(
  seen: ActiveSessionState,
  ignorePause: boolean,
  signal: AbortSignal,
): Promise<RenewalOutcome> {
  let state: LocalSessionState;
  try {
    state = await localSessionState();
  } catch (error) {
    return { kind: 'kept', issue: asMobileServiceError(error) };
  }
  if (state.kind !== 'active' || state.sessionId !== seen.sessionId) return { kind: 'superseded' };
  if (state.accessToken !== seen.accessToken) return { kind: 'renewed' };
  if (!renewable(state, serverNow().getTime())) {
    return endRefusedSession(state, new MobileServiceError('session_expired'), 'expired');
  }
  const pause = ignorePause ? null : activeRenewalPause();
  if (pause) return { kind: 'kept', issue: pause.issue };

  let issued: SessionResponse;
  try {
    issued = await createMobileAgentApiClient().refreshSession(state.refreshToken as string, { signal });
  } catch (error) {
    const issue = asMobileServiceError(error);
    // ELEVANT refused the family: revoked by OCC, a password change, 30 days without use or a reused token (D-S3b).
    if (issue.status === 401) {
      return endRefusedSession(state, new MobileServiceError('session_expired', {
        status: issue.status,
        traceId: issue.traceId,
      }), 'refused');
    }
    if (issue.status === 403) return endRefusedSession(state, issue, 'forbidden');
    // 409 refresh_rotated: the token was replaced less than a minute ago. If no other renewal stored the new one, its
    // answer was lost (D-S3b): the session lasts as long as its access token, and ELEVANT ends the family once the old
    // refresh token comes back after that minute.
    if (issue.status === 409) {
      const latest = await localSessionState().catch(() => null);
      if (latest?.kind === 'active' && latest.sessionId === state.sessionId) {
        if (latest.accessToken !== state.accessToken) return { kind: 'renewed' };
      } else if (latest !== null) {
        return { kind: 'superseded' };
      }
    }
    return pauseRenewals(issue);
  }

  const actor = qualifyingActor(issued.actor);
  if (!actor || actor.accountId !== state.session.actor.accountId) {
    return endRefusedSession(state, new MobileServiceError('forbidden'), 'forbidden');
  }
  const refreshToken = isRefreshToken(issued.refreshToken) ? issued.refreshToken : null;
  let replaced: boolean;
  try {
    replaced = await replaceStoredMobileCredentialIfCurrent(state.sessionId, state.accessToken,
      issued.accessToken, refreshToken, sessionMetadata(actor, issued, refreshToken, serverNow().getTime()));
  } catch (error) {
    return pauseRenewals(asMobileServiceError(error));
  }
  if (!replaced) return changedSession(state);
  renewalPause = null;
  lastRenewal = { accessToken: issued.accessToken, at: Date.now() };
  return { kind: 'renewed' };
}

/** The renewal of this credential: the one on its way, or a new one. */
function renewSession(state: ActiveSessionState, ignorePause = false): Renewal {
  if (renewal?.accessToken === state.accessToken) return renewal;
  const controller = new AbortController();
  const outcome = renewCredential(state, ignorePause, controller.signal).finally(() => {
    if (renewal?.outcome === outcome) renewal = null;
  });
  renewal = { accessToken: state.accessToken, outcome, controller };
  return renewal;
}

/**
 * The credential the sign-out frees the tablet with (S3). A session whose access token expired, or is in its last
 * minute, holds a token ELEVANT would refuse, and the binding would stay open: it renews first, once, also during the
 * pause after a renewal that could not finish, and waits for it MOBILE_END_SESSION_TIMEOUT_MS at most before it
 * cancels it. Ending the family while that renewal is on its way would refuse it, so the end waits for it too. When the
 * renewal does not finish, the sign-out goes on with what the tablet holds, as before.
 */
async function signOutCredential(state: ActiveSessionState): Promise<ActiveSessionState> {
  try {
    const now = serverNow().getTime();
    if (
      Date.parse(state.session.expiresAt) - now > MOBILE_SESSION_RENEW_BEFORE_MS ||
      renewedLately(state.accessToken, MOBILE_SESSION_RENEWAL_BACKOFF_MS) ||
      !renewable(state, now)
    ) {
      return state;
    }
    const current = renewSession(state, true);
    const timeout = setTimeout(() => current.controller.abort(), MOBILE_END_SESSION_TIMEOUT_MS);
    try {
      await current.outcome;
    } finally {
      clearTimeout(timeout);
    }
    const latest = await localSessionState();
    return latest.kind === 'active' && latest.sessionId === state.sessionId ? latest : state;
  } catch {
    return state;
  }
}

/**
 * Ends the refresh family at ELEVANT (POST auth/session/logout), best effort and within MOBILE_END_SESSION_TIMEOUT_MS
 * (S3): without signal the tablet forgets the token all the same, and ELEVANT lets the family lapse after 30 days
 * without use.
 */
async function endSessionAtElevant(refreshToken: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MOBILE_END_SESSION_TIMEOUT_MS);
  try {
    await createMobileAgentApiClient().endSession(refreshToken, { signal: controller.signal });
  } catch {
    // Best effort: an unreachable ELEVANT never keeps the agent signed in.
  } finally {
    clearTimeout(timeout);
  }
}

async function clearRejectedSession(sessionId: string, accessToken: string, reason: MobileSessionEndReason) {
  try {
    return await clearStoredMobileSessionIfCurrent(sessionId, accessToken, reason);
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/**
 * Signs in and keeps the refresh token ELEVANT issued (S3), compared with ELEVANT's clock. When the tablet does not
 * keep the sign-in (the account does not qualify, the registration of the tablet fails, the request was cancelled), the
 * refresh family it was just issued ends at ELEVANT too.
 */
export async function loginMobileAgent(
  email: string,
  password: string,
  options: MobileAuthRequestOptions = {},
): Promise<MobileSession> {
  const normalizedEmail = email.trim();
  if (normalizedEmail.length === 0 || password.length === 0) {
    throw new MobileServiceError('authentication_failed');
  }

  try {
    const issued = await createMobileAgentApiClient().createSession(
      { email: normalizedEmail, password },
      { signal: options.signal },
    );
    const refreshToken = isRefreshToken(issued.refreshToken) ? issued.refreshToken : null;
    try {
      return await openSession(issued, refreshToken, options);
    } catch (error) {
      if (refreshToken !== null) await endSessionAtElevant(refreshToken);
      throw error;
    }
  } catch (error) {
    throw asMobileServiceError(error, 'login');
  }
}

async function openSession(
  issued: SessionResponse,
  refreshToken: string | null,
  options: MobileAuthRequestOptions,
): Promise<MobileSession> {
  const issuedActor = qualifyingActor(issued.actor);
  if (!issuedActor) throw new MobileServiceError('forbidden');
  // The answer's Date header already set ELEVANT's clock (3-N18): a tablet whose clock runs ahead still signs in, and
  // a token that looks expired by a stale offset is renewed at once rather than refused.
  const issuedMetadata = sessionMetadata(issuedActor, issued, refreshToken, serverNow().getTime());
  if (!isFutureExpiry(issued.expiresAt) && issuedMetadata.refreshExpiresAt === null) {
    throw new MobileServiceError('session_expired');
  }

  const current = await createMobileAgentApiClient({
    getAccessToken: () => issued.accessToken,
  }).getCurrentSession({ signal: options.signal });
  const currentActor = qualifyingActor(current.actor);
  if (!currentActor || currentActor.accountId !== issuedActor.accountId) {
    throw new MobileServiceError('forbidden');
  }

  const metadata: StoredMobileSession = { ...issuedMetadata, actor: currentActor };
  const sessionId = await writeStoredMobileSession(issued.accessToken, metadata, refreshToken);
  try {
    await registerCurrentMobileDevice({ accessToken: issued.accessToken, sessionId }, options);
    const confirmedState = await localSessionState();
    if (
      confirmedState.kind !== 'active' ||
      confirmedState.sessionId !== sessionId ||
      // Only a sign-in the tablet keeps forgets the end of the previous session (N5); a failed one leaves it.
      !(await forgetEndedMobileSession(sessionId))
    ) {
      throw new MobileServiceError('cancelled');
    }
  } catch (registrationError) {
    const normalized = asMobileServiceError(registrationError);
    try {
      const cleared = await clearStoredMobileSessionIfCurrent(sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    } catch (cleanupError) {
      throw asMobileServiceError(cleanupError);
    }
    throw normalized;
  }
  return publicSession(metadata);
}

/**
 * Replaces the temporary password Gestión Humana gave the account (the API answers sign-in with 409
 * `password_change_required` until then). Unauthenticated, like sign-in; nothing is stored, and the caller signs in
 * with the new password afterwards because the change ends every earlier credential.
 */
export async function changeTemporaryPassword(
  email: string,
  currentPassword: string,
  newPassword: string,
  options: MobileAuthRequestOptions = {},
): Promise<void> {
  const normalizedEmail = email.trim();
  if (normalizedEmail.length === 0 || currentPassword.length === 0) {
    throw new MobileServiceError('current_password_invalid');
  }
  if (newPassword.length === 0) {
    throw new MobileServiceError('password_policy_rejected');
  }

  try {
    await createMobileAgentApiClient().changePassword(
      { email: normalizedEmail, currentPassword, newPassword },
      { signal: options.signal },
    );
  } catch (error) {
    throw asMobileServiceError(error, 'password_change');
  }
}

/** The signed-in session, also while its access token waits for its renewal (S3); null without one. */
export async function getMobileSession(): Promise<MobileSession | null> {
  try {
    return (await usableSessionState()).session;
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (normalized.code === 'unauthenticated' || normalized.code === 'session_expired') return null;
    throw normalized;
  }
}

/**
 * @internal The session's identity, read from the device only: no renewal and no network (S3). The tablet queues a
 * tap, keeps a draft and reserves an attendance observation with it while the access token waits for its renewal.
 */
export async function getMobileSessionIdentity(): Promise<MobileSessionIdentity> {
  try {
    const state = await usableSessionState();
    return { session: state.session, sessionId: state.sessionId };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/**
 * @internal Captures one atomic credential/identity revision for a request. In the last minute of its access token
 * the session renews it first (S3), once for every request that waits on it. When the renewal cannot finish (no
 * signal, ELEVANT busy) the session stays and the request goes out with the credential it holds: without signal it
 * fails as offline, and a 401 goes back to {@link rejectMobileSessionRequest}. A renewal ELEVANT refused ends the
 * session with its cause.
 */
export async function getMobileSessionRequestContext(): Promise<MobileSessionRequestContext> {
  try {
    let state = await usableSessionState();
    if (renewalDue(state)) {
      const outcome = await renewSession(state).outcome;
      if (outcome.kind === 'ended') throw outcome.issue;
      // Renewed, replaced by another sign-in, or kept because the renewal could not finish: the request goes out with
      // what the device holds now.
      state = await usableSessionState();
    }
    return {
      session: state.session,
      sessionId: state.sessionId,
      accessToken: state.accessToken,
    };
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/**
 * @internal ELEVANT refused the credential a request carried (401 or 403). Invalidates only the credential revision
 * that made the request, and since S3 a 401 first forces one renewal:
 * - 'retry': the same session holds another credential, renewed meanwhile or now. The service sends the request once
 *   more; answering «cancelled» would leave its screen waiting.
 * - true: the session ended, after a 403, a renewal ELEVANT refused, a session that cannot renew, or a credential
 *   ELEVANT refused right after its renewal (never a loop). The request's refusal stands.
 * - false: another session took its place; the request is cancelled.
 * A renewal that cannot finish now keeps the session and is thrown as its failure: no signal, ELEVANT busy.
 */
export async function rejectMobileSessionRequest(
  context: Readonly<{ sessionId: string; accessToken: string }>,
  failure: MobileServiceError,
): Promise<boolean | 'retry'> {
  let state: LocalSessionState;
  try {
    state = await localSessionState();
  } catch (error) {
    throw asMobileServiceError(error);
  }
  if (state.kind !== 'active' || state.sessionId !== context.sessionId) return false;
  if (state.accessToken !== context.accessToken) return 'retry';
  if (
    failure.code === 'unauthenticated' &&
    !renewedLately(context.accessToken, MOBILE_SESSION_RENEW_BEFORE_MS)
  ) {
    const outcome = await renewSession(state).outcome;
    if (outcome.kind === 'renewed') return 'retry';
    if (outcome.kind === 'ended') return true;
    if (outcome.kind === 'superseded') return false;
    throw outcome.issue;
  }
  return clearRejectedSession(context.sessionId, context.accessToken,
    failure.code === 'forbidden' ? 'forbidden' : 'refused');
}

/**
 * Tells `listener` whenever the tablet ends a session its agent did not sign out of (N6, D-N6): it expired and could not
 * be renewed, ELEVANT refused it, or the account lost its access to the app (reason 'forbidden'). The screens say so
 * and offer ENTRAR DE NUEVO instead of blaming the device; a sign-out on purpose is not announced. Returns the function
 * that stops listening.
 */
export function subscribeMobileSessionEnd(listener: (ended: MobileSessionEnd) => void) {
  return subscribeStoredMobileSessionEnd(listener);
}

/**
 * What this tablet keeps that ELEVANT has not confirmed (3-N12), for the account signed in, for the account whose
 * session ended (N7) and for the others; null when the device's storage cannot be read, so a screen simply shows no
 * notice.
 */
export async function readUnsentRecords(): Promise<PendingEvidenceCount | null> {
  try {
    return await countPendingEvidence();
  } catch {
    return null;
  }
}

/**
 * The last session the tablet ended without its agent signing out (N5): whose, why and when. The access screen names
 * that cause (N7). Null when there is none (a sign-out on purpose or a confirmed sign-in forgets it) or when the
 * device's storage cannot be read, so the screen keeps to its route notice. Reading it first ends a session that
 * already expired.
 */
export async function readEndedSession(): Promise<EndedMobileSession | null> {
  try {
    return await readEndedMobileSession();
  } catch {
    return null;
  }
}

/**
 * Signs out: frees the tablet for the next agent (2-N02) and ends the session at ELEVANT, so its refresh token and
 * every renewal of it stop working (S3); both are best effort and bounded in time. An access token that expired while
 * the session waited for its renewal is renewed first, so ELEVANT takes the release. Then it clears the session, its
 * caches and the marker of an ended session (N5): nothing marked afterwards is kept. A tablet that cannot reach ELEVANT
 * still signs out; the next agent who signs in on it takes it. What the agent recorded and ELEVANT has not confirmed
 * stays on the device for the same account (3-N12).
 */
export async function logoutMobileAgent(): Promise<void> {
  let state: LocalSessionState | null = null;
  try {
    state = await localSessionState();
  } catch {
    state = null;
  }
  if (state?.kind === 'active') {
    const { accessToken, refreshToken, sessionId } = await signOutCredential(state);
    await Promise.all([
      releaseCurrentMobileDevice({ accessToken, sessionId }),
      refreshToken === null ? undefined : endSessionAtElevant(refreshToken),
    ]);
  }
  try {
    await clearStoredMobileSession();
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/** Test hook: forgets the renewal on its way, the pause after a failed one and the last renewal. */
export function resetMobileSessionRenewalForTests() {
  renewal = null;
  renewalPause = null;
  lastRenewal = null;
}

export {
  MobileServiceError,
  type MobileServiceErrorCode,
} from './mobile-service-error';
export type {
  EndedMobileSession,
  MobileSessionEnd,
  PendingEvidenceCount,
} from '../storage/mobile-session';
