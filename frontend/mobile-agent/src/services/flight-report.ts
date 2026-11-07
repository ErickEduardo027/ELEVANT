import * as Crypto from 'expo-crypto';
import type {
  OperationDocumentKind,
  OperationDocumentsResponse,
  OperationSignatureRole,
  RampCharterResponse,
  RampExecutionResponse,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  enqueueFlightReportCommand,
  readFlightReportOutbox,
  updateFlightReportItem,
  type FlightReportCommand,
  type FlightReportOutboxItem,
} from '../synchronization/flight-report-outbox';
import { forgetWalkaroundPhoto, keepWalkaroundPhoto, readWalkaroundPhoto } from '../storage/walkaround-photos';
import { getMobileSessionRequestContext, rejectMobileSessionRequest } from './mobile-auth';
import { registerCurrentMobileDevice } from './mobile-device';
import { asMobileServiceError, MobileServiceError } from './mobile-service-error';

export type FlightReportSnapshot = Readonly<{
  items: readonly FlightReportOutboxItem[];
  syncing: boolean;
  /** Last server answer per operation, so the screen shows confirmed data before re-reading. */
  confirmed: Readonly<Record<string, RampExecutionResponse>>;
  /** Last forms read or written per operation (ADR-0032). */
  documents: Readonly<Record<string, OperationDocumentsResponse>>;
  /** Last charter read or written per operation (ADR-0033). */
  charters: Readonly<Record<string, RampCharterResponse>>;
  issue?: MobileServiceError;
}>;

type Listener = (snapshot: FlightReportSnapshot) => void;
const listeners = new Set<Listener>();
let snapshot: FlightReportSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {} };
let running: Promise<void> | null = null;
let again = false;

function publish(change: Partial<FlightReportSnapshot>) {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener(snapshot);
}

/** The queue and its sync state; the listener gets the current value at once. */
export function subscribeFlightReport(listener: Listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => { listeners.delete(listener); };
}

export async function refreshFlightReportQueue() {
  const context = await getMobileSessionRequestContext();
  publish({ items: await readFlightReportOutbox(context.session.actor.accountId) });
}

async function enqueue(command: FlightReportCommand) {
  const context = await getMobileSessionRequestContext();
  const items = await enqueueFlightReportCommand(context.session.actor.accountId, command, Crypto.randomUUID());
  publish({ items });
  void flushFlightReport();
}

/** «Ahora» on a milestone: saved on the device at once, sent when there is signal (ADR-0031). */
export const recordMilestone = (operationId: string, code: string, occurredAt: Date) =>
  enqueue({ kind: 'milestone', operationId, code, occurredAt: occurredAt.toISOString() });

export const saveFlightData = (operationId: string, data: Omit<Extract<FlightReportCommand, { kind: 'flightData' }>,
  'kind' | 'operationId'>) => enqueue({ kind: 'flightData', operationId, ...data });

/** Reads the forms of the operation; without signal the last copy stays on screen. */
export async function loadOperationDocuments(operationId: string): Promise<OperationDocumentsResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const documents = await createMobileAgentApiClient({ getAccessToken: () => context.accessToken })
      .getRampOperationDocuments(operationId);
    publish({ documents: { ...snapshot.documents, [operationId]: documents } });
    return documents;
  } catch (error) {
    throw await revoked(context.sessionId, error);
  }
}

/**
 * A signature drawn on the tablet against the content the signer read. Saved on the device and
 * sent with signal; if the form changed meanwhile the server refuses it and it waits in
 * «Sincronización» to be signed again.
 */
export const signDocument = (operationId: string, documentKind: OperationDocumentKind, role: OperationSignatureRole,
  signerName: string, documentSha256: string, strokes: readonly (readonly number[])[], signerIdentification?: string) =>
  enqueue({ kind: 'signature', operationId, documentKind, role, signerName, documentSha256, strokes,
    ...(signerIdentification ? { signerIdentification } : {}) });

/** The charter of the operation: carrier data and the services it can add at the base tariff (ADR-0033). */
export async function loadCharter(operationId: string): Promise<RampCharterResponse> {
  const context = await getMobileSessionRequestContext();
  try {
    const charter = await createMobileAgentApiClient({ getAccessToken: () => context.accessToken }).getRampCharter(operationId);
    publish({ charters: { ...snapshot.charters, [operationId]: charter } });
    return charter;
  } catch (error) {
    throw await revoked(context.sessionId, error);
  }
}

/** A service the carrier asks for, priced by Finance's base tariff; saved on the device first. */
export const addCharterService = (operationId: string, serviceDefinitionId: string, quantity: number) =>
  enqueue({ kind: 'charterService', operationId, serviceDefinitionId, quantity });

export const saveCharterDetails = (operationId: string, carrierAddress: string | null, chargesPayableBy: string | null) =>
  enqueue({ kind: 'charterDetails', operationId, carrierAddress, chargesPayableBy });

/** A damage marked on the silhouette, with its photo kept on the device until it is sent. */
export async function markDamage(operationId: string, mark: Readonly<{ x: number; y: number; note: string }>,
  photo?: Readonly<{ uri: string; contentType: 'image/jpeg' | 'image/png' }>) {
  const markId = Crypto.randomUUID();
  const fileUri = photo ? keepWalkaroundPhoto(photo.uri, markId, photo.contentType) : null;
  await enqueue({ kind: 'damageMark', operationId, markId, x: mark.x, y: mark.y, note: mark.note.trim(),
    reportedAt: new Date().toISOString() });
  if (photo && fileUri) await enqueue({ kind: 'damagePhoto', operationId, markId, fileUri, contentType: photo.contentType });
  return markId;
}

/** Sends pending commands in order; a single run at a time, re-run if something arrived meanwhile. */
export function flushFlightReport(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      await flushOnce();
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

async function flushOnce() {
  let context;
  try { context = await getMobileSessionRequestContext(); } catch { return; }
  const accountId = context.session.actor.accountId;
  const pending = (await readFlightReportOutbox(accountId)).filter(item => item.state === 'pending');
  if (pending.length === 0) { publish({ syncing: false, issue: undefined }); return; }
  publish({ syncing: true });
  let installationId: string;
  try {
    installationId = (await registerCurrentMobileDevice({ accessToken: context.accessToken })).installationId;
  } catch (error) {
    publish({ syncing: false, issue: await revoked(context.sessionId, error) });
    return;
  }
  const client = createMobileAgentApiClient({ getAccessToken: () => context.accessToken });
  for (const item of pending) {
    try {
      const command = item.command;
      if (command.kind === 'milestone' || command.kind === 'flightData') {
        const result = command.kind === 'milestone'
          ? await client.recordRampMilestone(command.operationId, command.code, command.occurredAt, installationId,
            item.idempotencyKey)
          : await client.updateRampFlightData(command.operationId, {
            passengersIn: command.passengersIn, passengersOut: command.passengersOut, mtowKg: command.mtowKg,
            aircraftRegistration: command.aircraftRegistration,
            // 3-B: only a chosen type travels, so a command without it keeps the body (and the hash) of older versions.
            ...(command.aircraftTypeId ? { aircraftTypeId: command.aircraftTypeId } : {}) },
            installationId, item.idempotencyKey);
        const items = await updateFlightReportItem(accountId, item.idempotencyKey, 'remove');
        publish({ items, confirmed: { ...snapshot.confirmed, [command.operationId]: result } });
        continue;
      }
      if (command.kind === 'charterService' || command.kind === 'charterDetails') {
        const charter = command.kind === 'charterService'
          ? await client.addRampCharterService(command.operationId, { serviceDefinitionId: command.serviceDefinitionId,
            quantity: command.quantity }, installationId, item.idempotencyKey)
          : await client.updateRampCharterDetails(command.operationId, { carrierAddress: command.carrierAddress,
            chargesPayableBy: command.chargesPayableBy }, installationId, item.idempotencyKey);
        const items = await updateFlightReportItem(accountId, item.idempotencyKey, 'remove');
        publish({ items, charters: { ...snapshot.charters, [command.operationId]: charter } });
        continue;
      }
      const documents = command.kind === 'signature'
        ? await client.signRampOperationDocument(command.operationId, command.documentKind as OperationDocumentKind,
          command.role as OperationSignatureRole, { signerName: command.signerName, documentSha256: command.documentSha256,
            strokes: command.strokes, ...(command.signerIdentification ? { signerIdentification: command.signerIdentification } : {}) },
          installationId, item.idempotencyKey)
        : command.kind === 'damageMark'
          ? await client.recordRampDamageMark(command.operationId, command.markId, { x: command.x, y: command.y,
            note: command.note, reportedAt: command.reportedAt }, installationId, item.idempotencyKey)
          : await client.attachRampDamagePhoto(command.operationId, command.markId,
            await readWalkaroundPhoto(command.fileUri), command.contentType, installationId);
      if (command.kind === 'damagePhoto') forgetWalkaroundPhoto(command.fileUri);
      const items = await updateFlightReportItem(accountId, item.idempotencyKey, 'remove');
      publish({ items, documents: { ...snapshot.documents, [command.operationId]: documents } });
    } catch (error) {
      const issue = await revoked(context.sessionId, error);
      // The server answered «no» (closed operation, impossible time): keep it visible to review, never retry blindly.
      const rejected = issue.code === 'not_found' || issue.code === 'conflict' || issue.status === 400;
      const items = await updateFlightReportItem(accountId, item.idempotencyKey, rejected ? 'block' : 'attempt',
        issue.message);
      publish({ items, syncing: false, issue });
      if (!rejected) return;
    }
  }
  publish({ syncing: false, issue: undefined });
}

async function revoked(sessionId: string, error: unknown) {
  const issue = asMobileServiceError(error);
  if (issue.code === 'unauthenticated' || issue.code === 'forbidden') await rejectMobileSessionRequest(sessionId);
  return issue;
}

/** The agent discards a command the server rejected, after reviewing it in «Sincronización». */
export async function discardFlightReportItem(idempotencyKey: string) {
  const context = await getMobileSessionRequestContext();
  const discarded = snapshot.items.find(item => item.idempotencyKey === idempotencyKey);
  if (discarded?.command.kind === 'damagePhoto') forgetWalkaroundPhoto(discarded.command.fileUri);
  publish({ items: await updateFlightReportItem(context.session.actor.accountId, idempotencyKey, 'remove') });
}

export async function retryFlightReportItem(idempotencyKey: string) {
  const context = await getMobileSessionRequestContext();
  publish({ items: await updateFlightReportItem(context.session.actor.accountId, idempotencyKey, 'retry') });
  await flushFlightReport();
}
