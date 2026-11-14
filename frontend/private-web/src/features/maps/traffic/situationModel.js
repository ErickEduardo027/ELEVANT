import { normalizeStandCode } from '../../../services/standCodes';
import { parseInstant } from '../../../services/serverClock';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { pointInPolygon } from '../airport/geo';
import { endsItsVisit, matchFlight } from '../core/mapSelection';
import { selectedAircraftId } from './trafficFeatures';

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
const finite = value => typeof value === 'number' && Number.isFinite(value);
const hasMilestone = (flight, code) => Array.isArray(flight.milestones)
  && flight.milestones.some(milestone => milestone?.code === code && milestone.actualAt != null);

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

/**
 * Whether the aircraft of a visit (its legs) is on stand `code` at `nowMs`, by the first evidence there is, in the
 * order the stand states read it (contracts 2.4: until then the stand is «Llegando»): for a demo flight, the server's
 * on-block instant has come (contracts 1.1); else a recorded BLOCK_ON; else the position the map has of its aircraft,
 * live or estimated, on the ground inside the stand's box; else the arrival's actual time when it is the on-block
 * (`actualKind: 'OnBlock'`, OCC's «Registrar llegada»). A runway time only says that the aircraft landed: it is still
 * on its way to the stand.
 */
function onTheStand(legs, code, { nowMs, positions, boxes }) {
  const demo = legs.map(leg => leg.demo).find(value => value != null && typeof value === 'object') ?? null;
  const onBlockAt = parseInstant(demo?.onBlockAt ?? null);
  if (onBlockAt !== null) return finite(nowMs) && nowMs >= onBlockAt;
  if (legs.some(leg => hasMilestone(leg, 'BLOCK_ON'))) return true;
  const box = boxes.get(code);
  const position = legs.map(leg => positions.get(leg.flightKey)).find(item => item != null) ?? null;
  if (box && position) return position.onGround === true && pointInPolygon([position.lon, position.lat], box);
  return legs.some(leg => leg.direction === 'Arrival' && leg.actualAt != null && leg.actualKind === 'OnBlock');
}

/**
 * The stands an ELEVANT or demo aircraft is on at `nowMs`, the server's time (normalized codes). Other traffic on the
 * ground is hidden only inside «a stand owned by an AVIAM or demo aircraft» (contracts 2.4): from the moment that
 * aircraft is on it until it leaves. A stand whose flight is still to come, or is landing or taxiing in, hides nothing,
 * so an aircraft parked where an arrival is due stays on the map: that is the conflict OCC has to see.
 *
 * A visit (its legs share one visitKey) is judged whole. It holds its assigned stand, never a suggestion: a demo flight
 * nobody imported waits on the apron for its stand (contracts 2.3). It holds it while no leg ends the visit
 * (core/mapSelection.js: endsItsVisit) and its aircraft is on the stand (onTheStand). A cancelled leg holds nothing by
 * itself; a cancelled departure leaves the stand to its arrival.
 *
 * `positions` maps a flightKey to where the map has that flight's aircraft (`{ lon, lat, onGround }`, live or
 * estimated); `layout` gives the stand boxes.
 */
export function ownedStandCodes(flights = [], { nowMs, positions = new Map(), layout = MDPC_LAYOUT } = {}) {
  const visits = new Map();
  for (const flight of Array.isArray(flights) ? flights : []) {
    if (flight == null) continue;
    const legs = visits.get(visitOf(flight)) ?? [];
    legs.push(flight);
    visits.set(visitOf(flight), legs);
  }
  const context = { nowMs, positions: positions instanceof Map ? positions : new Map(), boxes: standBoxes(layout) };
  const owned = new Set();
  for (const legs of visits.values()) {
    if (legs.some(endsItsVisit)) continue;
    const codes = new Set(legs.filter(leg => leg.phase !== 'cancelled').map(standCodeOf).filter(code => code !== null));
    for (const code of codes) if (onTheStand(legs, code, context)) owned.add(code);
  }
  return owned;
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
    // What the flight knows of its aircraft, for its silhouette (aircraft/types.js: resolveAircraftType).
    model: text(flight?.aircraft?.model),
    sizeCategory: flight?.aircraft?.sizeCategory ?? null,
  };
}

// What only the motion of the map knows (PR M6, traffic/motionStore.js): an aircraft drawn from a fix carries none of
// it in the situation; the map's frames fill it in.
const NO_MOTION = Object.freeze({ statusKey: null, timeScale: null, opacity: null, mode: null });

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
    ...NO_MOTION,
  });
}

const finiteOrNull = value => (finite(value) ? value : null);
const MODES = new Set(['live', 'coast', 'estimate']);

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
    statusKey: typeof estimate.statusKey === 'string' ? estimate.statusKey : null,
    timeScale: finite(estimate.timeScale) && estimate.timeScale > 0 ? estimate.timeScale : 1,
    opacity: finite(estimate.opacity) ? Math.min(1, Math.max(0, estimate.opacity)) : 1,
    mode: MODES.has(estimate.mode) ? estimate.mode : 'estimate',
  });
}

const PICTURES_WITH_AIRCRAFT = new Set(['Live', 'Stale']);

// The old key of a visit OCC linked to a planned flight (contracts 1.3, rule 3-N07): the proposal's «p:» key ends and
// the leg keeps its «l:» key, while the air picture can still name the old one for a few seconds (the server keeps its
// matching keys for 20 s per station). Such a key resolves to its row through the row's proposalId, as a selection does
// (core/mapSelection.js: matchFlight); a key that a row of the window holds is always that row.
function linkedKeys(rows, byKey) {
  const linked = new Map();
  for (const flight of rows) {
    if (flight?.proposalId == null) continue;
    const key = `p:${flight.proposalId}`;
    if (!byKey.has(key) && !linked.has(key)) linked.set(key, flight);
  }
  return linked;
}

/**
 * Which flight each fix of the air picture is (contracts 1.3): `{ fixes, claimed, flightOf }`. `fixes` are the
 * picture's aircraft with a position instant (none unless the picture is Live or Stale); `claimed` maps a flightKey to
 * the fix that is its aircraft, the newest when two name the same flight by either of its keys (one flight, one
 * aircraft); `flightOf(key)` finds the flight row of a key of the window, also the old «p:» key of a visit linked under
 * 3-N07 (linkedKeys). buildSituation and the motion store (traffic/motionStore.js) read the picture the same way.
 */
export function claimFixes({ picture = null, flights = null } = {}) {
  const rows = flights?.flights ?? [];
  const byKey = flights?.byKey ?? new Map(rows.map(flight => [flight.flightKey, flight]));
  const linked = linkedKeys(rows, byKey);
  const flightOf = key => (key == null ? null : byKey.get(key) ?? linked.get(key) ?? null);
  const fixes = PICTURES_WITH_AIRCRAFT.has(picture?.status) ? picture.aircraft.filter(fix => finite(fix.positionAt)) : [];
  const claimed = new Map();
  for (const fix of fixes) {
    const flight = flightOf(fix.matchedFlightKey);
    if (flight === null) continue;
    const held = claimed.get(flight.flightKey);
    if (!held || fix.positionAt > held.positionAt) claimed.set(flight.flightKey, fix);
  }
  return { fixes, claimed, flightOf };
}

/**
 * The id of the aircraft a fix draws (`f:<flightKey>` when it is a flight's, else `h:<hex>`) and its flight (or
 * `null`), from claimFixes.
 */
export function fixIdentity(fix, { claimed, flightOf }) {
  const flight = flightOf(fix?.matchedFlightKey);
  const owner = flight !== null && claimed.get(flight.flightKey) === fix ? flight : null;
  return { id: owner ? `f:${owner.flightKey}` : `h:${fix.hex}`, flight: owner };
}

/**
 * What the map draws at `nowMs` (the server's time) from the air picture and flights models (design E1, contracts 2.4):
 * `{ aircraft, byId, flights, source, status, reason, ownedStandCodes, changesAt }`.
 *
 * - A live aircraft whose `matchedFlightKey` names a flight of the window becomes that flight (`kind: 'aviam'`, id
 *   `f:<flightKey>`), also by the old «p:» key of a visit linked under 3-N07 (linkedKeys); one whose key is not in the
 *   window stays other traffic (`h:<hex>`). One flight, one aircraft: when two name the same flight, by either key, the
 *   newest position wins and the other stays other traffic.
 * - `ageS` counts from the fix to `nowMs`; the aircraft is `live` up to staleAfterSeconds(refreshAfterSeconds) and
 *   `stale` after it, and every aircraft of a `Stale` picture is `stale`. Warming, Unavailable and Disabled carry no
 *   aircraft; `status` and `reason` stay as data.
 * - An ELEVANT flight without a live fix is never given a position. A position the caller estimates (`estimates`:
 *   `{ flightKey, lon, lat, altM?, gsMs?, trackDeg?, vrateMs?, onGround?, positionAt?, statusKey?, timeScale?,
 *   opacity?, mode? }`, PR M6: traffic/motionStore.js) is drawn as `estimated`, unless the flight already has a live
 *   aircraft; its `statusKey` (a demo's «Esperando posición», «Cancelado por el proveedor (demo)»), `timeScale` (1
 *   unless the part it is in was scaled), `opacity` (1 unless it fades out) and `mode` ('estimate' unless given) go
 *   with it.
 * - Other traffic on the ground inside the box of a stand an ELEVANT or demo aircraft is on (ownedStandCodes, with the
 *   live and estimated positions of the ELEVANT flights) is `hiddenInStand`.
 * - `changesAt`: the next instant a live aircraft turns stale without a new read, or `estimatesChangeAt` (the motion
 *   store's next instant that changes what is estimated: an appearance, a touchdown, an on-block, an off-block, a
 *   vanishing) when that comes first; `null` without either.
 *
 * RenderAircraft: `{ id, hex, kind, flightKey, visitKey, legId, turnaroundId, proposalId, direction, lon, lat, altM,
 * gsMs, trackDeg, vrateMs, onGround, positionAt, ageS, quality, isDemo, imported, phase, callsign, flightNumber,
 * registration, typeIcao, model, sizeCategory, emitterCategory, squawk, counterpartIata, standCode, matchedBy,
 * hiddenInStand, statusKey, timeScale, opacity, mode }` (`model` and `sizeCategory` from the ELEVANT flight's aircraft,
 * null for other traffic; the last four are the estimate's, and `null` on an aircraft drawn from a fix, whose motion
 * the map's frames add: traffic/motionStore.js).
 */
export function buildSituation({
  picture = null, flights = null, nowMs, estimates = [], estimatesChangeAt = null, layout = MDPC_LAYOUT,
} = {}) {
  const rows = flights?.flights ?? [];
  const status = picture?.status ?? null;
  const time = finite(nowMs) ? nowMs : (picture?.serverTime ?? 0);
  const staleAfterMs = staleAfterSeconds(picture?.refreshAfterSeconds) * 1_000;
  // One flight, one aircraft: the newest position of each flight of the window, whichever of its keys names it.
  const { fixes, claimed, flightOf } = claimFixes({ picture, flights });
  // A position the caller estimated, for a flight without a live aircraft: one per flight.
  const estimated = new Map();
  for (const estimate of Array.isArray(estimates) ? estimates : []) {
    const flight = flightOf(estimate?.flightKey);
    if (flight === null || claimed.has(flight.flightKey) || estimated.has(flight.flightKey)) continue;
    if (!finite(estimate.lon) || !finite(estimate.lat)) continue;
    estimated.set(flight.flightKey, { estimate, flight });
  }

  // The stands an ELEVANT or demo aircraft is on, also from where the map has each flight's aircraft.
  const positions = new Map();
  for (const [key, fix] of claimed) positions.set(key, { lon: fix.lon, lat: fix.lat, onGround: fix.onGround });
  for (const [key, { estimate }] of estimated) {
    positions.set(key, { lon: estimate.lon, lat: estimate.lat, onGround: estimate.onGround === true });
  }
  const owned = ownedStandCodes(rows, { nowMs: time, positions, layout });
  const context = { nowMs: time, status, staleAfterMs, owned, boxes: standBoxes(layout) };

  const aircraft = fixes.map(fix => {
    const flight = flightOf(fix.matchedFlightKey);
    return liveAircraft(fix, flight !== null && claimed.get(flight.flightKey) === fix ? flight : null, context);
  });
  for (const { estimate, flight } of estimated.values()) aircraft.push(estimatedAircraft(estimate, flight, time));

  let changesAt = null;
  if (status === 'Live') {
    for (const item of aircraft) {
      if (item.quality !== 'live') continue;
      const turns = item.positionAt + staleAfterMs + 1;
      if (changesAt === null || turns < changesAt) changesAt = turns;
    }
  }
  if (finite(estimatesChangeAt) && (changesAt === null || estimatesChangeAt < changesAt)) changesAt = estimatesChangeAt;

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
 * What a selection of the URL names on the map (contracts 2.1): `{ kind: 'flight' | 'aircraft', flight, aircraft }`,
 * or `null` when it names nothing the map knows.
 * - `flightId` (`kind: 'flight'`): `aircraft` is the aircraft the map draws for it (live, or estimated), the one the
 *   map draws in cyan, or `null` while it has no position. `flight` is that aircraft's own flight when there is one:
 *   a visitKey or a turnaround id names both legs of a visit, and once its arrival has happened the picture matches
 *   the aircraft to the departure (one flight, one aircraft), so the drawn aircraft may be the other leg's. Without an
 *   aircraft, the flight of the window that matchFlight finds by its flightKey, visitKey, leg id, turnaround id or the
 *   old `p:` key of a visit OCC linked to a planned flight (its proposalId): of a visit, its arrival.
 * - `hex` (`kind: 'aircraft'`): the drawn aircraft with that ADS-B address and, when the picture matched it to a
 *   flight of the window, that flight (else `flight` is `null`).
 * The aircraft comes from the same rule that draws the selection (traffic/trafficFeatures.js: selectedAircraftId), and
 * the flight from the aircraft, so the data block, the cyan aircraft, its ring and its route always speak of the same
 * leg.
 */
export function selectionTarget(selection, situation) {
  if (!selection || selection.id == null || String(selection.id).trim() === '') return null;
  const aircraft = situation?.aircraft ?? [];
  const flights = situation?.flights ?? [];
  const chosenId = selectedAircraftId(aircraft, selection);
  const chosen = chosenId === null ? null : situation?.byId?.get(chosenId) ?? aircraft.find(item => item.id === chosenId) ?? null;
  // The leg the chosen aircraft flies: the flight the picture matched it to, or the one it was estimated for.
  const chosenFlight = chosen?.flightKey == null ? null : flights.find(row => row?.flightKey === chosen.flightKey) ?? null;
  if (selection.kind === 'flight') {
    const flight = chosenFlight ?? matchFlight(flights, selection.id);
    return flight ? Object.freeze({ kind: 'flight', flight, aircraft: chosen }) : null;
  }
  if (selection.kind === 'aircraft') {
    if (chosen === null) return null;
    return Object.freeze({ kind: 'aircraft', flight: chosenFlight, aircraft: chosen });
  }
  return null;
}

const SETTLED_READS = new Set(['success', 'empty', 'error', 'timeout']);
const REFUSED_READS = new Set(['unauthorized', 'forbidden']);

/**
 * What the shell's source list says of the air traffic (admin-occ/live/sourceHealth.js), from the picture's state and
 * its read's (useOccResource), and the state of the flights read (`flightsStatus`):
 * - a 401 → `forbidden`;
 * - refused (403 or 404) → `forbidden` when the flights are refused too, `unconfigured` once they answer or fail, and
 *   `idle` until then. Both reads share their access rule (contracts 1.3), so a refusal of the account refuses both: a
 *   refusal that only the air picture gets is the 404 of a station without live traffic (`AirTraffic:StationCode`),
 *   where the environment does not provide it;
 * - failed without data → `offline`; not read yet → `idle`.
 * Read: Live → `ok` (`delayed` when the last refresh failed); Stale → `delayed`; Unavailable → `offline`; Disabled →
 * `unconfigured`; Warming → `idle` (nothing to judge yet).
 */
export function airTrafficSourceState(pictureStatus, resourceStatus,
  { refreshFailed = false, flightsStatus = null } = {}) {
  if (resourceStatus === 'unauthorized') return 'forbidden';
  if (resourceStatus === 'forbidden') {
    if (REFUSED_READS.has(flightsStatus)) return 'forbidden';
    return SETTLED_READS.has(flightsStatus) ? 'unconfigured' : 'idle';
  }
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
