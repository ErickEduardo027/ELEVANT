import { normalizeStandCode } from '../../../services/standCodes';
import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { pointInPolygon } from '../airport/geo';
import { endsItsVisit } from '../core/mapSelection';

// The only module that knows the shape of the map reads (contracts 1.3): it turns the air picture, an aircraft's track
// and the map flights into the map's model, and joins them into what the map draws (design E1). Pure.
//
// Units inside the model: metres, metres per second, degrees true, and instants as epoch milliseconds. The flights
// keep their rows as the API sends them (keys, phase, stand, milestones, demo clock, `imported`, `isDemo`); only the
// response's own instants are milliseconds.

const FOOT_M = 0.3048;
const KNOT_MS = 1852 / 3_600;
const FOOT_PER_MINUTE_MS = FOOT_M / 60;

const scaled = (value, factor) => (typeof value === 'number' && Number.isFinite(value) ? value * factor : null);
const text = value => (typeof value === 'string' && value.trim() !== '' ? value.trim() : null);
const heading = value => (typeof value === 'number' && Number.isFinite(value) ? value % 360 : null);

function toTrailPoint(point) {
  return Object.freeze({ at: parseInstant(point.at), lon: point.longitude, lat: point.latitude,
    altM: scaled(point.altitudeFeet, FOOT_M), onGround: point.onGround === true });
}

function toFix(aircraft) {
  return Object.freeze({
    hex: aircraft.hex,
    callsign: text(aircraft.callsign),
    registration: text(aircraft.registration),
    typeIcao: text(aircraft.typeIcaoCode),
    category: aircraft.category ?? null,
    lon: aircraft.longitude,
    lat: aircraft.latitude,
    altM: scaled(aircraft.altitudeFeet, FOOT_M),
    onGround: aircraft.onGround === true,
    gsMs: scaled(aircraft.groundSpeedKnots, KNOT_MS),
    trackDeg: heading(aircraft.trackDegrees),
    vrateMs: scaled(aircraft.verticalRateFeetPerMinute, FOOT_PER_MINUTE_MS),
    squawk: aircraft.squawk ?? null,
    positionAt: parseInstant(aircraft.positionAt),
    matchedFlightKey: aircraft.matchedFlightKey ?? null,
    matchedBy: aircraft.matchedBy ?? null,
    trail: Object.freeze((aircraft.trail ?? []).map(toTrailPoint)),
  });
}

/**
 * The air picture in the map's units: `{ stationId, status, reason, serverTime, observedAt, ageSeconds,
 * refreshAfterSeconds, source, center: { lon, lat, radiusNm }, aircraft }`. Its state (`Live`, `Stale`, `Warming`,
 * `Unavailable`, `Disabled`) and reason are data, never an error. Each aircraft is a fix: `{ hex, callsign,
 * registration, typeIcao, category, lon, lat, altM, onGround, gsMs, trackDeg, vrateMs, squawk, positionAt,
 * matchedFlightKey, matchedBy, trail: [{ at, lon, lat, altM, onGround }] }`.
 */
export function toPictureModel(response) {
  return Object.freeze({
    stationId: response.stationId,
    status: response.status,
    reason: response.reason ?? null,
    serverTime: parseInstant(response.serverTime),
    observedAt: parseInstant(response.observedAt ?? null),
    ageSeconds: response.ageSeconds ?? null,
    refreshAfterSeconds: response.refreshAfterSeconds,
    source: response.source ?? null,
    center: Object.freeze({ lon: response.center.longitude, lat: response.center.latitude,
      radiusNm: response.center.radiusNm }),
    aircraft: Object.freeze(response.aircraft.map(toFix)),
  });
}

/** One aircraft's track from the server's memory: `{ hex, serverTime, source, points: [{ at, lon, lat, altM, onGround }] }`. */
export function toTrackModel(response) {
  return Object.freeze({ hex: response.hex, serverTime: parseInstant(response.serverTime), source: response.source ?? null,
    points: Object.freeze(response.points.map(toTrailPoint)) });
}

/**
 * The map flights: `{ stationId, stationCode, serverTime, windowFrom, windowTo, stationAirport, flights, byKey }`, with
 * the rows as they come and `byKey` from each `flightKey` to its row.
 */
export function toFlightsModel(response) {
  const flights = Object.freeze([...response.flights]);
  return Object.freeze({
    stationId: response.stationId,
    stationCode: response.stationCode,
    serverTime: parseInstant(response.serverTime),
    windowFrom: parseInstant(response.windowFrom),
    windowTo: parseInstant(response.windowTo),
    stationAirport: response.stationAirport,
    flights,
    byKey: new Map(flights.map(flight => [flight.flightKey, flight])),
  });
}

/**
 * How old a live position may be before the map shows it as without recent signal: twice the pace the server asks
 * for, and never under 30 seconds (contracts 2.3: derived, not fixed).
 */
export function staleAfterSeconds(refreshAfterSeconds) {
  const refresh = Number.isFinite(refreshAfterSeconds) && refreshAfterSeconds > 0 ? refreshAfterSeconds : 0;
  return Math.max(30, 2 * refresh);
}

const visitOf = flight => flight.visitKey ?? flight.flightKey;
const standCodeOf = flight => {
  const code = text(flight?.stand?.code);
  return code === null ? null : normalizeStandCode(code);
};

/**
 * The stands an ELEVANT visit holds (normalized codes): the assigned stand, or the stand suggested for a demo flight
 * not yet imported, of every visit that has not ended (core/mapSelection.js: endsItsVisit). A cancelled leg holds
 * nothing by itself; a cancelled departure leaves the stand to its arrival.
 */
export function ownedStandCodes(flights = []) {
  const rows = (Array.isArray(flights) ? flights : []).filter(flight => flight != null);
  const ended = new Set(rows.filter(endsItsVisit).map(visitOf));
  const owned = new Set();
  for (const flight of rows) {
    if (flight.phase === 'cancelled' || ended.has(visitOf(flight))) continue;
    const code = text(flight.stand?.code) ?? text(flight.suggestedStandCode);
    if (code !== null) owned.add(normalizeStandCode(code));
  }
  return owned;
}

const standIndexes = new WeakMap();

// The box of every active stand of a layout by its normalized code (and its aliases), built once per layout.
function standBoxes(layout) {
  if (!layout || typeof layout !== 'object') return new Map();
  let index = standIndexes.get(layout);
  if (!index) {
    index = new Map();
    for (const stand of layout.stands ?? []) {
      if (stand?.retired === true || !Array.isArray(stand?.polygon) || stand.polygon.length < 4) continue;
      for (const code of [stand.code, ...(stand.aliases ?? [])]) {
        const normalized = normalizeStandCode(code);
        if (normalized !== '' && !index.has(normalized)) index.set(normalized, stand.polygon);
      }
    }
    standIndexes.set(layout, index);
  }
  return index;
}

/** The first box among `codes` that holds `[lon, lat]`, as its code, or `null`. */
function standHolding(point, codes, boxes) {
  for (const code of codes) {
    const ring = boxes.get(code);
    if (ring && pointInPolygon(point, ring)) return code;
  }
  return null;
}

// The fields every aircraft of the map carries, from its flight when it is one.
function flightFields(flight) {
  return {
    kind: flight ? 'aviam' : 'other',
    flightKey: flight?.flightKey ?? null,
    visitKey: flight?.visitKey ?? null,
    legId: flight?.legId ?? null,
    turnaroundId: flight?.turnaroundId ?? null,
    proposalId: flight?.proposalId ?? null,
    direction: flight?.direction ?? null,
    isDemo: flight?.isDemo === true,
    imported: flight?.imported === true,
    phase: flight?.phase ?? null,
    flightNumber: flight?.flightNumber ?? null,
    counterpartIata: flight?.counterpart?.iataCode ?? null,
    standCode: standCodeOf(flight),
  };
}

function liveAircraft(fix, flight, { nowMs, status, staleAfterMs, owned, boxes }) {
  const ageMs = Math.max(0, nowMs - fix.positionAt);
  const hiddenInStand = !flight && fix.onGround && standHolding([fix.lon, fix.lat], owned, boxes) !== null;
  return Object.freeze({
    id: flight ? `f:${flight.flightKey}` : `h:${fix.hex}`,
    hex: fix.hex,
    ...flightFields(flight),
    lon: fix.lon,
    lat: fix.lat,
    altM: fix.altM,
    gsMs: fix.gsMs,
    trackDeg: fix.trackDeg,
    vrateMs: fix.vrateMs,
    onGround: fix.onGround,
    positionAt: fix.positionAt,
    ageS: ageMs / 1_000,
    quality: status === 'Stale' || ageMs > staleAfterMs ? 'stale' : 'live',
    callsign: fix.callsign ?? flight?.callsign ?? null,
    registration: fix.registration ?? flight?.aircraft?.registration ?? null,
    typeIcao: fix.typeIcao ?? flight?.aircraft?.typeIcaoCode ?? null,
    emitterCategory: fix.category,
    squawk: fix.squawk,
    matchedBy: flight ? fix.matchedBy : null,
    hiddenInStand,
  });
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const finiteOrNull = value => (finite(value) ? value : null);

function estimatedAircraft(estimate, flight, nowMs) {
  const positionAt = finite(estimate.positionAt) ? estimate.positionAt : nowMs;
  return Object.freeze({
    id: `f:${flight.flightKey}`,
    hex: null,
    ...flightFields(flight),
    lon: estimate.lon,
    lat: estimate.lat,
    altM: finiteOrNull(estimate.altM),
    gsMs: finiteOrNull(estimate.gsMs),
    trackDeg: heading(estimate.trackDeg),
    vrateMs: finiteOrNull(estimate.vrateMs),
    onGround: estimate.onGround === true,
    positionAt,
    ageS: Math.max(0, nowMs - positionAt) / 1_000,
    quality: 'estimated',
    callsign: flight.callsign ?? null,
    registration: flight.aircraft?.registration ?? null,
    typeIcao: flight.aircraft?.typeIcaoCode ?? null,
    emitterCategory: null,
    squawk: null,
    matchedBy: null,
    hiddenInStand: false,
  });
}

const PICTURES_WITH_AIRCRAFT = new Set(['Live', 'Stale']);

/**
 * What the map draws at `nowMs` (the server's time) from the air picture and flights models (design E1, contracts 2.4):
 * `{ aircraft, byId, flights, source, status, reason, ownedStandCodes, changesAt }`.
 *
 * - A live aircraft whose `matchedFlightKey` names a flight of the window becomes that flight (`kind: 'aviam'`, id
 *   `f:<flightKey>`); one whose key is not in the window stays other traffic (`h:<hex>`). One flight, one aircraft:
 *   when two name the same flight, the newest position wins and the other stays other traffic.
 * - `ageS` counts from the fix to `nowMs`; the aircraft is `live` up to staleAfterSeconds(refreshAfterSeconds) and
 *   `stale` after it, and every aircraft of a `Stale` picture is `stale`. Warming, Unavailable and Disabled carry no
 *   aircraft; `status` and `reason` stay as data.
 * - An ELEVANT flight without a live fix is never given a position. A position the caller estimates (`estimates`:
 *   `{ flightKey, lon, lat, altM?, gsMs?, trackDeg?, vrateMs?, onGround?, positionAt? }`, PR M6) is drawn as
 *   `estimated`, unless the flight already has a live aircraft.
 * - Other traffic on the ground inside the box of a stand an ELEVANT visit holds (ownedStandCodes) is `hiddenInStand`.
 * - `changesAt`: the next instant a live aircraft turns stale without a new read, or `null`.
 *
 * RenderAircraft: `{ id, hex, kind, flightKey, visitKey, legId, turnaroundId, proposalId, direction, lon, lat, altM,
 * gsMs, trackDeg, vrateMs, onGround, positionAt, ageS, quality, isDemo, imported, phase, callsign, flightNumber,
 * registration, typeIcao, emitterCategory, squawk, counterpartIata, standCode, matchedBy, hiddenInStand }`.
 */
export function buildSituation({ picture = null, flights = null, nowMs, estimates = [], layout = MDPC_LAYOUT } = {}) {
  const rows = flights?.flights ?? [];
  const byKey = flights?.byKey ?? new Map(rows.map(flight => [flight.flightKey, flight]));
  const status = picture?.status ?? null;
  const time = finite(nowMs) ? nowMs : (picture?.serverTime ?? 0);
  const staleAfterMs = staleAfterSeconds(picture?.refreshAfterSeconds) * 1_000;
  const fixes = PICTURES_WITH_AIRCRAFT.has(status) ? picture.aircraft.filter(fix => finite(fix.positionAt)) : [];
  const owned = ownedStandCodes(rows);
  const context = { nowMs: time, status, staleAfterMs, owned, boxes: standBoxes(layout) };

  // One flight, one aircraft: the newest position of each key of the window.
  const claimed = new Map();
  for (const fix of fixes) {
    if (fix.matchedFlightKey === null || !byKey.has(fix.matchedFlightKey)) continue;
    const held = claimed.get(fix.matchedFlightKey);
    if (!held || fix.positionAt > held.positionAt) claimed.set(fix.matchedFlightKey, fix);
  }

  const aircraft = fixes.map(fix => {
    const flight = fix.matchedFlightKey !== null && claimed.get(fix.matchedFlightKey) === fix
      ? byKey.get(fix.matchedFlightKey) : null;
    return liveAircraft(fix, flight, context);
  });
  const estimated = new Set();
  for (const estimate of Array.isArray(estimates) ? estimates : []) {
    const flight = byKey.get(estimate?.flightKey);
    if (!flight || claimed.has(flight.flightKey) || estimated.has(flight.flightKey)) continue;
    if (!finite(estimate.lon) || !finite(estimate.lat)) continue;
    estimated.add(flight.flightKey);
    aircraft.push(estimatedAircraft(estimate, flight, time));
  }

  let changesAt = null;
  if (status === 'Live') {
    for (const item of aircraft) {
      if (item.quality !== 'live') continue;
      const turns = item.positionAt + staleAfterMs + 1;
      if (changesAt === null || turns < changesAt) changesAt = turns;
    }
  }

  return Object.freeze({
    aircraft: Object.freeze(aircraft),
    byId: new Map(aircraft.map(item => [item.id, item])),
    flights: rows,
    source: picture?.source ?? null,
    status,
    reason: picture?.reason ?? null,
    ownedStandCodes: owned,
    changesAt,
  });
}

/**
 * What the shell's source list says of the air traffic (admin-occ/live/sourceHealth.js), from the picture's state and
 * its read's (useOccResource): refused → `forbidden`; failed without data → `offline`; not read yet → `idle`. Read:
 * Live → `ok` (`delayed` when the last refresh failed); Stale → `delayed`; Unavailable → `offline`; Disabled →
 * `unconfigured`; Warming → `idle` (nothing to judge yet).
 */
export function airTrafficSourceState(pictureStatus, resourceStatus, { refreshFailed = false } = {}) {
  if (resourceStatus === 'unauthorized' || resourceStatus === 'forbidden') return 'forbidden';
  if (resourceStatus === 'error' || resourceStatus === 'timeout') return 'offline';
  if (resourceStatus !== 'success' && resourceStatus !== 'empty') return 'idle';
  switch (pictureStatus) {
    case 'Live': return refreshFailed ? 'delayed' : 'ok';
    case 'Stale': return 'delayed';
    case 'Unavailable': return 'offline';
    case 'Disabled': return 'unconfigured';
    default: return 'idle';
  }
}
