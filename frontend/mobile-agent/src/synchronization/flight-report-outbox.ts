import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Persistent queue of Flight Report commands (ADR-0031). A tap is saved on the device first and
 * sent later, in order, with its stable idempotency key: signal on the ramp is poor and a lost
 * timestamp cannot be typed again. The queue belongs to one account; local data is only a cache.
 */
export type FlightReportCommand =
  | Readonly<{ kind: 'milestone'; operationId: string; code: string; occurredAt: string }>
  | Readonly<{
    kind: 'flightData'; operationId: string; passengersIn: number | null; passengersOut: number | null;
    mtowKg: number | null; aircraftRegistration: string | null;
  }>;

export type FlightReportOutboxItem = Readonly<{
  idempotencyKey: string;
  command: FlightReportCommand;
  createdAt: string;
  state: 'pending' | 'blocked';
  attempts: number;
  lastError?: string;
}>;

export const FLIGHT_REPORT_OUTBOX_LIMIT = 200;
const KEY_PREFIX = 'elevant.flightReportOutbox.v1.';
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const keyFor = (accountId: string) => `${KEY_PREFIX}${accountId.toLowerCase()}`;

function isItem(value: unknown): value is FlightReportOutboxItem {
  if (typeof value !== 'object' || value === null) return false;
  const item = value as Record<string, unknown>;
  const command = item.command as Record<string, unknown> | undefined;
  return typeof item.idempotencyKey === 'string' && uuid.test(item.idempotencyKey) &&
    typeof item.createdAt === 'string' && (item.state === 'pending' || item.state === 'blocked') &&
    typeof item.attempts === 'number' && typeof command === 'object' && command !== null &&
    typeof command.operationId === 'string' && uuid.test(command.operationId) &&
    (command.kind === 'milestone' || command.kind === 'flightData');
}

export async function readFlightReportOutbox(accountId: string): Promise<readonly FlightReportOutboxItem[]> {
  const raw = await AsyncStorage.getItem(keyFor(accountId));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isItem) : [];
  } catch {
    return [];
  }
}

async function write(accountId: string, items: readonly FlightReportOutboxItem[]) {
  if (items.length === 0) await AsyncStorage.removeItem(keyFor(accountId));
  else await AsyncStorage.setItem(keyFor(accountId), JSON.stringify(items));
}

/**
 * Adds a command. A newer tap of the same milestone, or newer flight data, replaces a pending one
 * that has not been sent: only the agent's last intent travels.
 */
export async function enqueueFlightReportCommand(accountId: string, command: FlightReportCommand,
  idempotencyKey: string, now = new Date()): Promise<readonly FlightReportOutboxItem[]> {
  if (!uuid.test(idempotencyKey)) throw new TypeError('The idempotency key is invalid.');
  const items = (await readFlightReportOutbox(accountId)).filter(item => item.state === 'blocked' ||
    !sameTarget(item.command, command));
  if (items.length >= FLIGHT_REPORT_OUTBOX_LIMIT) throw new RangeError('The Flight Report queue is full.');
  const next = [...items, { idempotencyKey, command, createdAt: now.toISOString(), state: 'pending' as const, attempts: 0 }];
  await write(accountId, next);
  return next;
}

function sameTarget(left: FlightReportCommand, right: FlightReportCommand) {
  if (left.operationId !== right.operationId || left.kind !== right.kind) return false;
  return left.kind !== 'milestone' || right.kind !== 'milestone' || left.code === right.code;
}

export async function updateFlightReportItem(accountId: string, idempotencyKey: string,
  change: 'remove' | 'block' | 'retry' | 'attempt', error?: string): Promise<readonly FlightReportOutboxItem[]> {
  const items = await readFlightReportOutbox(accountId);
  const next = change === 'remove'
    ? items.filter(item => item.idempotencyKey !== idempotencyKey)
    : items.map(item => item.idempotencyKey !== idempotencyKey ? item : {
      ...item,
      state: change === 'block' ? 'blocked' as const : change === 'retry' ? 'pending' as const : item.state,
      attempts: change === 'attempt' ? item.attempts + 1 : item.attempts,
      ...(error ? { lastError: error } : {}),
    });
  await write(accountId, next);
  return next;
}

/** The queue as the operation screen shows it: the last pending intent per milestone or flight data. */
export function pendingFor(items: readonly FlightReportOutboxItem[], operationId: string) {
  const milestones = new Map<string, FlightReportOutboxItem>();
  let flightData: FlightReportOutboxItem | undefined;
  for (const item of items) {
    if (item.command.operationId !== operationId) continue;
    if (item.command.kind === 'milestone') milestones.set(item.command.code, item);
    else flightData = item;
  }
  return { milestones, flightData };
}
