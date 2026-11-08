import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent queue of the tablet's commands (ADR-0031, phase 3 block C). A tap is saved on the device first and sent
 * later, in order, with its stable idempotency key: signal on the ramp is poor and a lost timestamp cannot be typed
 * again. The queue belongs to one account; local data is only a cache.
 * Signatures and walk-around marks (ADR-0032) travel in the same ordered queue: a photo always follows its mark, and a
 * signature carries the content hash the signer saw. A charter (ADR-0033) adds its services and the carrier's data
 * through the same queue; the signer's ID of the charter request stays on the device only until it is sent.
 * Since 3-I the start, the service transitions, the charges, the checklist and the chat travel here too, first in
 * first out per operation: the start and the services carry the tapped time (null for a command an older version
 * reserved, so its body and receipt hash stay the first ones). Fields marked «display only» help «Sincronización»
 * describe a command and never travel to ELEVANT.
 */
export type FlightReportCommand =
  | Readonly<{
    kind: 'milestone'; operationId: string; code: string; occurredAt: string;
    /** Display only: the station's time zone, so the queue shows the station's local time. */
    timeZone?: string;
  }>
  | Readonly<{
    kind: 'flightData'; operationId: string; passengersIn: number | null; passengersOut: number | null;
    mtowKg: number | null; aircraftRegistration: string | null;
    /**
     * The aircraft type the agent sees on the ramp (3-B), typed once. Absent or null keeps the current one: an item an
     * older version of the app queued has no such field and is still read, sent and replayed with its first hash.
     */
    aircraftTypeId?: string | null;
  }>
  | Readonly<{
    kind: 'signature'; operationId: string; documentKind: string; role: string; signerName: string;
    documentSha256: string; strokes: readonly (readonly number[])[]; signerIdentification?: string | null;
  }>
  | Readonly<{ kind: 'charterService'; operationId: string; serviceDefinitionId: string; quantity: number }>
  | Readonly<{ kind: 'charterDetails'; operationId: string; carrierAddress: string | null; chargesPayableBy: string | null }>
  | Readonly<{ kind: 'damageMark'; operationId: string; markId: string; x: number; y: number; note: string; reportedAt: string }>
  | Readonly<{ kind: 'damagePhoto'; operationId: string; markId: string; fileUri: string; contentType: 'image/jpeg' | 'image/png' }>
  | Readonly<{
    kind: 'start'; operationId: string;
    /** The tapped time; null for a start an older version reserved, which travels without a body as it first did. */
    occurredAt: string | null;
    /** Display only. */
    timeZone?: string;
  }>
  | Readonly<{
    kind: 'serviceTransition'; operationId: string; serviceId: string;
    targetStatus: 'InProgress' | 'Completed' | 'NotPerformed' | 'Exception';
    executedQuantity: number | null; note: string | null;
    /** The tapped time; null for a transition an older version reserved, which keeps its first body. */
    occurredAt: string | null;
    /** Display only. */
    serviceName?: string;
    /** Display only. */
    timeZone?: string;
  }>
  | Readonly<{
    kind: 'serviceCharge'; operationId: string; serviceId: string; chargeId: string; action: 'Apply' | 'Remove';
    /** Display only. */
    chargeName?: string;
  }>
  | Readonly<{
    kind: 'checklistSubmit'; operationId: string; checklistId: string;
    answers: readonly Readonly<{ itemId: string; value: string; note?: string }>[];
  }>
  | Readonly<{ kind: 'chatMessage'; operationId: string; content: string }>;

export type FlightReportCommandKind = FlightReportCommand['kind'];

const KINDS = new Set<string>(['milestone', 'flightData', 'signature', 'damageMark', 'damagePhoto', 'charterService',
  'charterDetails', 'start', 'serviceTransition', 'serviceCharge', 'checklistSubmit', 'chatMessage']);

/** Commands that are each one fact in their order: a newer one never replaces an unsent one. */
const ORDERED_KINDS = new Set<string>(['start', 'serviceTransition', 'serviceCharge', 'checklistSubmit', 'chatMessage']);

export type FlightReportOutboxItem = Readonly<{
  idempotencyKey: string;
  command: FlightReportCommand;
  createdAt: string;
  state: 'pending' | 'blocked';
  attempts: number;
  lastError?: string;
  /** The Problem Details code of the server's refusal or of the last failure, so the screens explain it. */
  lastCode?: string;
}>;

export const FLIGHT_REPORT_OUTBOX_LIMIT = 200;
const KEY_PREFIX = 'elevant.flightReportOutbox.v1.';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyFor = (accountId: string) => `${KEY_PREFIX}${accountId.toLowerCase()}`;

/** The account a stored queue belongs to, or null for another key (3-N12 counts the queues of every account). */
export function flightReportOutboxAccount(storageKey: string): string | null {
  if (!storageKey.startsWith(KEY_PREFIX)) return null;
  const accountId = storageKey.slice(KEY_PREFIX.length);
  return uuid.test(accountId) ? accountId.toLowerCase() : null;
}

function isItem(value: unknown): value is FlightReportOutboxItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const command = item.command as Record<string, unknown> | undefined;
  return typeof item.idempotencyKey === 'string' && uuid.test(item.idempotencyKey) &&
    (item.state === 'pending' || item.state === 'blocked') && typeof item.attempts === 'number' &&
    typeof item.createdAt === 'string' && typeof command === 'object' && command !== null &&
    typeof command.operationId === 'string' && uuid.test(command.operationId) &&
    typeof command.kind === 'string' && KINDS.has(command.kind);
}

/** The items of a stored queue as written, or none when it cannot be read. */
export function parseFlightReportOutbox(raw: string | null): readonly FlightReportOutboxItem[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

export async function readFlightReportOutbox(accountId: string): Promise<readonly FlightReportOutboxItem[]> {
  return parseFlightReportOutbox(await AsyncStorage.getItem(keyFor(accountId)));
}

async function write(accountId: string, items: readonly FlightReportOutboxItem[]) {
  if (items.length === 0) await AsyncStorage.removeItem(keyFor(accountId));
  else await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(items));
}

const sameKey = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Adds a command. A newer tap of the same milestone, or newer flight data, replaces a pending one that has not been
 * sent: only the agent's last intent travels. The start, the services, the charges, the checklist and the chat are
 * never merged: each one is sent in its order. The same key again (a legacy reservation imported twice) is the same
 * command. With `replaces` the new command takes the place of that item in the queue (a start refused by ELEVANT
 * and tapped again keeps its turn before the milestones that wait for it).
 */
export async function enqueueFlightReportCommand(accountId: string, command: FlightReportCommand,
  idempotencyKey: string, now = new Date(), replaces?: string): Promise<readonly FlightReportOutboxItem[]> {
  if (!uuid.test(idempotencyKey)) throw new TypeError('The idempotency key is invalid.');
  const current = await readFlightReportOutbox(accountId);
  if (current.some(item => sameKey(item.idempotencyKey, idempotencyKey))) return current;
  const item = { idempotencyKey, command, createdAt: now.toISOString(), state: 'pending' as const, attempts: 0 };
  const position = replaces ? current.findIndex(candidate => sameKey(candidate.idempotencyKey, replaces)) : -1;
  if (position >= 0) {
    const next = [...current.slice(0, position), item, ...current.slice(position + 1)];
    await write(accountId, next);
    return next;
  }
  const items = current.filter(candidate => candidate.state === 'blocked' || !sameTarget(candidate.command, command));
  if (items.length >= FLIGHT_REPORT_OUTBOX_LIMIT) throw new RangeError('The Flight Report queue is full.');
  const next = [...items, item];
  await write(accountId, next);
  return next;
}

function sameTarget(left: FlightReportCommand, right: FlightReportCommand) {
  if (!sameKey(left.operationId, right.operationId) || left.kind !== right.kind) return false;
  if (ORDERED_KINDS.has(left.kind)) return false;
  if (left.kind === 'milestone' && right.kind === 'milestone') return left.code === right.code;
  if (left.kind === 'signature' && right.kind === 'signature')
    return left.documentKind === right.documentKind && left.role === right.role;
  if ((left.kind === 'damageMark' && right.kind === 'damageMark') || (left.kind === 'damagePhoto' && right.kind === 'damagePhoto'))
    return left.markId === right.markId;
  if (left.kind === 'charterService' && right.kind === 'charterService')
    return left.serviceDefinitionId === right.serviceDefinitionId;
  return true;
}

export async function updateFlightReportItem(accountId: string, idempotencyKey: string,
  change: 'remove' | 'block' | 'retry' | 'attempt', error?: string, code?: string): Promise<readonly FlightReportOutboxItem[]> {
  const items = await readFlightReportOutbox(accountId);
  const next = change === 'remove'
    ? items.filter(item => !sameKey(item.idempotencyKey, idempotencyKey))
    : items.map(item => !sameKey(item.idempotencyKey, idempotencyKey) ? item : {
      ...item,
      state: change === 'block' ? 'blocked' as const : change === 'retry' ? 'pending' as const : item.state,
      attempts: change === 'attempt' ? item.attempts + 1 : item.attempts,
      ...(error ? { lastError: error } : {}),
      ...(code ? { lastCode: code } : {}),
    });
  await write(accountId, next);
  return next;
}

export type OperationQueue = Readonly<{
  /** The last intent per milestone, saved or refused. */
  milestones: ReadonlyMap<string, FlightReportOutboxItem>;
  flightData?: FlightReportOutboxItem;
  start?: FlightReportOutboxItem;
  /** The transitions of each service still on the device, in their order. */
  services: ReadonlyMap<string, readonly FlightReportOutboxItem[]>;
  charges: readonly FlightReportOutboxItem[];
  checklists: readonly FlightReportOutboxItem[];
  messages: readonly FlightReportOutboxItem[];
  /** What still has to reach ELEVANT and what ELEVANT refused, for the hand-off (3-N06). */
  pending: number;
  blocked: number;
}>;

/** The queue as the operation screen shows it: the last intent per milestone or flight data, and what is still due. */
export function pendingFor(items: readonly FlightReportOutboxItem[], operationId: string): OperationQueue {
  const milestones = new Map<string, FlightReportOutboxItem>();
  let flightData: FlightReportOutboxItem | undefined;
  let start: FlightReportOutboxItem | undefined;
  const services = new Map<string, FlightReportOutboxItem[]>();
  const charges: FlightReportOutboxItem[] = [];
  const checklists: FlightReportOutboxItem[] = [];
  const messages: FlightReportOutboxItem[] = [];
  let pending = 0;
  let blocked = 0;
  for (const item of items) {
    if (!sameKey(item.command.operationId, operationId)) continue;
    if (item.state === 'blocked') blocked += 1; else pending += 1;
    const command = item.command;
    if (command.kind === 'milestone') milestones.set(command.code, item);
    else if (command.kind === 'flightData') flightData = item;
    else if (command.kind === 'start') start = item;
    else if (command.kind === 'serviceTransition')
      services.set(command.serviceId.toLowerCase(), [...(services.get(command.serviceId.toLowerCase()) ?? []), item]);
    else if (command.kind === 'serviceCharge') charges.push(item);
    else if (command.kind === 'checklistSubmit') checklists.push(item);
    else if (command.kind === 'chatMessage') messages.push(item);
  }
  return { milestones, flightData, start, services, charges, checklists, messages, pending, blocked };
}
