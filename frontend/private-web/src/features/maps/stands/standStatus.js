import { normalizeStandCode } from '../../../services/standCodes';
import { minimumBoundingRectangle } from '../airport/geo';
import { matchStand } from '../airport/layoutIndex';
import { nearestEdge } from '../airport/taxiGraph';
import { ARRIVING_WINDOW_MS, RELEASING_WINDOW_MS, attachStandGeometry, displayFromStatus, standLayoutIndex, standStateOf }
  from './standModel';

// What a stand says of itself when it is clicked (owner request of 2026-11-15, «características e información de su
// estado»), for its drawer on Mapa de posiciones, the console's inspector and the panel beside the planning map. Two
// pure readings of what the screen already read, no new API read:
// - standCharacteristics: what the stand is (its terminal, contact, remote, bridge or FBO, its ICAO code letter and the
//   wingspan it takes, where the parked aircraft's nose points, its approximate size, its centre, the taxiway it is
//   entered from, what limits it and who covers it), from the positions board and the airport layout;
// - standStatus: why it reads the state it reads (stands/standModel.js: deriveDisplayStatus), since when, and the next
//   change that is expected with its time and countdown, from the display the screen derived per minute.
// Both return message keys and parameters, never text: ui/StandDetailFacts.jsx words them in the screen's language.

/** A lead-in further than this from a named taxiway names none. */
export const TAXIWAY_SNAP_M = 120;

/** Upper wingspan limit, in metres, of each ICAO aerodrome reference code letter (Annex 14, table 1-1). */
export const WINGSPAN_LIMIT_M = Object.freeze({ A: 15, B: 24, C: 36, D: 52, E: 65, F: 80 });

const CARDINALS = Object.freeze(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW']);

const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const finite = value => typeof value === 'number' && Number.isFinite(value);
const cleanNames = names => [...new Set((Array.isArray(names) ? names : [])
  .map(name => String(name ?? '').trim()).filter(name => name !== ''))];

/** The eight-point compass direction of a true bearing: 175° is «S». */
export function cardinalOf(degrees) {
  if (!finite(degrees)) return null;
  const normalized = ((degrees % 360) + 360) % 360;
  return CARDINALS[Math.round(normalized / 45) % 8];
}

// The stand of the layout a position names (its code or an alias), or null.
function layoutStandOf(position, index) {
  if (index === null) return null;
  const match = matchStand(position?.id ?? position?.code, index);
  return match !== null && match.stand.retired !== true ? match.stand : null;
}

// Where the stand is drawn: the geometry the screen attached, else the one the layout gives it now.
function geometryOf(position, layout, index) {
  if (position?.geometry !== undefined) return position.geometry;
  if (layout === null || index === null) return null;
  return attachStandGeometry([position], layout, { index })[0]?.geometry ?? null;
}

// The named taxiway the stand's lead-in starts from: the nearest taxi edge with a reference to its first point.
function taxiwayOf(geometry, index) {
  const start = Array.isArray(geometry?.leadIn) ? geometry.leadIn[0] : null;
  if (!Array.isArray(start) || index?.graph == null) return null;
  const hit = nearestEdge(index.graph, start, { kinds: ['taxiway'] });
  const ref = text(hit?.edge?.ref);
  return hit !== null && ref !== null && hit.distanceM <= TAXIWAY_SNAP_M ? ref : null;
}

/** Where a stand's location comes from: OCC placed it, it sits at the internal reference point, or it has none. */
export function locationOrigin(position) {
  if (position?.locationSource === 'occ') return 'occ';
  if (position?.locationSource === 'none') return 'none';
  return finite(position?.latitude) && finite(position?.longitude) ? 'reference' : 'none';
}

/**
 * What `position` (a stand of a positions screen, positionsMapMappers.js) is, with the airport `layout` (mdpc.layout.json)
 * when the screen has it: `{ code, terminal, access ('bridge' | 'contact' | 'remote' | 'fbo' | null), sizeLetter,
 * wingspanLimitM, maxAircraft, headingTrue (rounded degrees), nose (eight-point direction), lengthM, widthM (rounded,
 * of the smallest rectangle around its box), center ([lng, lat] or null), taxiway, cancelledBy, narrowbodyOnly,
 * overlaps (codes of the stands its box overlaps), origin (locationOrigin), coveredBy (names; null when the screen does
 * not know, [] when nobody covers it) }`. A fact nobody knows is null. Null without a position.
 */
export function standCharacteristics(position, layout = null) {
  if (position === null || typeof position !== 'object') return null;
  const index = standLayoutIndex(layout);
  const layoutStand = layoutStandOf(position, index);
  const geometry = geometryOf(position, layout, index);
  let access = null;
  if (position.hasBoardingBridge === true || layoutStand?.bridge === true) access = 'bridge';
  else if (position.isRemote === true) access = 'remote';
  else if (layoutStand?.kind === 'fbo') access = 'fbo';
  else if (layoutStand?.kind === 'remote' || layoutStand?.kind === 'contact') access = layoutStand.kind;
  else if (position.isRemote === false && position.standId != null) access = 'contact';
  const sizeLetter = text(geometry?.sizeLetter) ?? text(layoutStand?.sizeLetter);
  const heading = finite(geometry?.headingTrue) ? geometry.headingTrue : null;
  const box = Array.isArray(geometry?.polygon) && geometry.polygon.length >= 4 ? minimumBoundingRectangle(geometry.polygon) : null;
  const center = Array.isArray(geometry?.center) && geometry.center.every(finite) ? geometry.center : null;
  const code = normalizeStandCode(position.id ?? position.code);
  return {
    code: code || null,
    terminal: text(position.terminal) ?? text(layoutStand?.terminal),
    access,
    sizeLetter,
    wingspanLimitM: sizeLetter !== null ? WINGSPAN_LIMIT_M[sizeLetter] ?? null : null,
    maxAircraft: text(position.maxAircraftSize),
    headingTrue: heading === null ? null : Math.round(((heading % 360) + 360) % 360) % 360,
    nose: cardinalOf(heading),
    lengthM: box !== null && box.lengthM > 0 ? Math.round(box.lengthM) : null,
    widthM: box !== null && box.widthM > 0 ? Math.round(box.widthM) : null,
    center,
    taxiway: taxiwayOf(geometry, index),
    cancelledBy: normalizeStandCode(position.cancelledBy ?? position.linkedPositionId) || null,
    narrowbodyOnly: position.narrowbodyOnly === true,
    overlaps: (Array.isArray(layoutStand?.overlaps) ? layoutStand.overlaps : []).map(normalizeStandCode).filter(Boolean),
    origin: locationOrigin(position),
    coveredBy: Array.isArray(position.coveredBy) ? cleanNames(position.coveredBy) : null,
  };
}

const ON_STAND = new Set(['occupied', 'releasing']);
const nonNegative = minutes => (finite(minutes) && minutes >= 0 ? minutes : null);

// The flight a stand's reason names: the arrival of the one to come, the departure of the one on it.
function flightOf(display, onStand) {
  const visit = display.visit ?? {};
  const arrival = text(visit.arrivalFlightNumber);
  const departure = text(visit.departureFlightNumber);
  return (onStand ? departure ?? arrival : arrival ?? departure) ?? text(display.flightNumber);
}

/**
 * The aircraft on a stand or coming to it, for the facts of a provider (AeroDataBox's aircraft by registration): `{
 * registration, isDemo, flightNumber, aircraftType, state }` while the stand is planned, arriving, occupied or releasing
 * with a visit, else null. A demo flight (ADR-0041) has a synthetic registration: callers never look it up.
 */
export function standAircraftOf(position) {
  if (!position) return null;
  const display = position.display ?? displayFromStatus(position);
  const state = standStateOf(position);
  if (!['planned', 'arriving', 'occupied', 'releasing'].includes(state)) return null;
  const registration = text(display.detail?.registration) ?? text(display.visit?.aircraftRegistration)
    ?? text(position.aircraftRegistration);
  const flightNumber = flightOf(display, ON_STAND.has(state));
  if (registration === null && flightNumber === null) return null;
  return {
    registration: registration?.toUpperCase() ?? null,
    isDemo: display.isDemo === true || position.isDemo === true,
    flightNumber,
    aircraftType: text(display.aircraftType),
    state,
  };
}

/**
 * Why `position` (a stand of a positions screen with the `display` useStandDisplay derived, else its board status)
 * reads its state, and what comes next: `{ state, reason: { key, params }, next: { key, at, minutes, params } | null }`.
 * `key` is a message of mapMessages' `standStatus`; `params` carry flights and codes as text and instants as epoch ms
 * under names ending in `At` (the screen writes them as station times); `next.at` is the instant of the change and
 * `next.minutes` how many whole minutes are left, counted on the display's minute, null once due.
 * - available: no visit; disabled: «anulada por {code} ocupada» when a combined stand cancels it; unverified: no row of
 *   the database;
 * - planned: the flight it waits for and when it is due; it turns «Llegando» 15 minutes before;
 * - arriving: «aterrizó {time}, llega en N min» once it landed, else when it is due; it turns «Ocupada» at its arrival;
 * - occupied: since its actual arrival (recorded, or the aircraft seen in the box); it turns «Por liberar» 15 minutes
 *   before its departure;
 * - releasing: its departure time, scheduled or estimated, or how late it is; the stand frees then, or the next visit
 *   comes.
 */
export function standStatus(position) {
  if (!position) return null;
  const state = standStateOf(position);
  const display = position.display ?? displayFromStatus(position);
  const detail = display.detail ?? null;
  const arrivalAt = finite(display.arrivalAt) ? display.arrivalAt : null;
  const departureAt = finite(display.departureAt) ? display.departureAt : null;
  const toArrival = finite(display.minutesToArrival) ? display.minutesToArrival : null;
  const toDeparture = finite(display.minutesToDeparture) ? display.minutesToDeparture : null;
  // The flight a reason names: the arrival of a stand still waiting or just taken, the departure of one about to free.
  const flight = flightOf(display, state === 'releasing');
  const cancelledBy = display.cancelledBy ?? (normalizeStandCode(position.cancelledBy) || null);
  const result = (key, params = {}, next = null) => ({ state, reason: { key, params }, next });
  const nextChange = (key, at, minutes, params = {}) => (at === null ? null
    : { key, at, minutes: nonNegative(minutes), params });

  switch (state) {
    case 'disabled':
      return cancelledBy ? result('disabledBy', { code: cancelledBy }) : result('disabled');
    case 'unverified':
      return result('unverified');
    case 'planned':
      return result(flight ? 'planned' : 'plannedUnknown', { flight, arrivalAt }, nextChange('becomesArriving',
        arrivalAt === null ? null : arrivalAt - ARRIVING_WINDOW_MS, toArrival === null ? null : toArrival - 15));
    case 'arriving': {
      const landedAt = finite(detail?.arrival?.actualAt) ? detail.arrival.actualAt : null;
      const key = landedAt !== null ? 'arrivingLanded' : 'arriving';
      return result(key, { flight, landedAt, arrivalAt, minutes: nonNegative(toArrival) },
        nextChange('becomesOccupied', arrivalAt, toArrival));
    }
    case 'occupied': {
      const sinceAt = finite(detail?.arrival?.actualAt) ? detail.arrival.actualAt : null;
      // «Llegada registrada» only when nothing says otherwise: the notice that the aircraft stands on the stand with
      // its arrival unrecorded (stands/standModel.js, `arrivalNotRecorded`) wins over the board's arrival time.
      const signals = Array.isArray(position.signals) ? position.signals : display.signals ?? [];
      const recorded = display.visit?.arrivedAt != null
        && !signals.some(signal => signal?.reason === 'arrivalNotRecorded');
      const key = sinceAt === null ? 'occupiedNoTime' : recorded ? 'occupiedRecorded' : 'occupiedSeen';
      return result(key, { flight, sinceAt }, nextChange('becomesReleasing',
        departureAt === null ? null : departureAt - RELEASING_WINDOW_MS, toDeparture === null ? null : toDeparture - 15));
    }
    case 'releasing': {
      const estimated = finite(detail?.departure?.estimatedAt);
      let key = estimated ? 'releasingEstimated' : 'releasingScheduled';
      if (toDeparture !== null && toDeparture < 0) key = 'releasingLate';
      else if (departureAt === null) key = 'releasingUnknown';
      const upcoming = display.next ?? null;
      const next = upcoming && finite(upcoming.arrivalAt)
        ? nextChange('nextVisit', upcoming.arrivalAt, upcoming.minutesToArrival, { flight: text(upcoming.flightNumber) })
        : nextChange('becomesFree', departureAt, toDeparture);
      return result(key, { flight, departureAt, minutes: toDeparture === null ? null : Math.abs(toDeparture) }, next);
    }
    default:
      return result('available');
  }
}
