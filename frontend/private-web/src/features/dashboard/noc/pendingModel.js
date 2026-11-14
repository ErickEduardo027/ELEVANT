import { durationText, relativeTimeParts } from '../../occ-ui/occTime';
import { awaitingDecision } from '../dashboardModel';
import { bestTime, DUE_SOON_MS, instantMs } from './boardModel';

// «Pendientes de la jornada» (contratos 2.5, design D.1, the old «Requiere atención»): the conditions of the day that are
// still open, with no receipt, each with the action that closes it. Pure, and no thresholds of its own: what is pending
// comes from the reads (the planning snapshot, the readiness marks, the review queue and the board's map flights), and
// the only hour is contratos 2.4's (a flight due within 60 minutes asks for attention). `nowMs` is the server's time.

/** What can be pending. */
export const PENDING_KINDS = Object.freeze(['noStand', 'noAgent', 'agentCannotOperate', 'toImport', 'toReview',
  'overdue']);

/** The actions that close a pending item, with their words (consoleMessages `pending.actions.*`). */
export const PENDING_ACTIONS = Object.freeze(['chooseStand', 'assign', 'import', 'review']);

/**
 * The reads the pending items come from, with their names (consoleMessages `pending.sources.*`): the planning snapshot
 * (`noStand`, `noAgent`), the readiness marks of its day (`agentCannotOperate`), the map flights (`toImport`,
 * `overdue`) and the review queue (`toReview`).
 */
export const PENDING_SOURCES = Object.freeze(['planning', 'readiness', 'flights', 'reviewQueue']);

/** What a note of «Pendientes de la jornada» says of a read (consoleMessages `pending.notes.*`). */
export const PENDING_NOTE_KINDS = Object.freeze(['loading', 'failed', 'refused', 'stale']);

const PRIORITY_RANK = Object.freeze({ urgent: 0, attention: 1, notice: 2 });
const ANSWERED = new Set(['success', 'empty']);
const WAITING = new Set(['idle', 'loading']);
const REFUSED = new Set(['forbidden', 'unauthorized']);
const CLOSED = new Set(['completed', 'cancelled', 'diverted']);
const NO_ROWS = Object.freeze([]);
const isObject = value => value !== null && typeof value === 'object';
const normalize = value => String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();

// The deadline of a turnaround: the arrival's best time, else the departure's, with the direction it belongs to. The
// board's map leg is fresher than the planning snapshot when the map holds the visit.
function deadlineOf(flight, visit) {
  const arrival = visit?.arrival?.time ?? bestTime(flight.arrival);
  if (arrival) return { time: arrival, direction: 'Arrival' };
  const departure = visit?.departure?.time ?? bestTime(flight.departure);
  return departure ? { time: departure, direction: 'Departure' } : null;
}

// The stand of a turnaround: the one its map flights give it when the board holds its visit from them (boardModel.js:
// they are re-read on `occ_planning`, the planning snapshot only on its 60 s poll, contratos 2.7), else the snapshot's.
// A stand assigned or released on another screen reads here as on the board's strip.
const standOf = (flight, visit) => (visit?.source === 'map' ? visit.standCode : flight.stand?.code ?? null);

/**
 * «llega en 23 min», «llega ahora», «llegó hace 5 min» (an actual time) or «debía llegar hace 5 min» (a time that
 * passed with nothing recorded); the same for a departure. An empty text without a deadline.
 */
function whenWords(deadline, nowMs, t) {
  if (deadline === null) return '';
  const parts = relativeTimeParts(deadline.time.at, nowMs);
  if (parts === null) return '';
  const leg = deadline.direction === 'Arrival' ? 'arrives' : 'departs';
  if (parts.tense === 'now') return t(`pending.when.${leg}Now`);
  const duration = durationText(parts, t);
  if (parts.tense === 'future') return t(`pending.when.${leg}`, { duration });
  return t(deadline.time.kind === 'actual' ? `pending.when.${leg}Past` : `pending.when.${leg}Due`, { duration });
}

const withWhen = (what, when, t) => (when === '' ? what : t('pending.withWhen', { what, when }));

// Amber once due within the hour of contratos 2.4, or overdue; a plain notice otherwise.
const priorityOf = (deadline, nowMs) => (deadline !== null && Number.isFinite(nowMs)
  && deadline.time.at - nowMs <= DUE_SOON_MS ? 'attention' : 'notice');

const nameOf = flight => flight.arrival?.flightNumber ?? flight.departure?.flightNumber ?? flight.operationCode ?? '';

function entry(kind, key, fields) {
  return Object.freeze({ id: `${kind}:${key}`, kind, flightKey: null, turnaroundId: null, ...fields });
}

/**
 * The pending items of the day, the most pressing first (urgent, attention, notice) and, within a priority, by their
 * time (none last). Each `{ id, kind, priority, at, label, action: { kind, target } | null, flightKey, turnaroundId }`,
 * `at` in milliseconds (or null), `label` in the words of `t` (consoleMessages):
 * - `noStand` («Elegir posición») and `noAgent` («Asignar agente»): an open turnaround of the planning snapshot
 *   (`planningFlights`, mapped) without a stand or without an agent; amber when it is due within the hour. Its stand is
 *   the one the board's map flights give it when they hold its visit, fresher than the snapshot's; its agents are the
 *   snapshot's (the map flights carry none);
 * - `agentCannotOperate` («Asignar agente»): a turnaround of the snapshot with an assigned agent the readiness marks
 *   say cannot operate (2-N25), amber;
 * - `toImport` («Importar»): a flight the feed proposes that nobody imported (the board's «Por importar», demo ones
 *   included); amber when it is due within the hour;
 * - `toReview` («Revisar»): an operation of the queue awaiting OCC's decision, a notice;
 * - `overdue`: an aircraft still on its stand after its departure time (the board's visits, on their stand by the
 *   evidence of the stand states, boardModel.js: aircraftOnStand), amber, with no action of its own (the console
 *   selects the flight).
 * `target` is the turnaround id, the proposal id or the operation id the action opens.
 */
export function buildPending({ board = null, planningFlights = null, readiness = null, reviewQueue = null, nowMs, t } = {}) {
  const entries = [];
  const visits = new Map((board?.visits ?? NO_ROWS).filter(item => item?.turnaroundId)
    .map(item => [item.turnaroundId, item]));
  const flights = (Array.isArray(planningFlights) ? planningFlights : []).filter(item => isObject(item)
    && typeof item.turnaroundId === 'string');
  const byTurnaround = new Map(flights.map(item => [item.turnaroundId, item]));

  for (const flight of flights) {
    if (CLOSED.has(normalize(flight.status))) continue;
    const visit = visits.get(flight.turnaroundId) ?? null;
    const deadline = deadlineOf(flight, visit);
    const when = whenWords(deadline, nowMs, t);
    const fields = { priority: priorityOf(deadline, nowMs), at: deadline?.time.at ?? null,
      flightKey: visit?.arrival?.flightKey ?? visit?.departure?.flightKey ?? null, turnaroundId: flight.turnaroundId };
    if (!standOf(flight, visit)) {
      entries.push(entry('noStand', flight.turnaroundId, { ...fields,
        label: withWhen(t('pending.noStand', { flight: nameOf(flight) }), when, t),
        action: Object.freeze({ kind: 'chooseStand', target: flight.turnaroundId }) }));
    }
    if (!(flight.assignedAgents ?? []).length) {
      entries.push(entry('noAgent', flight.turnaroundId, { ...fields,
        label: withWhen(t('pending.noAgent', { flight: nameOf(flight) }), when, t),
        action: Object.freeze({ kind: 'assign', target: flight.turnaroundId }) }));
    }
  }

  // One item per turnaround, whatever the number of its unfit assignments. The marks and the snapshot belong to the
  // same day: a mark whose turnaround the snapshot does not hold yet waits for its next read.
  const unfit = new Set((readiness?.assignments ?? NO_ROWS).map(item => item?.turnaroundId).filter(Boolean));
  for (const turnaroundId of unfit) {
    const flight = byTurnaround.get(turnaroundId) ?? null;
    if (flight === null || CLOSED.has(normalize(flight.status))) continue;
    const visit = visits.get(turnaroundId) ?? null;
    const deadline = deadlineOf(flight, visit);
    entries.push(entry('agentCannotOperate', turnaroundId, {
      priority: 'attention', at: deadline?.time.at ?? null, turnaroundId,
      flightKey: visit?.arrival?.flightKey ?? visit?.departure?.flightKey ?? null,
      label: t('pending.agentCannotOperate', { flight: nameOf(flight) }),
      action: Object.freeze({ kind: 'assign', target: turnaroundId }),
    }));
  }

  // A pair is imported from its arrival; a departure to import is listed only without one.
  const toImport = board?.toImport ?? { arrivals: NO_ROWS, departures: NO_ROWS };
  const pairs = new Set((toImport.arrivals ?? NO_ROWS).map(item => item.visitKey).filter(Boolean));
  const proposals = [...(toImport.arrivals ?? NO_ROWS),
    ...(toImport.departures ?? NO_ROWS).filter(item => !item.visitKey || !pairs.has(item.visitKey))];
  for (const item of proposals) {
    const deadline = item.time ? { time: item.time, direction: item.direction } : null;
    entries.push(entry('toImport', item.flightKey, {
      priority: priorityOf(deadline, nowMs), at: deadline?.time.at ?? null, flightKey: item.flightKey,
      label: withWhen(t('pending.toImport', { flight: item.flightNumber }), whenWords(deadline, nowMs, t), t),
      action: Object.freeze({ kind: 'import', target: item.proposalId }),
    }));
  }

  for (const visit of board?.visits ?? NO_ROWS) {
    const departure = visit?.departure;
    if (!visit?.onStand || visit.ended || !departure?.time || !Number.isFinite(nowMs)) continue;
    if (departure.time.at >= nowMs) continue;
    entries.push(entry('overdue', visit.id, {
      priority: 'attention', at: departure.time.at, flightKey: departure.flightKey, turnaroundId: visit.turnaroundId,
      label: t('pending.overdue', { flight: departure.flightNumber }), action: null,
    }));
  }

  for (const operation of awaitingDecision(reviewQueue?.operations ?? NO_ROWS)) {
    entries.push(entry('toReview', operation.operationId, {
      priority: 'notice', at: instantMs(operation.submittedAt),
      label: t('pending.toReview', { code: operation.operationCode }),
      action: Object.freeze({ kind: 'review', target: operation.operationId }),
    }));
  }

  // Equal times keep one order: the kinds in the order of PENDING_KINDS (a stand before an agent), then the words.
  return Object.freeze(entries.sort((left, right) => {
    const rank = PRIORITY_RANK[left.priority] - PRIORITY_RANK[right.priority];
    if (rank !== 0) return rank;
    const [a, b] = [left.at ?? Number.POSITIVE_INFINITY, right.at ?? Number.POSITIVE_INFINITY];
    if (a !== b) return a < b ? -1 : 1;
    return PENDING_KINDS.indexOf(left.kind) - PENDING_KINDS.indexOf(right.kind)
      || left.label.localeCompare(right.label) || left.id.localeCompare(right.id);
  }));
}

// What a note says of a read: nothing when it answered and is current.
function noteKindOf(source) {
  if (ANSWERED.has(source.status)) return source.staleSince != null ? 'stale' : null;
  if (WAITING.has(source.status)) return 'loading';
  return REFUSED.has(source.status) ? 'refused' : 'failed';
}

/**
 * What «Pendientes de la jornada» can say from the state of the reads its items come from (contratos 2.7: a read that
 * fails or is refused blanks only what comes from it, never the items of the others). `sources` are
 * `{ id, status, staleSince, onRetry }`, panelStateOf's shape with an id of PENDING_SOURCES (others are ignored).
 * Returns `{ loading, complete, notes }`:
 * - `loading`: no read answered yet and one is still on its way: the list waits for its first data;
 * - `complete`: every read answered, so an empty list may say that nothing is pending;
 * - `notes`: one per read the list lacks or shows late, in the order of `sources`, each `{ id, kind, staleSince,
 *   onRetry }` with `kind` `loading`, `failed` (an error or a timeout), `refused` (no permission, or the session
 *   expired) or `stale` (its last refresh failed: its items are the ones it answered before), and `onRetry` the read's
 *   retry or null.
 */
export function pendingCoverage(sources = NO_ROWS) {
  const list = (Array.isArray(sources) ? sources : []).filter(source => isObject(source)
    && PENDING_SOURCES.includes(source.id));
  const answered = list.filter(source => ANSWERED.has(source.status)).length;
  const notes = list.flatMap(source => {
    const kind = noteKindOf(source);
    return kind === null ? [] : [Object.freeze({ id: source.id, kind, staleSince: source.staleSince ?? null,
      onRetry: typeof source.onRetry === 'function' ? source.onRetry : null })];
  });
  return Object.freeze({
    loading: answered === 0 && list.some(source => WAITING.has(source.status)),
    complete: list.length > 0 && answered === list.length,
    notes: Object.freeze(notes),
  });
}
