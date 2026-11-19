import { isInOperation } from '../occ-ui/statusVocabulary';
import { toInstantMs } from '../occ-ui/occTime';
import { standDisplayCode } from '../../services/standCodes';

// The pure models of Planificación's views (design E.2, template C): «Posiciones», the stands of the day as the band of
// occ-ui/OccTimeline.jsx, and «Tabla», the day's turnarounds as the rows of occ-ui/OccDataTable.jsx. Both read only the
// planning snapshot the page already has (mapOccPlanningSnapshot): no read is added.

const NO_FLIGHTS = Object.freeze([]);
const CLOSED = new Set(['completed', 'closed', 'cancelled', 'diverted']);
const normal = status => String(status ?? '').replace(/[\s_-]+/g, '').toLowerCase();

/** The best time of a leg: real, else estimated, else scheduled, as `{ at, kind }`; `null` without any. */
export function bestLegTime(leg) {
  for (const [field, kind] of [['actualAt', 'actual'], ['estimatedAt', 'estimated'], ['scheduledAt', 'scheduled']]) {
    if (Number.isFinite(toInstantMs(leg?.[field]))) return Object.freeze({ at: leg[field], kind });
  }
  return null;
}

/** Where a visit is on its stand: `departed` once it left or closed, `onStand` once it arrived, else `planned`. */
export function visitState(flight) {
  if (CLOSED.has(normal(flight?.status)) || Number.isFinite(toInstantMs(flight?.departure?.actualAt))) return 'departed';
  if (Number.isFinite(toInstantMs(flight?.arrival?.actualAt))) return 'onStand';
  return 'planned';
}

/**
 * The band of the day: one row per stand with planned visits, in natural order of the stand code (A2 before A10), each
 * visit one bar from its arrival's best time to its departure's (a missing end stays open), with the shape of
 * OccTimeline: `{ id, turnaroundId, arrivalFlight, departureFlight, startAt, startKind, endAt, endKind, state,
 * estimated, demo, conflict, inOperation }`. A turnaround without a stand is left out (the table says «Sin posición»).
 * A row's id is the stand's code as stored and its label the code the map draws (N27: the seed's A02 is A2).
 */
export function planningBandRows(flights = NO_FLIGHTS) {
  const byStand = new Map();
  for (const flight of Array.isArray(flights) ? flights : NO_FLIGHTS) {
    const code = flight?.stand?.code ?? flight?.position ?? null;
    if (!code) continue;
    const start = bestLegTime(flight.arrival) ?? bestLegTime(flight.departure);
    const end = flight.arrival ? bestLegTime(flight.departure) : null;
    const bar = Object.freeze({
      id: String(flight.turnaroundId ?? flight.id),
      turnaroundId: flight.turnaroundId ?? flight.id,
      arrivalFlight: flight.arrival?.flightNumber ?? null,
      departureFlight: flight.departure?.flightNumber ?? null,
      startAt: start?.at ?? null, startKind: start?.kind ?? 'scheduled',
      endAt: end?.at ?? null, endKind: end?.kind ?? 'scheduled',
      state: visitState(flight),
      estimated: start?.kind === 'estimated' || end?.kind === 'estimated',
      demo: flight.isDemo === true,
      conflict: null,
      inOperation: isInOperation(flight),
    });
    if (!byStand.has(code)) byStand.set(code, []);
    byStand.get(code).push(bar);
  }
  const collator = new Intl.Collator('es', { numeric: true, sensitivity: 'base' });
  const startOf = bar => toInstantMs(bar.startAt) || 0;
  return Object.freeze([...byStand.entries()]
    .sort(([left], [right]) => collator.compare(left, right))
    .map(([code, bars]) => Object.freeze({ id: code, label: standDisplayCode(code), bars: Object.freeze(bars.sort((a, b) => startOf(a) - startOf(b))) })));
}

/**
 * The window the band shows: the station's day of `date` («2026-11-16»), from its first visit to its last when they
 * fall outside, as `{ windowStart, windowEnd }` in milliseconds; `null` without a day.
 */
export function planningBandWindow(rows, date, timeZone = 'UTC') {
  const [year, month, day] = String(date ?? '').split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return null;
  // The station's midnight: the UTC midnight moved by the zone's offset at that instant.
  const utcMidnight = Date.UTC(year, month - 1, day);
  let offset = 0;
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit',
      day: '2-digit', hour: '2-digit', minute: '2-digit' }).formatToParts(new Date(utcMidnight));
    const get = type => Number(parts.find(part => part.type === type)?.value);
    offset = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute')) - utcMidnight;
  } catch {
    offset = 0;
  }
  let windowStart = utcMidnight - offset;
  let windowEnd = windowStart + 24 * 3_600_000;
  for (const row of rows ?? []) {
    for (const bar of row.bars) {
      const start = toInstantMs(bar.startAt);
      const end = toInstantMs(bar.endAt);
      if (Number.isFinite(start)) windowStart = Math.min(windowStart, start - 30 * 60_000);
      if (Number.isFinite(end)) windowEnd = Math.max(windowEnd, end + 30 * 60_000);
    }
  }
  return Object.freeze({ windowStart, windowEnd });
}
