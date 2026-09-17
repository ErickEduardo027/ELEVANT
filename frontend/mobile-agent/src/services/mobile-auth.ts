import {
  SessionMembershipKind,
  SessionOrganizationType,
  SessionPortal,
  type SessionActorResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  clearStoredMobileSession,
  clearStoredMobileSessionIfCurrent,
  readStoredMobileSession,
  updateStoredMobileSessionMetadata,
  writeStoredMobileSession,
} from '../storage/mobile-session';
import {
  asMobileServiceError,
  MobileServiceError,
} from './mobile-service-error';
import { registerCurrentMobileDevice } from './mobile-device';

const SESSION_SCHEMA_VERSION = 1 as const;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  schemaVersion: typeof SESSION_SCHEMA_VERSION;
  actor: MobileAgentActor;
  expiresAt: string;
}>;

type LocalSessionState =
  | Readonly<{ kind: 'missing' }>
  | Readonly<{ kind: 'expired' }>
  | Readonly<{
      kind: 'active';
      session: MobileSession;
      sessionId: string;
      accessToken: string;
    }>;

/** @internal Credentials never cross into components or public session state. */
export type MobileSessionRequestContext = Readonly<{
  session: MobileSession;
  sessionId: string;
  accessToken: string;
}>;

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

function isFutureExpiry(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp > Date.now();
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

function isStoredMobileSession(value: unknown): value is StoredMobileSession {
  return (
    isRecord(value) &&
    hasOnlyKeys(value, ['schemaVersion', 'actor', 'expiresAt']) &&
    value.schemaVersion === SESSION_SCHEMA_VERSION &&
    isMobileAgentActor(value.actor) &&
    isFutureExpiry(value.expiresAt)
  );
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
  };
}

async function clearRejectedSession(sessionId: string) {
  try {
    return await clearStoredMobileSessionIfCurrent(sessionId);
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

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
    const api = createMobileAgentApiClient();
    const issued = await api.createSession(
      { email: normalizedEmail, password },
      { signal: options.signal },
    );
    const issuedActor = qualifyingActor(issued.actor);
    if (!issuedActor) throw new MobileServiceError('forbidden');
    if (!isFutureExpiry(issued.expiresAt)) {
      throw new MobileServiceError('session_expired');
    }

    const confirmingApi = createMobileAgentApiClient({
      getAccessToken: () => issued.accessToken,
    });
    const current = await confirmingApi.getCurrentSession({
      signal: options.signal,
    });
    const currentActor = qualifyingActor(current.actor);
    if (!currentActor || currentActor.accountId !== issuedActor.accountId) {
      throw new MobileServiceError('forbidden');
    }

    const metadata: StoredMobileSession = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor: currentActor,
      expiresAt: issued.expiresAt,
    };
    const sessionId = await writeStoredMobileSession(issued.accessToken, metadata);
    try {
      await registerCurrentMobileDevice(
        { accessToken: issued.accessToken },
        options,
      );
      const confirmedState = await localSessionState();
      if (
        confirmedState.kind !== 'active' ||
        confirmedState.sessionId !== sessionId
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
  } catch (error) {
    throw asMobileServiceError(error, 'login');
  }
}

export async function getMobileSession(): Promise<MobileSession | null> {
  try {
    const state = await localSessionState();
    return state.kind === 'active' ? state.session : null;
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/** @internal Captures one atomic credential/identity revision for a request. */
export async function getMobileSessionRequestContext(): Promise<MobileSessionRequestContext> {
  try {
    const state = await localSessionState();
    if (state.kind === 'expired') {
      throw new MobileServiceError('session_expired');
    }
    if (state.kind === 'missing') {
      throw new MobileServiceError('unauthenticated');
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

/** @internal Invalidates only the credential revision that made the request. */
export async function rejectMobileSessionRequest(sessionId: string) {
  return clearRejectedSession(sessionId);
}

export async function refreshMobileSession(
  options: MobileAuthRequestOptions = {},
): Promise<MobileSession> {
  let state: LocalSessionState;
  try {
    state = await localSessionState();
  } catch (error) {
    throw asMobileServiceError(error);
  }

  if (state.kind === 'expired') {
    throw new MobileServiceError('session_expired');
  }
  if (state.kind === 'missing') {
    throw new MobileServiceError('unauthenticated');
  }

  try {
    const current = await createMobileAgentApiClient({
      getAccessToken: () => state.accessToken,
    }).getCurrentSession({ signal: options.signal });
    const actor = qualifyingActor(current.actor);
    if (!actor || actor.accountId !== state.session.actor.accountId) {
      throw new MobileServiceError('forbidden');
    }

    const metadata: StoredMobileSession = {
      schemaVersion: SESSION_SCHEMA_VERSION,
      actor,
      expiresAt: state.session.expiresAt,
    };
    const updated = await updateStoredMobileSessionMetadata(
      metadata,
      state.sessionId,
    );
    if (!updated) throw new MobileServiceError('cancelled');
    return publicSession(metadata);
  } catch (error) {
    const normalized = asMobileServiceError(error);
    if (
      normalized.code === 'unauthenticated' ||
      normalized.code === 'forbidden'
    ) {
      const cleared = await clearRejectedSession(state.sessionId);
      if (!cleared) throw new MobileServiceError('cancelled');
    }
    throw normalized;
  }
}

export async function logoutMobileAgent(): Promise<void> {
  try {
    await clearStoredMobileSession();
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

export {
  MobileServiceError,
  type MobileServiceErrorCode,
} from './mobile-service-error';
