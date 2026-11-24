'use client';

import { OCC_AIR_PICTURE_LIMITS } from '@elevant/api-client';
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { occMapService } from '../../services/occMapService';
import { serverClock, syncServerClock } from '../../services/serverClock';
import { useDepartmentAccess } from '../access/DepartmentAccessContext';
import { OCC_COALESCE_MS, OCC_SAFETY_POLL_MS } from '../admin-occ/live/occCadence';
import { useOccResource } from '../admin-occ/live/useOccResource';
import { useOptionalOccShellChannel } from '../admin-occ/shell/occShellContext';
import { useLanguage } from '../../i18n/LanguageScope';
import { createRenderClock } from './core/frameLoop';
import { MAP_PERMISSIONS } from './mapPermissions';
import { createMotionStore } from './traffic/motionStore';
import { buildRoute } from './traffic/routeFeatures';
import {
  airTrafficSourceState, buildSituation, selectionTarget, toFlightsModel, toPictureModel, toTrackModel,
} from './traffic/situationModel';
import { createTelemetryStore } from './traffic/telemetryStore';
import { createTrailStore, trailFeatures } from './traffic/trailStore';

// What an OCC map shows of the sky and of the ELEVANT flights (contracts 1.3 and 2.7), read through the shell's single
// loop (useOccResource): the air picture at the pace the server asks for, and the map flights on `occ_planning` plus a
// safety poll. Both pause while the tab is hidden. The page passes the service (occMapService, or the simulated adapter
// in the lab and the tests); this hook never chooses the source. Every read goes into the map's motion store (PR M6,
// traffic/motionStore.js), which estimates the ELEVANT flights without a live fix (Decision F-1, the demo flight) and
// gives the map its frame-by-frame motion on the render clock (core/frameLoop.js); no read is added for it.

// Any of them lets an OCC account read the map (contracts 1.3, OccMapAccess); the list is maps/mapPermissions.js's.

// Runs `callback` when the browser is idle (at most 250 ms later), else on the next turn of the event loop.
function deferToIdle(callback) {
  if (typeof globalThis.requestIdleCallback === 'function') globalThis.requestIdleCallback(callback, { timeout: 250 });
  else globalThis.setTimeout(callback, 0);
}

export { MAP_PERMISSIONS };

/**
 * The pace of the air picture: the `refreshAfterSeconds` of its last answer, never faster (10 s before the first one);
 * after failed reads, twice as long for each failure, up to a minute.
 */
export function airPictureDelayMs(picture, failures = 0) {
  const asked = picture?.refreshAfterSeconds;
  const base = (Number.isFinite(asked) && asked > 0 ? asked : OCC_AIR_PICTURE_LIMITS.minRefreshSeconds) * 1_000;
  if (!(failures > 0)) return base;
  return Math.max(base, Math.min(base * 2 ** failures, OCC_AIR_PICTURE_LIMITS.maxRefreshSeconds * 1_000));
}

/**
 * The two reads of the map and their cadence (contracts 2.7), one table for this hook and the request-budget test.
 * `pollMs` counts from the last finished read; the air picture's is a function of its last answer and of the failed
 * reads since.
 */
export const MAP_SITUATION_READS = Object.freeze({
  airPicture: Object.freeze({ key: 'occMap.airPicture', read: 'getOccAirPicture', resources: Object.freeze([]),
    pollMs: airPictureDelayMs, coalesceMs: OCC_COALESCE_MS }),
  mapFlights: Object.freeze({ key: 'occMap.flights', read: 'getOccMapFlights', resources: Object.freeze(['occ_planning']),
    pollMs: OCC_SAFETY_POLL_MS, coalesceMs: OCC_COALESCE_MS }),
});

/** The clock is asked again when the tab shows, unless it was asked this recently. */
export const PING_MIN_INTERVAL_MS = 30_000;

const ANSWERED = new Set(['success', 'empty']);
const FAILED = new Set(['error', 'timeout']);
const REFUSED = new Set(['unauthorized', 'forbidden']);
const HEX = /^[0-9a-f]{6}$/i;
const hasNoAircraft = picture => picture.aircraft.length === 0;
const hasNoFlights = flights => flights.flights.length === 0;

/**
 * The five states of the map's remote view (plus `idle` while it reads nothing). Both reads share their access rule,
 * so a refused flights read, or a 401 on either, is `unauthorized`. Each read fails alone: the ELEVANT flights decide
 * the map's state, and only a flights read that failed is an `error`. An air picture that fails, or that the server
 * refuses at a station without live traffic (a 404, which useOccResource reads as forbidden), leaves the map with its
 * flights and no aircraft (`success` or `empty`, `picture` null), and the source state says why
 * (traffic/situationModel.js: airTrafficSourceState).
 */
function situationStatus({ reading, access, granted, picture, flights, situation }) {
  if (!reading) return 'idle';
  if (!access) return 'loading';
  if (!granted) return 'unauthorized';
  if (REFUSED.has(flights.status) || picture.status === 'unauthorized') return 'unauthorized';
  const pictureDone = ANSWERED.has(picture.status) || FAILED.has(picture.status) || picture.status === 'forbidden';
  const flightsDone = ANSWERED.has(flights.status) || FAILED.has(flights.status);
  if (!pictureDone || !flightsDone) return 'loading';
  if (FAILED.has(flights.status)) return 'error';
  const drawn = situation.aircraft.some(item => !item.hiddenInStand);
  return drawn || situation.flights.length > 0 ? 'success' : 'empty';
}

/**
 * The live situation of a station's map.
 *
 * - `stationId` (none: nothing is read, `idle`); `enabled: false` reads nothing either.
 * - `service`: `{ getAirPicture, getMapFlights, getAircraftTrack, ping, clock }` (src/services/occMapService.js).
 * - `selectedHex`: the chosen aircraft; its track is read once each time it changes.
 * - `selection`: the URL selection of the map (`{ kind: 'flight' | 'aircraft', id }`, contracts 2.1). It names the
 *   `target` (traffic/situationModel.js: selectionTarget); without `selectedHex`, the target's aircraft is the chosen
 *   one, whose track is read.
 * - `allTrails`: also the trails of other traffic («Estelas de todo el tráfico», their last 2 minutes; the map shows
 *   them only while that layer is on).
 *
 * Reads only when the account holds any of MAP_PERMISSIONS (otherwise `unauthorized`, with no request). The air picture
 * asks `trails=short` until it has one of the station, then `none`, every `refreshAfterSeconds`; its state (Live,
 * Stale, Warming, Unavailable, Disabled) is data, never an error, and a failed or refused read of it leaves the map
 * with its flights (situationStatus). The flights re-read on `occ_planning` (at most one every 3 s) and every 60 s.
 * The server clock is asked once on start and when the tab shows again. The air traffic's state goes to the shell's
 * source list (`sourceState`).
 *
 * Returns `{ status: 'loading'|'success'|'empty'|'error'|'unauthorized'|'idle', picture, flights, situation, trails,
 * track, target, route, routeAt, telemetry, clock, sourceState, refreshing, refreshFailed, retry, motion, renderClock,
 * traffic }`: the models of situationModel.js, the trails as a FeatureCollection, the chosen aircraft's track (or null),
 * what the selection names (or null), its route (traffic/routeFeatures.js: buildRoute, PR M6: from its aircraft's
 * trail and the trajectory of the motion store, the split where the situation has it) and `routeAt(tMs, [lng, lat])`,
 * the same route with the aircraft where a frame draws it, the
 * telemetry store the data block reads (traffic/telemetryStore.js, fed with every situation and reading the moving
 * aircraft where the map draws them) and the clock the reads feed. `sourceState` is the state of the air traffic from
 * the picture's read alone, for its chip (ui/MapSourceStatus.jsx) and the shell; `refreshing` and `refreshFailed`
 * speak of the two reads together, so they never describe the traffic. PR M6 adds the motion store
 * (traffic/motionStore.js: the estimates of the situation come from it), the render clock the map draws at
 * (core/frameLoop.js: «Pausar movimiento» freezes it while the reads go on) and `traffic`, the `traffic` prop of OccMap
 * (`{ aircraft, trails, route, routeAt, source, motion }`).
 */
export function useMapSituation({ stationId = null, enabled = true, service = occMapService, selectedHex = null,
  selection = null, allTrails = false } = {}) {
  const { access } = useDepartmentAccess();
  const granted = MAP_PERMISSIONS.find(code => access?.can(code)) ?? null;
  const reading = Boolean(enabled) && typeof stationId === 'string' && stationId !== '';
  const active = reading && granted !== null;
  const scopeKey = reading ? stationId : '';
  const clock = service.clock ?? serverClock;
  const hex = typeof selectedHex === 'string' && HEX.test(selectedHex) ? selectedHex.toLowerCase() : null;

  const [trailStore] = useState(createTrailStore);
  const trailSnapshot = useSyncExternalStore(trailStore.subscribe, trailStore.getSnapshot, trailStore.getSnapshot);
  const failuresRef = useRef(0);
  // The station whose short trail arrived: from then on the picture asks for none.
  const shortTrailRef = useRef(null);

  // A new station starts its trails, its pace and its short trail again (before its first read starts below).
  useEffect(() => {
    trailStore.clear();
    failuresRef.current = 0;
    shortTrailRef.current = null;
  }, [scopeKey, trailStore]);

  const loadPicture = useCallback(async ({ signal }) => {
    const trails = shortTrailRef.current === stationId ? 'none' : 'short';
    try {
      const picture = toPictureModel(await service.getAirPicture({ stationId, trails, signal }));
      // An answer that arrives after its read was cancelled draws nothing.
      if (signal?.aborted) throw signal.reason ?? new DOMException('The read was cancelled.', 'AbortError');
      failuresRef.current = 0;
      shortTrailRef.current = stationId;
      trailStore.ingestPicture(picture);
      return picture;
    } catch (error) {
      if (!isAbortError(error)) failuresRef.current += 1;
      throw error;
    }
  }, [service, stationId, trailStore]);

  const loadFlights = useCallback(async ({ signal }) =>
    toFlightsModel(await service.getMapFlights({ stationId, signal })), [service, stationId]);

  // Read when the poll is armed, after the read that changed the failure count.
  const pollPicture = useCallback(picture => MAP_SITUATION_READS.airPicture.pollMs(picture, failuresRef.current), []);

  const permission = granted ?? MAP_PERMISSIONS[0];
  const pictureRead = useOccResource({
    key: MAP_SITUATION_READS.airPicture.key, load: loadPicture, permission, scopeKey, enabled: reading,
    resources: MAP_SITUATION_READS.airPicture.resources, pollMs: pollPicture,
    coalesceMs: MAP_SITUATION_READS.airPicture.coalesceMs, isEmpty: hasNoAircraft,
  });
  const flightsRead = useOccResource({
    key: MAP_SITUATION_READS.mapFlights.key, load: loadFlights, permission, scopeKey, enabled: reading,
    resources: MAP_SITUATION_READS.mapFlights.resources, pollMs: MAP_SITUATION_READS.mapFlights.pollMs,
    coalesceMs: MAP_SITUATION_READS.mapFlights.coalesceMs, isEmpty: hasNoFlights,
  });

  // The server clock: once on start and when the tab shows again (not twice within PING_MIN_INTERVAL_MS).
  const lastPingRef = useRef(null);
  useEffect(() => {
    if (!active) return undefined;
    const controller = new AbortController();
    const sync = () => {
      lastPingRef.current = clock.localNow();
      syncServerClock({ ping: service.ping, clock, signal: controller.signal }).catch(() => {});
    };
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') return;
      if (lastPingRef.current !== null && clock.localNow() - lastPingRef.current < PING_MIN_INTERVAL_MS) return;
      sync();
    };
    sync();
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      abortForEffectCleanup(controller);
    };
  }, [active, clock, service]);

  // The motion of the map (PR M6): the render clock it draws at, over the clock the reads feed, and the motion store,
  // one each for the life of the hook, as the telemetry store below.
  const [renderClock] = useState(() => createRenderClock({ clock }));
  // A rebuild from an aged fix runs when the browser is idle, never inside a frame (CN-18).
  const [motion] = useState(() => createMotionStore({ clock: renderClock, defer: deferToIdle }));

  // The situation at the newest server instant known: the last answer's, or the next instant something changes without
  // a new read (a live aircraft turning stale, a demo flight appearing, landing, parking or leaving). Every read goes
  // into the motion store first, whose estimates the situation draws; ingesting the same reads again does nothing.
  const [tickAt, setTickAt] = useState(0);
  const picture = pictureRead.data;
  const flights = flightsRead.data;
  const nowMs = Math.max(picture?.serverTime ?? 0, flights?.serverTime ?? 0, tickAt);
  const estimated = useMemo(() => {
    motion.ingest({ picture, flights });
    return { estimates: motion.estimatesAt(nowMs), changeAt: motion.nextChangeAt(nowMs) };
  }, [flights, motion, nowMs, picture]);
  const situation = useMemo(() => buildSituation({ picture, flights, nowMs, estimates: estimated.estimates,
    estimatesChangeAt: estimated.changeAt }), [estimated, flights, nowMs, picture]);
  useEffect(() => {
    const due = situation.changesAt;
    if (due === null) return undefined;
    const timer = setTimeout(() => setTickAt(Math.max(due, clock.now())), Math.max(0, due - clock.now()));
    return () => clearTimeout(timer);
  }, [clock, situation]);

  // What the selection names, and the chosen aircraft: the one asked for, else the selection's own (contracts 2.1).
  const selectionKind = typeof selection?.kind === 'string' ? selection.kind : null;
  const selectionId = selection?.id == null ? null : String(selection.id);
  const target = useMemo(() => (selectionKind === null ? null
    : selectionTarget({ kind: selectionKind, id: selectionId }, situation)), [selectionId, selectionKind, situation]);
  const targetHex = target?.aircraft?.hex;
  const chosenHex = hex ?? (typeof targetHex === 'string' && HEX.test(targetHex) ? targetHex.toLowerCase() : null);

  // The chosen aircraft's track, once per choice: it replaces the older part of that trail.
  const [track, setTrack] = useState(null);
  useEffect(() => {
    if (!active || chosenHex === null) return undefined;
    const controller = new AbortController();
    service.getAircraftTrack({ stationId, hex: chosenHex, signal: controller.signal }).then(response => {
      if (controller.signal.aborted) return;
      const model = toTrackModel(response);
      trailStore.ingestTrack(model.hex, model.points);
      setTrack(model);
    }, () => {});
    return () => abortForEffectCleanup(controller);
  }, [active, chosenHex, service, stationId, trailStore]);
  const chosenTrack = track !== null && track.hex === chosenHex ? track : null;

  const aviamHexes = useMemo(() => new Set(situation.aircraft
    .filter(item => item.kind === 'aviam' && item.hex !== null).map(item => item.hex)), [situation]);
  const trails = useMemo(() => trailFeatures(trailSnapshot, { includeOther: allTrails, selectedHex: chosenHex, aviamHexes,
    nowMs }), [allTrails, aviamHexes, chosenHex, nowMs, trailSnapshot]);

  // The chosen flight's route (PR M6, traffic/routeFeatures.js): what it flew observed (its aircraft's trail, the
  // server's track in it once read), estimated and still to fly, along the trajectory the motion store plans for it (or
  // builds from its schedule for the route alone), in the screen's language. `route` is where the situation has it now,
  // for the legend; `routeAt(tMs, [lng, lat])` is the same route where the map draws the aircraft on a frame
  // (core/OccMap.jsx), so the split between flown and still to fly follows it.
  const { language } = useLanguage();
  const routeHex = typeof target?.aircraft?.hex === 'string' ? target.aircraft.hex.toLowerCase() : null;
  const routeTrail = routeHex === null ? null : trailSnapshot.entries.get(routeHex)?.points ?? null;
  const routeInputs = useMemo(() => (target === null ? null : {
    target,
    segments: routeTrail === null ? [] : [routeTrail],
    track: chosenTrack,
    trajectory: target.flight ? motion.trajectoryForRoute(target.flight) : null,
    breakMs: trailSnapshot.breakMs,
    language,
  }), [chosenTrack, language, motion, routeTrail, target, trailSnapshot.breakMs]);
  const route = useMemo(() => (routeInputs === null ? buildRoute() : buildRoute({ ...routeInputs, nowMs })),
    [nowMs, routeInputs]);
  const routeAt = useCallback((tMs, aircraft) => (routeInputs === null ? buildRoute()
    : buildRoute({ ...routeInputs, nowMs: tMs, aircraft })), [routeInputs]);

  // The telemetry the data block reads, outside React: every new situation goes in, and it ticks while it is watched,
  // reading each aircraft where the map draws it on the render clock.
  const [telemetry] = useState(() => createTelemetryStore({ clock: renderClock,
    sample: (id, tMs, aircraft) => motion.sampleOne(id, tMs, aircraft) }));
  useEffect(() => {
    telemetry.set(situation);
  }, [situation, telemetry]);

  const status = situationStatus({ reading, access, granted: granted !== null, picture: pictureRead,
    flights: flightsRead, situation });

  // The air traffic in the shell's source list, with the tags of what the map draws.
  const channel = useOptionalOccShellChannel();
  const sourceState = airTrafficSourceState(picture?.status ?? null, pictureRead.status,
    { refreshFailed: pictureRead.refreshFailed, flightsStatus: flightsRead.status });
  const sourceAt = sourceState === 'ok' || sourceState === 'delayed' ? (picture?.observedAt ?? null) : null;
  const sourceReason = picture?.reason ?? null;
  const sourceTags = [
    situation.aircraft.some(item => item.isDemo && !item.hiddenInStand) ? 'demo' : null,
    situation.aircraft.some(item => item.quality === 'estimated') ? 'estimated' : null,
  ].filter(Boolean).join(' ');
  useEffect(() => {
    if (!channel || !reading) return;
    channel.sources.report('airTraffic', { state: sourceState, at: sourceAt, detail: sourceReason,
      tags: sourceTags === '' ? [] : sourceTags.split(' ') });
  }, [channel, reading, sourceAt, sourceReason, sourceState, sourceTags]);
  useEffect(() => (channel && reading ? () => channel.sources.remove('airTraffic') : undefined), [channel, reading]);

  const { retry: retryPicture } = pictureRead;
  const { retry: retryFlights } = flightsRead;
  const retry = useCallback(() => {
    retryPicture();
    retryFlights();
  }, [retryFlights, retryPicture]);
  const refreshing = pictureRead.refreshing || flightsRead.refreshing;
  const refreshFailed = pictureRead.refreshFailed || flightsRead.refreshFailed;

  // What OccMap draws of the traffic, with the motion its frames sample and the route they rebuild (core/OccMap.jsx: its
  // `traffic` prop), and the map flights, whose counterparts the references emphasise (PR M8).
  const traffic = useMemo(() => Object.freeze({ aircraft: situation.aircraft, trails, route, routeAt,
    source: situation.source, motion, flights: situation.flights }), [motion, route, routeAt, situation, trails]);

  return useMemo(() => ({
    status, picture, flights, situation, trails, track: chosenTrack, target, route, routeAt, telemetry, clock,
    sourceState, refreshing, refreshFailed, retry, motion, renderClock, traffic,
  }), [chosenTrack, clock, flights, motion, picture, refreshFailed, refreshing, renderClock, retry, route, routeAt,
    situation, sourceState, status, target, telemetry, traffic, trails]);
}
