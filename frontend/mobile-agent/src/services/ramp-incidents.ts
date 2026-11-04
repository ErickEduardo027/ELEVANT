import type {
  RampIncidentResponse as ApiRampIncidentResponse,
  ReportRampIncidentRequest as ApiReportRampIncidentRequest,
} from '@elevant/api-client';
import { isIataDelayCode } from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  readRampIncidentOutboxIfCurrent,
  reserveRampIncidentOutboxItemIfCurrent,
  updateRampIncidentOutboxItemIfCurrent,
  type StoredRampIncidentOutboxItem,
} from '../storage/mobile-session';
import {
  getMobileSessionRequestContext,
  MobileServiceError,
  rejectMobileSessionRequest,
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

async function rejectIfRevoked(sessionId: string, error: unknown): Promise<MobileServiceError> {
  const issue = asMobileServiceError(error);
  if (issue.code === 'unauthenticated' || issue.code === 'forbidden') {
    const cleared = await rejectMobileSessionRequest(sessionId);
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

async function flush(
  sessionId: string,
  accountId: string,
  operationId: string,
  signal?: AbortSignal,
): Promise<{ sent: number; issue?: MobileServiceError }> {
  const pending = (await readOutbox(sessionId, accountId, operationId))
    .filter(item => item.state === 'pending');
  if (pending.length === 0) return { sent: 0 };

  let installationId: string;
  try {
    const current = await confirmSession(sessionId);
    const device = await registerCurrentMobileDevice(
      { accessToken: current.accessToken }, { signal });
    await confirmSession(sessionId);
    installationId = device.installationId;
  } catch (error) {
    return { sent: 0, issue: await rejectIfRevoked(sessionId, error) };
  }

  let sent = 0;
  for (const item of pending) {
    try {
      const current = await confirmSession(sessionId);
      await createMobileAgentApiClient({
        getAccessToken: () => current.accessToken,
      }).reportRampIncident(
        operationId, item.request, installationId, item.idempotencyKey, { signal });
      await confirmSession(sessionId);
      const updated = await updateRampIncidentOutboxItemIfCurrent(
        sessionId, accountId, operationId, item.idempotencyKey, 'remove');
      if (updated.kind !== 'current') throw new MobileServiceError('cancelled');
      sent += 1;
    } catch (error) {
      const issue = await rejectIfRevoked(sessionId, error);
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
export async function loadRampIncidentCenter(
  operationId: string,
  options: { signal?: AbortSignal } = {},
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
    issue = await rejectIfRevoked(context.sessionId, error);
    if (issue.code === 'cancelled') throw issue;
  }

  let sent = 0;
  if (online) {
    const flushed = await flush(context.sessionId, accountId, operationId, options.signal);
    sent = flushed.sent;
    issue = flushed.issue;
    if (sent > 0) {
      try {
        const current = await confirmSession(context.sessionId);
        const updated = await createMobileAgentApiClient({
          getAccessToken: () => current.accessToken,
        }).getRampIncidents(operationId, { signal: options.signal });
        await confirmSession(context.sessionId);
        incidents = updated.incidents;
      } catch (error) {
        issue = await rejectIfRevoked(context.sessionId, error);
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
