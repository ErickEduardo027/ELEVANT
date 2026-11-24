'use client';

import { useSyncExternalStore } from 'react';
import { serverClock } from '../../../services/serverClock';

// The telemetry of the aircraft on a map, outside React (design E4, Decision E-1): the data block reads the chosen
// aircraft's altitude, speed, track and the age of its position through useSyncExternalStore, so the age counts up
// without a render of the map, and React renders the card only when a value it shows changes. The store ticks at 4 Hz
// while someone watches it and the tab is visible; between ticks nothing runs. With a sampler (PR M6: the motion
// store's sampleOne) each tick reads the aircraft where the map draws it at the clock's time, which is the render
// clock: «Pausar movimiento» freezes the telemetry with the map.

/** How often the store ticks while it is watched and the tab shows: 4 Hz. */
export const TELEMETRY_INTERVAL_MS = 250;

const FOOT_M = 0.3048;
const KNOT_MS = 1852 / 3_600;
const FOOT_PER_MINUTE_MS = FOOT_M / 60;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const round = (value, unit) => (finite(value) ? Math.round(value / unit) : null);

/**
 * What the data block shows of `aircraft` (a RenderAircraft of traffic/situationModel.js, or one the motion store
 * sampled) at `nowMs`, the server's time, in the units of the screen: `{ altFt, gsKt, trackDeg, vrate, ageS,
 * positionAt, quality, onGround, mode, statusKey, timeScale, opacity, runwayIdent, runwaySource }`, with feet, knots,
 * whole degrees, feet per minute, whole seconds since its position (never below 0) and the instant of that position in
 * milliseconds (a stale position says its time: traffic/stationTime.js); a value it does not know is `null`. From the
 * motion (PR M6): its hand-off mode ('live', 'coast', 'estimate' or `null`), the status of its plan (a demo's
 * «Esperando posición»), the time scale of the part it is in (1 in real time), its opacity (1 unless it fades out) and
 * the runway its plan uses with where that choice comes from, the stand it stands parked on and a mismatch with its
 * assigned stand (CN-31). No aircraft, `null`.
 */
export function telemetryAt(aircraft, nowMs) {
  if (aircraft == null) return null;
  const track = round(aircraft.trackDeg, 1);
  return Object.freeze({
    altFt: round(aircraft.altM, FOOT_M),
    gsKt: round(aircraft.gsMs, KNOT_MS),
    trackDeg: track === null ? null : ((track % 360) + 360) % 360,
    vrate: round(aircraft.vrateMs, FOOT_PER_MINUTE_MS),
    ageS: finite(aircraft.positionAt) && finite(nowMs) ? Math.max(0, Math.floor((nowMs - aircraft.positionAt) / 1_000)) : null,
    positionAt: finite(aircraft.positionAt) ? aircraft.positionAt : null,
    quality: aircraft.quality ?? null,
    onGround: aircraft.onGround === true,
    mode: aircraft.mode ?? null,
    statusKey: typeof aircraft.statusKey === 'string' ? aircraft.statusKey : null,
    timeScale: finite(aircraft.timeScale) && aircraft.timeScale > 0 ? aircraft.timeScale : 1,
    opacity: finite(aircraft.opacity) ? aircraft.opacity : 1,
    runwayIdent: typeof aircraft.runwayIdent === 'string' ? aircraft.runwayIdent : null,
    runwaySource: typeof aircraft.runwaySource === 'string' ? aircraft.runwaySource : null,
    // CN-31: the stand it stands parked on, and the stand it was given when that is another one.
    parkedStand: typeof aircraft.parkedStand === 'string' ? aircraft.parkedStand : null,
    standMismatch: aircraft.standMismatch ?? null,
  });
}

const TELEMETRY_FIELDS = Object.freeze([
  'altFt', 'gsKt', 'trackDeg', 'vrate', 'ageS', 'positionAt', 'quality', 'onGround', 'mode', 'statusKey', 'timeScale',
  'opacity', 'runwayIdent', 'runwaySource', 'parkedStand', 'standMismatch',
]);
const sameTelemetry = (first, second) => first === second
  || (first != null && second != null && TELEMETRY_FIELDS.every(field => Object.is(first[field], second[field])));

/**
 * A telemetry store for one map:
 * - `set(situation)`: the aircraft of a map situation (buildSituation: its `byId`, or its `aircraft`), at once;
 * - `subscribe(listener)` and `getSnapshot()` → `{ nowMs, byId }` for useSyncExternalStore: a new snapshot on every
 *   `set` and on every tick, `intervalMs` apart, while at least one listener is subscribed and `document` is visible;
 *   hidden, the store stops, and when the tab shows again it ticks at once and starts over;
 * - `telemetryOf(id)`: telemetryAt of that aircraft at the snapshot's instant, the same object for as long as the values
 *   it holds stay the same (so a card re-renders when its age turns a second, not 4 times a second).
 * `clock` is anything with `now()` in milliseconds (the server clock by default; the maps pass their render clock and
 * the map lab a frozen one). `sample(id, tMs, aircraft)` (the motion store's sampleOne) gives the aircraft where the
 * map draws it at `tMs`, or `null` when it draws none then; without it, the aircraft as the situation holds it.
 */
export function createTelemetryStore({ clock = serverClock, intervalMs = TELEMETRY_INTERVAL_MS,
  document: doc = globalThis.document, sample = null } = {}) {
  const listeners = new Set();
  const cache = new Map();
  let byId = new Map();
  let snapshot = Object.freeze({ nowMs: clock.now(), byId });
  let timer = null;

  const visible = () => doc?.visibilityState !== 'hidden';

  function publish() {
    snapshot = Object.freeze({ nowMs: clock.now(), byId });
    listeners.forEach(listener => listener());
  }

  function stop() {
    if (timer === null) return;
    clearInterval(timer);
    timer = null;
  }

  function start() {
    if (timer !== null || listeners.size === 0 || !visible()) return;
    timer = setInterval(publish, intervalMs);
  }

  function onVisibility() {
    if (!visible()) {
      stop();
      return;
    }
    publish();
    start();
  }

  return Object.freeze({
    set(situation) {
      const aircraft = situation?.byId instanceof Map
        ? situation.byId
        : new Map((situation?.aircraft ?? []).map(item => [item.id, item]));
      byId = aircraft;
      for (const id of cache.keys()) if (!byId.has(id)) cache.delete(id);
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      if (listeners.size === 1) doc?.addEventListener?.('visibilitychange', onVisibility);
      start();
      return () => {
        listeners.delete(listener);
        if (listeners.size > 0) return;
        stop();
        doc?.removeEventListener?.('visibilitychange', onVisibility);
      };
    },
    getSnapshot: () => snapshot,
    telemetryOf(id) {
      if (id == null) return null;
      const entry = cache.get(id);
      if (entry?.snapshot === snapshot) return entry.value;
      const held = snapshot.byId.get(id) ?? null;
      const drawn = held !== null && typeof sample === 'function' ? sample(id, snapshot.nowMs, held) : held;
      const next = telemetryAt(drawn, snapshot.nowMs);
      const value = entry && sameTelemetry(entry.value, next) ? entry.value : next;
      cache.set(id, { snapshot, value });
      return value;
    },
    /** Whether the store is ticking now (for the tests). */
    isTicking: () => timer !== null,
  });
}

const noSubscription = () => () => {};

/**
 * The telemetry of one aircraft of the store (`id`, `f:<flightKey>` or `h:<hex>`), as telemetryAt gives it, or `null`.
 * The component re-renders when one of its values changes; the map around it never does.
 */
export function useTelemetry(store, id) {
  const read = () => store?.telemetryOf(id) ?? null;
  return useSyncExternalStore(store?.subscribe ?? noSubscription, read, read);
}

/**
 * The server's time of the store, rounded down to `stepMs` (5 s by default), or `null` without a store: a countdown
 * reads it and re-renders once per step.
 */
export function useServerTime(store, stepMs = 5_000) {
  const read = () => {
    const now = store?.getSnapshot().nowMs;
    return finite(now) ? Math.floor(now / stepMs) * stepMs : null;
  };
  return useSyncExternalStore(store?.subscribe ?? noSubscription, read, read);
}
