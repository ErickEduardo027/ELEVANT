import * as Crypto from 'expo-crypto';
import type {
  OperationDocumentKind,
  OperationDocumentsResponse,
  OperationSignatureRole,
  RampCharterResponse,
  RampChecklistAnswerRequest,
  RampExecutionResponse,
  TransitionRampOperationServiceRequest,
} from '@elevant/api-client';
import { createMobileAgentApiClient } from '../config/elevant-api';
import {
  enqueueFlightReportCommand,
  pendingFor,
  readFlightReportOutbox,
  updateFlightReportItem,
  type FlightReportCommand,
  type FlightReportOutboxItem,
  type OperationQueue,
} from '../synchronization/flight-report-outbox';
import { serverNow } from '../synchronization/server-clock';
import { forgetWalkaroundPhoto, keepWalkaroundPhoto, readWalkaroundPhoto } from '../storage/walkaround-photos';
import {
  readLegacyRampCommandsIfCurrent,
  removeLegacyRampCommandIfCurrent,
  removeRampChecklistDraftIfCurrent,
  type LegacyRampCommand,
} from '../storage/mobile-session';
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
  /**
   * How many start, service, charge and checklist commands ELEVANT confirmed per operation since the app started
   * (3-I): a screen re-reads the operation when its number moves.
   */
  revisions: Readonly<Record<string, number>>;
  issue?: MobileServiceError;
}>;

type Listener = (snapshot: FlightReportSnapshot) => void;
const listeners = new Set<Listener>();
let snapshot: FlightReportSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };
let running: Promise<void> | null = null;
let again = false;
/** Why the last pass of the queue stopped before its end (no signal, a revoked session…), if it did. */
let lastStop: MobileServiceError | undefined;

/** What happened to a command in the last passes, for the screen that waits for it (3-I). */
type CommandOutcome =
  | Readonly<{ state: 'sent'; result: unknown }>
  | Readonly<{ state: 'blocked'; issue: MobileServiceError }>
  | Readonly<{ state: 'waiting'; issue?: MobileServiceError }>;
const outcomes = new Map<string, CommandOutcome>();
const MAXIMUM_OUTCOMES = 200;
/** Accounts whose commands reserved by an older version were already moved into the queue. */
const importedAccounts = new Set<string>();

function publish(change: Partial<FlightReportSnapshot>) {
  snapshot = { ...snapshot, ...change };
  for (const listener of listeners) listener(snapshot);
}

function remember(idempotencyKey: string, outcome: CommandOutcome) {
  const key = idempotencyKey.toLowerCase();
  outcomes.delete(key);
  outcomes.set(key, outcome);
  while (outcomes.size > MAXIMUM_OUTCOMES) outcomes.delete(outcomes.keys().next().value as string);
}

/** The queue and its sync state; the listener gets the current value at once. */
export function subscribeFlightReport(listener: Listener) {
  listeners.add(listener);
  listener(snapshot);
  return () => { listeners.delete(listener); };
}

/** The current snapshot, for code that cannot subscribe (the hand-off check, 3-N06). */
export function currentFlightReportSnapshot() {
  return snapshot;
}

export async function refreshFlightReportQueue() {
  const context = await getMobileSessionRequestContext();
  publish({ items: await readFlightReportOutbox(context.session.actor.accountId) });
}

/** What the queue of this account holds for one operation, read from the device. */
export async function readOperationQueue(operationId: string): Promise<OperationQueue> {
  const context = await getMobileSessionRequestContext();
  const items = await readFlightReportOutbox(context.session.actor.accountId);
  publish({ items });
  return pendingFor(items, operationId);
}

async function enqueue(command: FlightReportCommand) {
  const context = await getMobileSessionRequestContext();
  const items = await enqueueFlightReportCommand(context.session.actor.accountId, command, Crypto.randomUUID(),
    serverNow());
  publish({ items });
  void flushFlightReport();
}

export type QueuedSend =
  | Readonly<{ state: 'sent'; result: unknown; idempotencyKey: string }>
  | Readonly<{ state: 'queued'; idempotencyKey: string; issue?: MobileServiceError }>;

const sessionFailure = (issue: MobileServiceError) =>
  issue.code === 'unauthenticated' || issue.code === 'forbidden' || issue.code === 'session_expired';

/**
 * Saves a command on the device and sends the queue at once (3-I). Answers ELEVANT's result when it arrived, or that
 * the command waits on the device (no signal, ELEVANT unavailable, an earlier command of the operation still waiting);
 * it then goes out on its own. A refusal is thrown as the error its Problem Details code explains, and with
 * `discardRefused` it leaves the queue: the agent saw it on the screen that sent it. A revoked session is thrown
 * as well. With `idempotencyKey` a command already in the queue is sent again, never a second one.
 */
export async function sendFlightReportCommand(command: FlightReportCommand, options: Readonly<{
  idempotencyKey?: string; replaces?: string; discardRefused?: boolean;
}> = {}): Promise<QueuedSend> {
  const context = await getMobileSessionRequestContext();
  const accountId = context.session.actor.accountId;
  const idempotencyKey = (options.idempotencyKey ?? Crypto.randomUUID()).toLowerCase();
  publish({ items: await enqueueFlightReportCommand(accountId, command, idempotencyKey, serverNow(), options.replaces) });
  outcomes.delete(idempotencyKey);
  await flushFlightReport();
  const outcome = outcomes.get(idempotencyKey);
  outcomes.delete(idempotencyKey);
  if (outcome?.state === 'sent') return { state: 'sent', result: outcome.result, idempotencyKey };
  if (outcome?.state === 'blocked') {
    if (options.discardRefused) publish({ items: await updateFlightReportItem(accountId, idempotencyKey, 'remove') });
    throw outcome.issue;
  }
  const issue = outcome?.issue ?? lastStop;
  if (issue && sessionFailure(issue)) throw issue;
  return { state: 'queued', idempotencyKey, ...(issue ? { issue } : {}) };
}

/** «Ahora» on a milestone: saved on the device at once, sent when there is signal (ADR-0031). */
export const recordMilestone = (operationId: string, code: string, occurredAt: Date, timeZone?: string) =>
  enqueue({ kind: 'milestone', operationId, code, occurredAt: occurredAt.toISOString(), ...(timeZone ? { timeZone } : {}) });

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
  // 3-N18: the tablet's clock corrected by ELEVANT's, so a tablet that runs ahead is not refused.
  await enqueue({ kind: 'damageMark', operationId, markId, x: mark.x, y: mark.y, note: mark.note.trim(),
    reportedAt: serverNow().toISOString() });
  if (photo && fileUri) await enqueue({ kind: 'damagePhoto', operationId, markId, fileUri, contentType: photo.contentType });
  return markId;
}

/** Sends pending commands in order; a single run at a time, re-run if something arrived meanwhile. */
export function flushFlightReport(): Promise<void> {
  if (running) { again = true; return running; }
  running = (async () => {
    do {
      again = false;
      lastStop = await flushOnce();
    } while (again);
  })().finally(() => { running = null; });
  return running;
}

/** Without signal, or once the session is gone, nothing else can be sent in this pass. */
function stopsTheQueue(issue: MobileServiceError) {
  return issue.code === 'network_unavailable' || issue.code === 'request_timeout' || sessionFailure(issue) ||
    issue.code === 'cancelled' || issue.code === 'device_conflict' || issue.code === 'device_in_use' ||
    issue.code === 'device_revoked' || issue.code === 'storage_unavailable';
}

/** ELEVANT answered «no» (closed operation, impossible time, malformed command): never retried blindly. */
function isRefusal(issue: MobileServiceError) {
  if (issue.code === 'not_found' || issue.code === 'conflict') return true;
  const status = issue.status;
  return status !== undefined && status >= 400 && status < 500 && status !== 401 && status !== 403 && status !== 408 &&
    status !== 429;
}

/** The text «Sincronización» shows for a command ELEVANT refused (3-I, 3-F: a released assignment). */
function refusalMessage(issue: MobileServiceError) {
  if (issue.code === 'not_found') return 'Se liberó tu asignación o la operación ya no está a tu cargo.';
  return issue.message;
}

const bump = (operationId: string) => ({
  revisions: { ...snapshot.revisions, [operationId]: (snapshot.revisions[operationId] ?? 0) + 1 },
});

type ApiClient = ReturnType<typeof createMobileAgentApiClient>;
type SendContext = Readonly<{ client: ApiClient; installationId: string; sessionId: string; accountId: string }>;

/** Sends one command; answers ELEVANT's result and what the snapshot learns from it. */
async function send(item: FlightReportOutboxItem, { client, installationId, sessionId, accountId }: SendContext):
  Promise<Readonly<{ result: unknown; change: Partial<FlightReportSnapshot> }>> {
  const command = item.command;
  const key = item.idempotencyKey;
  switch (command.kind) {
    case 'milestone': {
      const result = await client.recordRampMilestone(command.operationId, command.code, command.occurredAt,
        installationId, key);
      return { result, change: { confirmed: { ...snapshot.confirmed, [command.operationId]: result } } };
    }
    case 'flightData': {
      const result = await client.updateRampFlightData(command.operationId, {
        passengersIn: command.passengersIn, passengersOut: command.passengersOut, mtowKg: command.mtowKg,
        aircraftRegistration: command.aircraftRegistration,
        // 3-B: only a chosen type travels, so a command without it keeps the body (and the hash) of older versions.
        ...(command.aircraftTypeId ? { aircraftTypeId: command.aircraftTypeId } : {}) },
      installationId, key);
      return { result, change: { confirmed: { ...snapshot.confirmed, [command.operationId]: result } } };
    }
    case 'charterService':
    case 'charterDetails': {
      const charter = command.kind === 'charterService'
        ? await client.addRampCharterService(command.operationId, { serviceDefinitionId: command.serviceDefinitionId,
          quantity: command.quantity }, installationId, key)
        : await client.updateRampCharterDetails(command.operationId, { carrierAddress: command.carrierAddress,
          chargesPayableBy: command.chargesPayableBy }, installationId, key);
      return { result: charter, change: { charters: { ...snapshot.charters, [command.operationId]: charter } } };
    }
    case 'signature':
    case 'damageMark':
    case 'damagePhoto': {
      const documents = command.kind === 'signature'
        ? await client.signRampOperationDocument(command.operationId, command.documentKind as OperationDocumentKind,
          command.role as OperationSignatureRole, { signerName: command.signerName, documentSha256: command.documentSha256,
            strokes: command.strokes, ...(command.signerIdentification ? { signerIdentification: command.signerIdentification } : {}) },
          installationId, key)
        : command.kind === 'damageMark'
          ? await client.recordRampDamageMark(command.operationId, command.markId, { x: command.x, y: command.y,
            note: command.note, reportedAt: command.reportedAt }, installationId, key)
          : await client.attachRampDamagePhoto(command.operationId, command.markId,
            await readWalkaroundPhoto(command.fileUri), command.contentType, installationId);
      if (command.kind === 'damagePhoto') forgetWalkaroundPhoto(command.fileUri);
      return { result: documents, change: { documents: { ...snapshot.documents, [command.operationId]: documents } } };
    }
    case 'start': {
      // A start an older version reserved has no tapped time: it travels without a body, as it first did.
      const result = await client.startRampOperation(command.operationId, installationId, key, undefined,
        command.occurredAt ? { startedAt: command.occurredAt } : undefined);
      if (result.operation.id.toLowerCase() !== command.operationId.toLowerCase())
        throw new MobileServiceError('malformed_response');
      return { result, change: bump(command.operationId) };
    }
    case 'serviceTransition': {
      const request: TransitionRampOperationServiceRequest = {
        targetStatus: command.targetStatus,
        ...(command.executedQuantity === null ? {} : { executedQuantity: command.executedQuantity }),
        ...(command.note === null ? {} : { note: command.note }),
        ...(command.occurredAt === null ? {} : { occurredAt: command.occurredAt }),
      };
      const result = await client.transitionRampOperationService(command.operationId, command.serviceId, request,
        installationId, key);
      return { result, change: bump(command.operationId) };
    }
    case 'serviceCharge': {
      const result = await client.applyRampServiceCharge(command.operationId, command.serviceId,
        { chargeId: command.chargeId, action: command.action }, installationId, key);
      return { result, change: bump(command.operationId) };
    }
    case 'checklistSubmit': {
      const result = await client.submitRampOperationChecklist(command.operationId, {
        checklistId: command.checklistId,
        answers: command.answers.map(answer => ({ ...answer }) as RampChecklistAnswerRequest),
      }, installationId, key);
      try {
        await removeRampChecklistDraftIfCurrent(sessionId, accountId, command.operationId, command.checklistId);
      } catch {
        // The draft is a convenience; ELEVANT already holds the answers.
      }
      return { result, change: bump(command.operationId) };
    }
    case 'chatMessage': {
      const result = await client.sendOperationalMessage(command.operationId, { content: command.content }, key,
        installationId);
      return { result, change: {} };
    }
  }
}

/**
 * One pass over the queue, first in first out per operation (3-I): without signal or with a revoked session it stops;
 * a photo ELEVANT cannot store now does not hold anything back; any other failure holds only the rest of its
 * operation (a refused start too, since nothing of the operation can follow it); a refusal waits in
 * «Sincronización» for the agent. Answers why it stopped, if it did.
 */
async function flushOnce(): Promise<MobileServiceError | undefined> {
  let context;
  try { context = await getMobileSessionRequestContext(); } catch (error) { return asMobileServiceError(error); }
  const accountId = context.session.actor.accountId;
  await importLegacyCommands(context.sessionId, accountId);
  const items = await readFlightReportOutbox(accountId);
  if (!items.some(item => item.state === 'pending')) { publish({ items, syncing: false, issue: undefined }); return undefined; }
  publish({ items, syncing: true });
  let installationId: string;
  try {
    installationId = (await registerCurrentMobileDevice({ accessToken: context.accessToken })).installationId;
  } catch (error) {
    const issue = await revoked(context.sessionId, error);
    publish({ syncing: false, issue });
    return issue;
  }
  const sending: SendContext = {
    client: createMobileAgentApiClient({ getAccessToken: () => context.accessToken }),
    installationId, sessionId: context.sessionId, accountId,
  };
  const held = new Map<string, MobileServiceError | undefined>();
  let lastIssue: MobileServiceError | undefined;
  for (const item of items) {
    const operationId = item.command.operationId.toLowerCase();
    if (item.state === 'blocked') {
      if (item.command.kind === 'start' && !held.has(operationId)) held.set(operationId, undefined);
      continue;
    }
    if (held.has(operationId)) {
      remember(item.idempotencyKey, { state: 'waiting', issue: held.get(operationId) });
      continue;
    }
    try {
      const { result, change } = await send(item, sending);
      const next = await updateFlightReportItem(accountId, item.idempotencyKey, 'remove');
      remember(item.idempotencyKey, { state: 'sent', result });
      publish({ items: next, ...change });
    } catch (error) {
      const issue = await revoked(context.sessionId, error);
      lastIssue = issue;
      if (stopsTheQueue(issue)) {
        const next = await updateFlightReportItem(accountId, item.idempotencyKey, 'attempt', issue.message,
          issue.problemCode);
        remember(item.idempotencyKey, { state: 'waiting', issue });
        publish({ items: next, syncing: false, issue });
        return issue;
      }
      if (isRefusal(issue)) {
        const next = await updateFlightReportItem(accountId, item.idempotencyKey, 'block', refusalMessage(issue),
          issue.problemCode);
        remember(item.idempotencyKey, { state: 'blocked', issue });
        if (item.command.kind === 'start') held.set(operationId, issue);
        publish({ items: next, issue });
        continue;
      }
      // ELEVANT could not take it now (5xx, 429, an unreadable answer): it is sent again later.
      const next = await updateFlightReportItem(accountId, item.idempotencyKey, 'attempt', issue.message,
        issue.problemCode);
      remember(item.idempotencyKey, { state: 'waiting', issue });
      if (item.command.kind !== 'damagePhoto') held.set(operationId, issue);
      publish({ items: next, issue });
    }
  }
  publish({ syncing: false, issue: lastIssue });
  return undefined;
}

async function revoked(sessionId: string, error: unknown) {
  const issue = asMobileServiceError(error);
  if (issue.code === 'unauthenticated' || issue.code === 'forbidden') await rejectMobileSessionRequest(sessionId);
  return issue;
}

const SERVICE_TARGETS = new Set(['InProgress', 'Completed', 'NotPerformed', 'Exception']);
const ANSWER_VALUES = new Set(['Ok', 'NotApplicable', 'NotOk']);
const LEGACY_ORDER: Readonly<Record<LegacyRampCommand['kind'], number>> = {
  start: 0, serviceTransition: 1, serviceCharge: 2, checklistSubmit: 3, chatMessage: 4,
};

function parsePayload(payload: string | undefined): Record<string, unknown> | null {
  if (payload === undefined) return null;
  try {
    const value: unknown = JSON.parse(payload);
    return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

/** A reservation of an older version as the queue command that sends exactly the same body. */
export function commandFromLegacy(entry: LegacyRampCommand): FlightReportCommand | null {
  const operationId = entry.operationId;
  if (entry.kind === 'start') return { kind: 'start', operationId, occurredAt: null };
  if (entry.kind === 'chatMessage')
    return entry.payload ? { kind: 'chatMessage', operationId, content: entry.payload } : null;
  const payload = parsePayload(entry.payload);
  if (!payload) return null;
  if (entry.kind === 'serviceTransition') {
    const targetStatus = payload.targetStatus;
    if (!entry.serviceId || typeof targetStatus !== 'string' || !SERVICE_TARGETS.has(targetStatus)) return null;
    return {
      kind: 'serviceTransition', operationId, serviceId: entry.serviceId,
      targetStatus: targetStatus as Extract<FlightReportCommand, { kind: 'serviceTransition' }>['targetStatus'],
      executedQuantity: typeof payload.executedQuantity === 'number' ? payload.executedQuantity : null,
      note: typeof payload.note === 'string' ? payload.note : null, occurredAt: null,
    };
  }
  if (entry.kind === 'serviceCharge') {
    const { chargeId, action } = payload;
    if (!entry.serviceId || typeof chargeId !== 'string' || (action !== 'Apply' && action !== 'Remove')) return null;
    return { kind: 'serviceCharge', operationId, serviceId: entry.serviceId, chargeId, action };
  }
  const { checklistId, answers } = payload;
  if (typeof checklistId !== 'string' || !Array.isArray(answers) || answers.length === 0) return null;
  const parsed: { itemId: string; value: string; note?: string }[] = [];
  for (const answer of answers) {
    if (typeof answer !== 'object' || answer === null) return null;
    const { itemId, value, note } = answer as Record<string, unknown>;
    if (typeof itemId !== 'string' || typeof value !== 'string' || !ANSWER_VALUES.has(value) ||
      (note !== undefined && typeof note !== 'string')) return null;
    parsed.push({ itemId, value, ...(typeof note === 'string' ? { note } : {}) });
  }
  return { kind: 'checklistSubmit', operationId, checklistId, answers: parsed };
}

/**
 * Moves, once per account, the commands an older version reserved in their own keys (the start, the services, the
 * charges, the checklist and the chat) into the queue with the same key and no tapped time, so their bodies and their
 * receipt hashes are the first ones; then forgets the old reservation. It runs before the first pass sends anything.
 */
async function importLegacyCommands(sessionId: string, accountId: string) {
  const account = accountId.toLowerCase();
  if (importedAccounts.has(account)) return;
  try {
    const legacy = await readLegacyRampCommandsIfCurrent(sessionId, accountId);
    if (legacy.kind !== 'current') return;
    const ordered = [...legacy.commands].sort((left, right) => LEGACY_ORDER[left.kind] - LEGACY_ORDER[right.kind] ||
      transitionRank(left) - transitionRank(right));
    for (const entry of ordered) {
      const command = commandFromLegacy(entry);
      if (!command) continue;
      await enqueueFlightReportCommand(accountId, command, entry.idempotencyKey);
      await removeLegacyRampCommandIfCurrent(sessionId, accountId, entry.storageKey, entry.idempotencyKey);
    }
    importedAccounts.add(account);
  } catch {
    // The reservations stay where they are and the next pass tries again.
  }
}

/** An older version reserved one transition per target status: the service's start goes before its result. */
function transitionRank(entry: LegacyRampCommand) {
  if (entry.kind !== 'serviceTransition') return 0;
  return parsePayload(entry.payload)?.targetStatus === 'InProgress' ? 0 : 1;
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

/** Test hook: forgets what the module remembers between tests. */
export function resetFlightReportForTests() {
  snapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };
  outcomes.clear();
  importedAccounts.clear();
  lastStop = undefined;
}
