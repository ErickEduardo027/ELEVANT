// The priority of an operational notice (contratos 2.4, owner's decision): «Urgente» is any incident; «Atención» is a
// deviation, a flight the provider cancelled or diverted, an agent released, an operation left without an eligible
// agent, or a document or contract not in force; every other notice is a plain «Aviso». A presentation mapping over
// the notices the shell already reads (OperationalNotificationResponse): the notice carries no severity, and an
// incident is urgent whatever the severity it was reported with. buildAlertQueue orders them for «Alertas y avisos».

/** From the most to the least pressing. */
export const ALERT_PRIORITIES = Object.freeze(['urgent', 'attention', 'notice']);

const URGENT_KINDS = new Set(['incident_reported']);
const ATTENTION_KINDS = new Set([
  'deviation_reported',
  'flight_cancelled_by_provider',
  'flight_diverted_by_provider',
  'agent_released',
  'stand_change_unassigned',
  'agent_document_not_current',
  'contract_not_in_force',
]);

/** `urgent`, `attention` or `notice` for a notice kind; a kind this file does not know is a notice. */
export function alertPriority(kind) {
  if (URGENT_KINDS.has(kind)) return 'urgent';
  return ATTENTION_KINDS.has(kind) ? 'attention' : 'notice';
}

/** «Recibido» is the account's read receipt on the server: a notice with `readAt` was received. */
export function isReceived(item) {
  return item?.readAt != null;
}

/** When the account received the notice: the instant of its read receipt (`readAt`), or `null`. */
export function receivedAt(item) {
  return item?.readAt ?? null;
}

const RANK = Object.freeze(Object.fromEntries(ALERT_PRIORITIES.map((priority, index) => [priority, index])));
const NO_ENTRIES = Object.freeze([]);

// An ISO instant in milliseconds; a notice without a valid time sorts after every dated one.
function instant(value) {
  const ms = typeof value === 'string' ? Date.parse(value) : Number.NaN;
  return Number.isFinite(ms) ? ms : Number.NEGATIVE_INFINITY;
}

// Newest first; equal instants keep one order (by id) whatever order the server sent them in.
function newestFirst(left, right) {
  const [a, b] = [instant(left.notice.occurredAt), instant(right.notice.occurredAt)];
  if (a !== b) return b > a ? 1 : -1;
  const [leftId, rightId] = [String(left.id), String(right.id)];
  if (leftId === rightId) return 0;
  return leftId < rightId ? -1 : 1;
}

/**
 * Orders entries `{ id, priority, notice }` the most pressing first (urgent, attention, notice), then the newest first
 * by `notice.occurredAt`. The queue and the toasts sort with it.
 */
export function compareAlertEntries(left, right) {
  return RANK[left.priority] - RANK[right.priority] || newestFirst(left, right);
}

/**
 * The queue of «Alertas y avisos» (contratos 2.4), over the notices the shell already read: nothing else is asked of
 * the server. Each entry is `{ id, priority, receivedAt, notice }`, where `notice` is the server's notice as it is.
 * - `alerts`: the urgent and attention notices. Every unreceived one comes first, the most pressing first and then the
 *   newest; the received ones follow in the same order, at most `limitReceived` of them.
 * - `recent`: the plain notices («Aviso»), newest first, at most `limitRecent`. They ask for no «Recibido».
 * - `unreceivedCount`: the alerts the account has not received, the number the status bar shows.
 */
export function buildAlertQueue(items = [], { limitReceived = 10, limitRecent = 10 } = {}) {
  const unreceived = [];
  const received = [];
  const recent = [];
  for (const notice of items ?? NO_ENTRIES) {
    if (notice === null || typeof notice !== 'object') continue;
    const entry = Object.freeze({ id: notice.id, priority: alertPriority(notice.kind), receivedAt: receivedAt(notice),
      notice });
    if (entry.priority === 'notice') recent.push(entry);
    else if (entry.receivedAt === null) unreceived.push(entry);
    else received.push(entry);
  }
  unreceived.sort(compareAlertEntries);
  received.sort(compareAlertEntries);
  recent.sort(newestFirst);
  return {
    alerts: [...unreceived, ...received.slice(0, Math.max(0, limitReceived))],
    recent: recent.slice(0, Math.max(0, limitRecent)),
    unreceivedCount: unreceived.length,
  };
}

/**
 * What the status bar says about the notices: how many urgent and attention alerts the account has not received, and
 * the highest priority among them (`null` when there is none). Plain notices never count as alerts.
 */
export function alertSummary(items = []) {
  let unreceivedCount = 0;
  let highest = null;
  for (const item of items ?? []) {
    if (isReceived(item)) continue;
    const priority = alertPriority(item?.kind);
    if (priority === 'notice') continue;
    unreceivedCount += 1;
    if (priority === 'urgent' || highest === null) highest = priority;
  }
  return { unreceivedCount, highest };
}
