import type {
  RampIncidentResponse as ApiRampIncidentResponse,
  ReportRampIncidentRequest as ApiReportRampIncidentRequest,
} from '@elevant/api-client';
import { isIataDelayCode } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  listRampIncidentOutboxOperationsIfCurrent,
  readRampIncidentOutboxIfCurrent,
  reserveRampIncidentOutboxItemIfCurrent,
  updateRampIncidentOutboxItemIfCurrent,
  type StoredRampIncidentOutboxItem,
} from '../storage/mobile-session';
import {
  getMobileSessionIdentity,
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
  type MobileSessionRequestContext,
} from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError } from './mobile-service-error';

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type RampIncidentType = 'Operational' | 'Safety' | 'Equipment' | 'Documentation' | 'Deviation';
export type RampIncidentSeverity = 'Low' | 'Medium' | 'High' | 'Critical';
export type ReportRampIncidentRequest = Readonly<Omit<
  ApiReportRampIncidentRequest, 'incidentType' | 'severity'
> & {
  incidentType: RampIncidentType;
  severity: RampIncidentSeverity;
}>;

export type RampIncidentOutboxItem = Readonly<{
  idempotencyKey: string;
  request: ReportRampIncidentRequest;
  createdAt: string;
  state: 'pending' | 'blocked';
}>;

export type RampIncidentCenter = Readonly<{
  incidents: readonly ApiRampIncidentResponse[];
  outbox: readonly RampIncidentOutboxItem[];
  online: boolean;
  sent: number;
  issue?: MobileServiceError;
}>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === 'string' && uuidPattern.test(value) &&
    value.toLowerCase() !== '00000000-0000-0000-0000-000000000000';
}

function parseRequest(value: unknown): ReportRampIncidentRequest | null {
  if (
    !isRecord(value) ||
    !Object.keys(value).every(key => ['incidentType', 'severity', 'description', 'occurredAt', 'delayCode'].includes(key)) ||
    !['incidentType', 'severity', 'description', 'occurredAt']
      .every(key => key in value) ||
    !(['Operational', 'Safety', 'Equipment', 'Documentation', 'Deviation'] as const)
      .some(item => item === value.incidentType) ||
    // A deviation carries its IATA delay code (ADR-0031); other incidents never do.
    (value.incidentType === 'Deviation' ? !isIataDelayCode(value.delayCode) : value.delayCode != null) ||
    !(['Low', 'Medium', 'High', 'Critical'] as const)
      .some(item => item === value.severity) ||
    typeof value.description !== 'string' ||
    value.description.length > 2000 ||
    value.description.trim().length < 8 ||
    /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(value.description) ||
    typeof value.occurredAt !== 'string' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value.occurredAt) ||
    !Number.isFinite(Date.parse(value.occurredAt))
  ) return null;
  return {
    incidentType: value.incidentType as RampIncidentType,
    severity: value.severity as RampIncidentSeverity,
    description: value.description,
    occurredAt: value.occurredAt,
    ...(value.incidentType === 'Deviation' ? { delayCode: value.delayCode as string } : {}),
  };
}

function parseOutbox(items: readonly StoredRampIncidentOutboxItem[]): RampIncidentOutboxItem[] {
  return items.map(item => {
    let parsed: unknown;
    try { parsed = JSON.parse(item.payload) as unknown; }
    catch { throw new MobileServiceError('storage_unavailable'); }
    const request = parseRequest(parsed);
    if (!request || !isUuid(item.idempotencyKey)) {
      throw new MobileServiceError('storage_unavailable');
    }
    return { idempotencyKey: item.idempotencyKey, request, createdAt: item.createdAt, state: item.state };
  });
}

async function confirmSession(sessionId: string) {
  const current = await getMobileSessionRequestContext();
  if (current.sessionId !== sessionId) throw new MobileServiceError('cancelled');
  return current;
}

/**
 * The failure of a request with `context`'s credential. A revoked session ends here; 'retry' when the same session
 * holds a renewed credential and the center loads once more (S3).
 */
async function rejectIfRevoked(
  context: Readonly<{ sessionId: string; accessToken: string }>,
  error: unknown,
): Promise<MobileServiceError | 'retry'> {
  const issue = asMobileServiceError(error);
  if (issue.code === 'unauthenticated' || issue.code === 'forbidden') {
    const cleared = await rejectMobileSessionRequest(context, issue);
    if (cleared === 'retry') return 'retry';
    if (!cleared) throw new MobileServiceError('cancelled');
    throw issue;
  }
  return issue;
}

function sameReport(incident: ApiRampIncidentResponse, request: ReportRampIncidentRequest) {
  return incident.incidentType === request.incidentType &&
    incident.severity === request.severity &&
    incident.description === request.description &&
    (incident.delayCode ?? null) === (request.delayCode ?? null) &&
    Date.parse(incident.occurredAt) === Date.parse(request.occurredAt);
}

async function readOutbox(sessionId: string, accountId: string, operationId: string) {
  const result = await readRampIncidentOutboxIfCurrent(sessionId, accountId, operationId);
  if (result.kind !== 'current') throw new MobileServiceError('cancelled');
  return parseOutbox(result.items);
}

async function reconcile(
  sessionId: string,
  accountId: string,
  operationId: string,
  incidents: readonly ApiRampIncidentResponse[],
) {
  for (const item of await readOutbox(sessionId, accountId, operationId)) {
    const persisted = incidents.find(incident =>
      incident.id.toLowerCase() === item.idempotencyKey.toLowerCase());
    if (!persisted) continue;
    const action = sameReport(persisted, item.request) ? 'remove' : 'block';
    const updated = await updateRampIncidentOutboxItemIfCurrent(
      sessionId, accountId, operationId, item.idempotencyKey, action);
    if (updated.kind !== 'current') throw new MobileServiceError('cancelled');
  }
}

/**
 * What a flush sent. `renewed` when ELEVANT refused the credential and the session renewed it: the center loads once
 * more (S3), and `issue` is the refusal if it already did.
 */
type FlushResult = { sent: number; issue?: MobileServiceError; renewed?: boolean };

async function flush(
  context: MobileSessionRequestContext,
  accountId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<FlushResult> {
  const sessionId = context.sessionId;
  const pending = (await readOutbox(sessionId, accountId, operationId))
    .filter(item => item.state === 'pending');
  if (pending.length === 0) return { sent: 0 };

  let installationId: string;
  let current = context;
  try {
    current = await confirmSession(sessionId);
    const device = await registerCurrentMobileDevice(current, { signal });
    await confirmSession(sessionId);
    installationId = device.installationId;
  } catch (error) {
    const issue = await rejectIfRevoked(current, error);
    return issue === 'retry' ? { sent: 0, issue: asMobileServiceError(error), renewed: true } : { sent: 0, issue };
  }

  let sent = 0;
  for (const item of pending) {
    try {
      current = await confirmSession(sessionId);
      const sending = current;
      await createMobileAgentApiClient({
        getAccessToken: () => sending.accessToken,
      }).reportRampIncident(
        operationId, item.request, installationId, item.idempotencyKey, { signal });
      await confirmSession(sessionId);
      const updated = await updateRampIncidentOutboxItemIfCurrent(
        sessionId, accountId, operationId, item.idempotencyKey, 'remove');
      if (updated.kind !== 'current') throw new MobileServiceError('cancelled');
      sent += 1;
    } catch (error) {
      const issue = await rejectIfRevoked(current, error);
      if (issue === 'retry') return { sent, issue: asMobileServiceError(error), renewed: true };
      if (
        issue.code === 'not_found' || issue.code === 'conflict' ||
        issue.status === 400 || issue.status === 413 || issue.status === 415
      ) {
        const updated = await updateRampIncidentOutboxItemIfCurrent(
          sessionId, accountId, operationId, item.idempotencyKey, 'block');
        if (updated.kind !== 'current') throw new MobileServiceError('cancelled');
      }
      return { sent, issue };
    }
  }
  return { sent };
}

/** Reads canonical reports, reconciles exact retries, then flushes queued reports in FIFO order. */
export function loadRampIncidentCenter(
  operationId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RampIncidentCenter> {
  return loadIncidentCenter(operationId, options, false);
}

/**
 * When ELEVANT refused the credential and the session renewed it, the center loads once more (S3): the reports keep
 * their keys and the reconciliation drops what ELEVANT already has.
 */
async function loadIncidentCenter(
  operationId: string,
  options: { signal?: AbortSignal },
  retried: boolean,
): Promise<RampIncidentCenter> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  let incidents: readonly ApiRampIncidentResponse[] = [];
  let online = false;
  let issue: MobileServiceError | undefined;
  try {
    const remote = await createMobileAgentApiClient({
      getAccessToken: () => context.accessToken,
    }).getRampIncidents(operationId, { signal: options.signal });
    await confirmSession(context.sessionId);
    incidents = remote.incidents;
    online = true;
    await reconcile(context.sessionId, accountId, operationId, incidents);
  } catch (error) {
    const failure = await rejectIfRevoked(context, error);
    if (failure === 'retry') {
      if (!retried) return loadIncidentCenter(operationId, options, true);
      throw asMobileServiceError(error);
    }
    issue = failure;
    if (issue.code === 'cancelled') throw issue;
  }

  let sent = 0;
  if (online) {
    const flushed = await flush(context, accountId, operationId, options.signal);
    if (flushed.renewed && !retried) return loadIncidentCenter(operationId, options, true);
    sent = flushed.sent;
    issue = flushed.issue;
    if (sent > 0) {
      let reader = context;
      try {
        reader = await confirmSession(context.sessionId);
        const current = reader;
        const updated = await createMobileAgentApiClient({
          getAccessToken: () => current.accessToken,
        }).getRampIncidents(operationId, { signal: options.signal });
        await confirmSession(context.sessionId);
        incidents = updated.incidents;
      } catch (error) {
        const failure = await rejectIfRevoked(reader, error);
        if (failure === 'retry' && !retried) return loadIncidentCenter(operationId, options, true);
        issue = failure === 'retry' ? asMobileServiceError(error) : failure;
      }
    }
  }

  return {
    incidents,
    outbox: await readOutbox(context.sessionId, accountId, operationId),
    online,
    sent,
    ...(issue ? { issue } : {}),
  };
}

/**
 * Sends the incident reports this account left on the device, for every operation (3-I). It runs when the tablet
 * starts, recovers signal or comes back to the foreground, right after the Flight Report queue, so an incident goes
 * out after the start of its operation. Without signal or with a revoked session it stops; it never throws.
 */
export async function flushPendingRampIncidents(): Promise<void> {
  let context;
  try { context = await getMobileSessionRequestContext(); } catch { return; }
  const accountId = context.session.actor.accountId;
  try {
    const listed = await listRampIncidentOutboxOperationsIfCurrent(context.sessionId, accountId);
    if (listed.kind !== 'current') return;
    for (const operationId of listed.operationIds) {
      const waiting = (await readOutbox(context.sessionId, accountId, operationId)).some(item => item.state === 'pending');
      if (!waiting) continue;
      const center = await loadRampIncidentCenter(operationId);
      if (!center.online) return;
    }
  } catch {
    // The reports stay on the device; the next reconnection sends them.
  }
}

/**
 * How many of this operation's incident reports are still on the device, waiting to go out or refused by ELEVANT: the
 * hand-off waits for them (N1). It reads the device with the session's identity only, without signal or a renewal (S3).
 */
export async function countUnsentRampIncidents(operationId: string): Promise<number> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const identity = await getMobileSessionIdentity();
  try {
    return (await readOutbox(identity.sessionId, identity.session.actor.accountId, operationId)).length;
  } catch (error) {
    throw asMobileServiceError(error);
  }
}

/** Reserves the complete report before attempting any network request. */
export async function reserveRampIncident(
  operationId: string,
  request: ReportRampIncidentRequest,
): Promise<readonly RampIncidentOutboxItem[]> {
  if (!isUuid(operationId)) throw new MobileServiceError('request_failed');
  const normalized = parseRequest(request);
  if (!normalized) throw new MobileServiceError('request_failed');
  const context = await getMobileSessionRequestContext();
  try {
    const reserved = await reserveRampIncidentOutboxItemIfCurrent(
      context.sessionId,
      context.session.actor.accountId,
      operationId,
      JSON.stringify({ ...normalized, description: normalized.description.trim() }),
    );
    if (reserved.kind !== 'current') throw new MobileServiceError('cancelled');
    return parseOutbox(reserved.items);
  } catch (error) {
    throw asMobileServiceError(error);
  }
}
