import { normalizeStandCode } from '../../services/standCodes';
import { bestTime, DUE_SOON_MS } from '../dashboard/noc/boardModel';
import { matchFlight } from '../maps/core/mapSelection';
import { delayMinutesOf } from '../occ-ui/occDelay';
import { isInOperation } from '../occ-ui/statusVocabulary';

// The board of Monitoreo de vuelos (design E.2, template B «Mapa de trabajo»): the flights of the page as flight strips
// (occ-ui/OccFlightStrip.jsx) in «Llegadas», «Salidas» and «Todos», sorted by their best time. Pure. The flights are the
// legs of the planning snapshot the page reads (services/flightMonitoringService.js), not the map flights: the map adapter
// (components/FlightMap.jsx, the maps lane's) reads those itself and does not hand them to the page, and a second read of
// them is forbidden (contratos 2.7). So a strip says «Demo» from the turnaround's mark and never «est.»: whether an
// aircraft is drawn at an estimated position only the map knows. The status words are the console's
// (dashboard/noc/boardModel.js), from the planning snapshot alone.

/** The filters of the board, in the order of its segmented control. */
export const FLIGHT_BOARD_FILTERS = Object.freeze(['arrivals', 'departures', 'all']);

/** The status words of a strip (flightMonitoringMessages `board.status.*`). */
export const FLIGHT_BOARD_STATUS_KEYS = Object.freeze(['noStand', 'scheduled', 'landed', 'departed', 'inOperation',
  'cancelled', 'diverted', 'completed', 'unknown']);

const NO_FLIGHTS = Object.freeze([]);
const DIRECTIONS = Object.freeze({ arrival: 'Arrival', departure: 'Departure' });

const normalize = value => String(value ?? '').replace(/[\s_-]+/g, '').toLowerCase();
const isObject = value => value !== null && typeof value === 'object';
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
// The words a search compares: lower case and without accents, so «perez» finds «Pérez».
const searchable = value => String(value ?? '').normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase().trim();

/**
 * Whether a flight lands at the station or leaves it: `Arrival`, `Departure`, or `null` for a flight of neither (it is not
 * the station's, and the board leaves it out). The flights of the planning snapshot say so themselves (`direction`);
 * otherwise their airports do.
 */
export function flightDirection(flight, stationCode = null) {
  const own = DIRECTIONS[normalize(flight?.direction)];
  if (own) return own;
  const station = text(stationCode);
  if (station === null) return null;
  if (flight?.destination === station) return 'Arrival';
  if (flight?.origin === station) return 'Departure';
  return null;
}

/**
 * The times of a leg: `{ scheduledAt, estimatedAt, actualAt }`. A flight of the planning snapshot carries the three
 * (flightMonitoringService.js); an older flight of the page only its ETA or ETD, an estimate, and its actual time.
 */
export function legTimes(flight, direction) {
  if (isObject(flight) && Object.hasOwn(flight, 'scheduledAt')) {
    return { scheduledAt: flight.scheduledAt ?? null, estimatedAt: flight.estimatedAt ?? null, actualAt: flight.actualAt ?? null };
  }
  const arrival = direction === 'Arrival';
  return {
    scheduledAt: null,
    estimatedAt: (arrival ? flight?.eta : flight?.etd) ?? null,
    actualAt: (arrival ? flight?.actualArrival : flight?.actualDeparture) ?? null,
  };
}

const dueSoon = (time, nowMs) => time !== null && Number.isFinite(nowMs) && time.at - nowMs <= DUE_SOON_MS;

/**
 * What a leg of the planning snapshot is doing, as a status key and its signal (contratos 2.4: a normal state carries no
 * hue; the console's planning legs read the same, dashboard/noc/boardModel.js):
 * - a cancelled or diverted turnaround asks for attention; a completed one is `completed`;
 * - an arrival without a stand is «Llegada sin posición asignada», amber once it is due within an hour (or overdue);
 * - a departure with its actual time `departed`; a visit in operation (isInOperation) `inOperation`; an arrival with its
 *   actual time `landed`; any other leg with a time `scheduled`, and one without any time `unknown`.
 * An older flight of the page says cancelled, diverted or unknown in its own `status`.
 */
export function stripStatus(flight, { direction, time, standCode, actualAt, nowMs } = {}) {
  const turnaround = normalize(flight?.turnaroundStatus);
  const own = normalize(flight?.status);
  if (turnaround === 'cancelled' || own === 'cancelled') return { key: 'cancelled', signal: 'attention' };
  if (turnaround === 'diverted' || own === 'diverted') return { key: 'diverted', signal: 'attention' };
  if (turnaround === 'completed') return { key: 'completed', signal: null };
  if (direction === 'Arrival' && standCode === null) {
    return { key: 'noStand', signal: dueSoon(time, nowMs) ? 'attention' : null };
  }
  if (direction === 'Departure' && actualAt) return { key: 'departed', signal: null };
  if (isInOperation({ status: flight?.turnaroundStatus, operationStatus: flight?.operationStatus })) {
    return { key: 'inOperation', signal: null };
  }
  if (direction === 'Arrival' && actualAt) return { key: 'landed', signal: null };
  if (time == null || own === 'unknown') return { key: 'unknown', signal: null };
  return { key: 'scheduled', signal: null };
}

const sortValue = time => (time === null ? Number.POSITIVE_INFINITY : time.at);

// By the best time, then the flight number and the id, so equal times keep one order whatever the server sent (as the
// console's board does).
function byTime(left, right) {
  if (left.sortAt !== right.sortAt) return left.sortAt < right.sortAt ? -1 : 1;
  const byNumber = String(left.flightNumber ?? '').localeCompare(String(right.flightNumber ?? ''));
  return byNumber || String(left.id).localeCompare(String(right.id));
}

function stripOf(flight, direction, { nowMs, t }) {
  const times = legTimes(flight, direction);
  const time = bestTime(times);
  const code = normalizeStandCode(flight.stand?.code ?? flight.stand);
  const standCode = code === '' ? null : code;
  const status = stripStatus(flight, { direction, time, standCode, actualAt: times.actualAt, nowMs });
  const arrival = direction === 'Arrival';
  return Object.freeze({
    id: String(flight.id),
    legId: flight.id,
    turnaroundId: flight.turnaroundId ?? null,
    direction,
    flightNumber: flight.flightNumber ?? '',
    counterpartIata: text(arrival ? flight.origin : flight.destination),
    time,
    standCode,
    status: Object.freeze({ key: status.key, label: t(`board.status.${status.key}`), signal: status.signal }),
    demo: flight.isDemo === true,
    // Only the map knows where it draws an aircraft (the page does not read the map flights).
    estimated: false,
    // The minutes its best time runs past its scheduled one (CN-32, occDelay.js); null on time.
    delayMinutes: delayMinutesOf(times),
    sortAt: sortValue(time),
    searchText: searchable([flight.flightNumber, flight.airline, flight.registration, flight.supervisor,
      arrival ? flight.origin : flight.destination, standCode].filter(Boolean).join(' ')),
  });
}

/**
 * The board at `nowMs` (the server's time in milliseconds): `{ arrivals, departures, all, counts: { arrivals,
 * departures, all } }`. Each strip has the shape of OccFlightStrip, `{ id: String(leg id), legId, turnaroundId,
 * direction: 'Arrival' | 'Departure', flightNumber, counterpartIata, time: { at, kind: 'actual' | 'estimated' |
 * 'scheduled' } | null, standCode, status: { key, label, signal }, demo, estimated, sortAt, searchText }`, sorted by its
 * best time, then its number and its id. `standCode` is normalized (A01 is A1); `demo` is the turnaround's mark; a flight
 * neither landing at the station nor leaving it is left out. `t` translates flightMonitoringMessages; `stationCode` tells
 * the direction of a flight that does not say it.
 */
export function buildFlightBoard(flights = NO_FLIGHTS, { nowMs, t, stationCode = null } = {}) {
  const strips = (Array.isArray(flights) ? flights : NO_FLIGHTS)
    .filter(flight => isObject(flight) && flight.id !== null && flight.id !== undefined)
    .flatMap(flight => {
      const direction = flightDirection(flight, stationCode);
      return direction === null ? [] : [stripOf(flight, direction, { nowMs, t })];
    })
    .sort(byTime);
  const arrivals = Object.freeze(strips.filter(strip => strip.direction === 'Arrival'));
  const departures = Object.freeze(strips.filter(strip => strip.direction === 'Departure'));
  const all = Object.freeze(strips);
  return Object.freeze({
    arrivals, departures, all,
    counts: Object.freeze({ arrivals: arrivals.length, departures: departures.length, all: all.length }),
  });
}

/**
 * The strips of `board` that `filter` (`arrivals`, `departures` or `all`) keeps and whose number, airline, registration,
 * supervisor, other airport or stand holds `search`, without regard to case or accents. An unknown filter throws.
 */
export function filterBoard(board, filter = 'all', search = '') {
  if (!FLIGHT_BOARD_FILTERS.includes(filter)) throw new RangeError(`Unknown flight board filter: ${String(filter)}`);
  const list = Array.isArray(board?.[filter]) ? board[filter] : NO_FLIGHTS;
  const wanted = searchable(search);
  return wanted === '' ? list : list.filter(strip => strip.searchText.includes(wanted));
}

/**
 * The flight of the page a `flightId` of the URL names (contratos 2.1): a leg id (today's links), its `l:` flight key or
 * a turnaround id, which names that visit's arrival. `null` for anything else, such as the key of a flight only the map
 * knows (a proposal still to import).
 */
export function findBoardFlight(flights, id) {
  const wanted = String(id ?? '').trim();
  if (wanted === '') return null;
  const legId = wanted.startsWith('l:') ? wanted.slice(2) : wanted;
  return matchFlight(Array.isArray(flights) ? flights : NO_FLIGHTS, legId);
}

/** The columns the board sorts by (CN-32), in the order of its header. */
export const FLIGHT_BOARD_SORT_KEYS = Object.freeze(['time', 'flight', 'status', 'route', 'stand']);

/** The order the board opens with: by the best time, the earliest first. */
export const DEFAULT_FLIGHT_BOARD_SORT = Object.freeze({ key: 'time', direction: 'ascending' });

// What asks for attention first when sorting by status: urgent, then attention, then the rest by their words.
const SIGNAL_RANK = Object.freeze({ urgent: 0, attention: 1 });
const signalRank = strip => SIGNAL_RANK[strip.status?.signal] ?? 2;
// A strip without the value sorted by goes last, in either order.
const compareText = (left, right) => {
  if (left === right) return 0;
  if (left === null || left === '') return 1;
  if (right === null || right === '') return -1;
  return String(left).localeCompare(String(right), undefined, { numeric: true });
};

const COMPARE = Object.freeze({
  time: (left, right) => (left.sortAt === right.sortAt ? 0 : (left.sortAt < right.sortAt ? -1 : 1)),
  flight: (left, right) => compareText(left.flightNumber, right.flightNumber),
  status: (left, right) => (signalRank(left) - signalRank(right))
    || compareText(left.status?.label ?? null, right.status?.label ?? null),
  route: (left, right) => compareText(left.counterpartIata, right.counterpartIata),
  stand: (left, right) => compareText(left.standCode, right.standCode),
});
// The strips without the value go last whatever the direction: only the comparison of two values turns.
const MISSING = Object.freeze({
  time: strip => !Number.isFinite(strip.sortAt),
  flight: strip => !strip.flightNumber,
  status: () => false,
  route: strip => !strip.counterpartIata,
  stand: strip => !strip.standCode,
});

/**
 * The strips in the order of `sort` (`{ key, direction }`, FLIGHT_BOARD_SORT_KEYS and `ascending` or `descending`):
 * by the time, the flight number, the status (urgent and attention first, then by its words), the other airport or the
 * stand; the strips without that value last, and equal ones in the board's own order (by time). A new array; an
 * unknown key or direction throws.
 */
export function sortBoard(strips, sort = DEFAULT_FLIGHT_BOARD_SORT) {
  const { key, direction } = sort ?? DEFAULT_FLIGHT_BOARD_SORT;
  if (!FLIGHT_BOARD_SORT_KEYS.includes(key)) throw new RangeError(`Unknown flight board sort: ${String(key)}`);
  if (direction !== 'ascending' && direction !== 'descending') {
    throw new RangeError(`Unknown flight board sort direction: ${String(direction)}`);
  }
  const list = Array.isArray(strips) ? strips : NO_FLIGHTS;
  const turn = direction === 'descending' ? -1 : 1;
  const order = new Map(list.map((strip, index) => [strip, index]));
  return [...list].sort((left, right) => {
    const missing = Number(MISSING[key](left)) - Number(MISSING[key](right));
    if (missing !== 0) return missing;
    return (COMPARE[key](left, right) * turn) || (order.get(left) - order.get(right));
  });
}

/** The order after a click on the column `key`: that column ascending, or the other way when it was already sorted by. */
export function nextBoardSort(current, key) {
  if (current?.key === key) {
    return Object.freeze({ key, direction: current.direction === 'ascending' ? 'descending' : 'ascending' });
  }
  return Object.freeze({ key, direction: 'ascending' });
}
