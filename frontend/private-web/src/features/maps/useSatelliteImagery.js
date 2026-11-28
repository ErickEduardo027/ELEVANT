'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import {
  loadGibsDomain, loadGibsLatestTime, loadSatelliteImageInfo, satelliteTileAt,
} from '../../services/satelliteService';
import { useOptionalOccShellChannel } from '../admin-occ/shell/occShellContext';
import { LOOP_BANDS, loopFrameTimes } from './traffic/weatherLayers';

// The time of the satellite images of the OCC maps (PR M8, traffic/weatherLayers.js): NASA GIBS names in a header the
// time of the GOES-East and IMERG image it serves (services/satelliteService.js: loadSatelliteImageInfo, read straight
// from GIBS, an origin the CSP already allows), and the map pins its tiles to that time. A layer is read only while it
// is wanted (the layers menu shows it and the map is in Región or Aproximación), again every ten minutes while the tab
// shows, and not again on its way back to view within those ten minutes. The host passes the adapter: the map lab and
// the tests use createSimulatedSatelliteImagery, which never touches the network.
// The satellite loop (lane M7; hotfix of 2026-11-28) reads instead which images GIBS has of the band it shows
// (GeoColor by day, the infrared at night): its DescribeDomains over the last three hours, every five minutes while the
// tab shows and the loop is wanted, so it never asks for an image GIBS does not have (GeoColor lags the infrared by
// about half an hour and has holes).

/** How often a wanted image is read again: ten minutes, as the old dashboard's satellite panel did. */
export const SATELLITE_POLL_MS = 600_000;
/** The satellite images the maps read. */
export const SATELLITE_IMAGERY = Object.freeze(['goes', 'imerg']);
/** How often the images GIBS has of the loop's band are read again while the loop is wanted: five minutes. */
export const LOOP_POLL_MS = 300_000;
/** The window the loop's images are looked for in: the last three hours. */
export const LOOP_WINDOW_MS = 3 * 60 * 60_000;

const image = (status, info = null) => Object.freeze({
  status,
  time: info?.time ?? null,
  precision: info?.precision ?? null,
  tileTemplate: info?.tileTemplate ?? null,
});
const IDLE = image('idle');
const LOADING = image('loading');
const UNAVAILABLE = image('unavailable');
const EMPTY_TIMES = Object.freeze([]);
const loopImages = (status, answer = null) => Object.freeze({
  status,
  band: answer?.band ?? null,
  times: answer?.times ?? EMPTY_TIMES,
  source: answer?.source ?? null,
});
const LOOP_IDLE = loopImages('idle');
const LOOP_LOADING = loopImages('loading');
const LOOP_UNAVAILABLE = loopImages('unavailable');
const INITIAL = Object.freeze({ goes: IDLE, imerg: IDLE, loop: LOOP_IDLE });

function rethrowAbort(error, signal) {
  if (signal?.aborted || isAbortError(error)) throw error;
}

// The images one band has: from its domain, or else (the domain cannot be read) its own latest image stepping back ten
// minutes. Null when neither answers.
async function bandTimes(band, { loadDomain, loadLatestTime, fromMs, toMs, signal }) {
  const { layer, matrix } = LOOP_BANDS[band];
  let domain = null;
  try {
    domain = await loadDomain({ layer, matrix, fromMs, toMs, signal });
  } catch (error) {
    rethrowAbort(error, signal);
  }
  if (Array.isArray(domain)) return Object.freeze({ band, times: Object.freeze([...domain]), source: 'domain' });
  let latest = null;
  try {
    latest = await loadLatestTime({ layer, matrix, signal });
  } catch (error) {
    rethrowAbort(error, signal);
  }
  const times = loopFrameTimes(latest);
  return times.length > 0 ? Object.freeze({ band, times, source: 'header' }) : null;
}

/**
 * Which images the loop runs for `band` (`ir` or `geocolor`, the band of the hour: traffic/weatherLayers.js
 * loopBandAt): `{ band, times, source }`, the band it shows, the GIBS instants that band has in the window ending at
 * `nowMs` (sorted) and where they come from (`domain`, its DescribeDomains; `header`, its own Layer-Time-Actual stepping
 * back ten minutes, when the domain cannot be read). GeoColor never borrows the infrared's time; when GeoColor has
 * nothing in the window (just after sunrise) or cannot be read at all, the loop shows the infrared. Null when neither
 * answers. `loadDomain` and `loadLatestTime` are services/satelliteService.js loadGibsDomain and loadGibsLatestTime.
 */
export async function readLoopImages(band, { loadDomain, loadLatestTime, nowMs = Date.now(), signal } = {}) {
  const wanted = Object.hasOwn(LOOP_BANDS, band ?? '') ? band : 'ir';
  const options = { loadDomain, loadLatestTime, fromMs: nowMs - LOOP_WINDOW_MS, toMs: nowMs, signal };
  const shown = await bandTimes(wanted, options);
  if (shown !== null && shown.times.length > 0) return shown;
  if (wanted === 'ir') return null;
  const ir = await bandTimes('ir', options);
  return ir !== null && ir.times.length > 0 ? ir : null;
}

/** The adapter of the browser: the time of an image as GIBS reports it (services/satelliteService.js). */
export const remoteSatelliteImagery = Object.freeze({
  loadImageInfo: (layer, options) => loadSatelliteImageInfo(layer, options),
  loadLoopImages: (band, options) => readLoopImages(band,
    { ...options, loadDomain: loadGibsDomain, loadLatestTime: loadGibsLatestTime }),
});

function abortError(signal) {
  return signal?.reason ?? new DOMException('The simulated read was cancelled.', 'AbortError');
}

const wait = (ms, signal) => new Promise((resolve, reject) => {
  if (signal?.aborted) { reject(abortError(signal)); return; }
  const timer = setTimeout(() => {
    signal?.removeEventListener('abort', onAbort);
    resolve();
  }, ms);
  function onAbort() {
    clearTimeout(timer);
    reject(abortError(signal));
  }
  signal?.addEventListener('abort', onAbort, { once: true });
});

const bandOfLayer = layer => Object.keys(LOOP_BANDS).find(band => LOOP_BANDS[band].layer === layer) ?? null;

/**
 * An adapter that answers from fixed images, for the map lab and the tests; never the network. `goes` and `imerg` are
 * `{ time, precision }` (the time GIBS would name: an instant `2026-11-13T14:50:00Z` or a day `2026-11-13`), `null` for
 * an image GIBS serves without a time, or `{ fails: true }` for a read that fails. The loop's bands answer from
 * `domains` (`{ ir, geocolor }`: the fixed instants GIBS would list, `{ fails: true }` for a read that fails, or null
 * for an answer that cannot be read) and, for its fallback, from `latest` (`{ ir, geocolor }`: the time each band's
 * header would name, or `{ fails: true }`); a band neither names answers six images ending at `goes.time`. `latencyMs`
 * delays each answer; `calls` records every read (`{ layer }`, and `{ loop: true, read, band }` for the loop's).
 */
export function createSimulatedSatelliteImagery({ goes = null, imerg = null, domains = {}, latest = {},
  latencyMs = 0 } = {}) {
  const images = { goes, imerg };
  const calls = [];
  const answer = async (record, signal) => {
    calls.push(record);
    if (latencyMs > 0) await wait(latencyMs, signal);
    if (signal?.aborted) throw abortError(signal);
  };
  const goesTime = () => (goes && !goes.fails && typeof goes.time === 'string' ? goes.time : null);
  const loadDomain = async ({ layer, signal }) => {
    const band = bandOfLayer(layer);
    await answer({ loop: true, read: 'domain', band }, signal);
    if (!Object.hasOwn(domains ?? {}, band)) return goesTime() === null ? null : loopFrameTimes(goesTime());
    const fixed = domains[band];
    if (fixed?.fails) throw new Error('satellite-unavailable');
    return Array.isArray(fixed) ? Object.freeze([...fixed].sort()) : null;
  };
  const loadLatestTime = async ({ layer, signal }) => {
    const band = bandOfLayer(layer);
    await answer({ loop: true, read: 'header', band }, signal);
    const fixed = Object.hasOwn(latest ?? {}, band) ? latest[band] : goesTime();
    if (fixed?.fails) throw new Error('satellite-unavailable');
    return typeof fixed === 'string' ? fixed : null;
  };
  return Object.freeze({
    calls,
    loadLoopImages: (band, options = {}) => readLoopImages(band, { ...options, loadDomain, loadLatestTime }),
    async loadImageInfo(layer, { signal } = {}) {
      calls.push({ layer });
      if (latencyMs > 0) await wait(latencyMs, signal);
      if (signal?.aborted) throw abortError(signal);
      const wanted = images[layer];
      if (wanted?.fails) throw new Error('satellite-unavailable');
      const tileTemplate = wanted ? satelliteTileAt(layer, wanted.time) : null;
      if (tileTemplate === null) return null;
      return { time: wanted.time, precision: wanted.precision ?? (wanted.time.length > 10 ? 'instant' : 'day'), tileTemplate };
    },
  });
}

/**
 * The state of the images in the OCC frame's source list (admin-occ/live/sourceHealth.js), from the wanted ones (the
 * loop's images among them): `ok` while one is drawn, `offline` when every wanted one failed, `idle` while they load.
 */
export function satelliteSourceState(images, wanted) {
  const states = [...SATELLITE_IMAGERY, 'loop'].filter(layer => wanted?.[layer]).map(layer => images?.[layer]?.status);
  if (states.includes('ready')) return 'ok';
  if (states.length > 0 && states.every(state => state === 'unavailable')) return 'offline';
  return 'idle';
}

// The newest instant of the wanted images that are drawn (the loop's latest frame among them), for the source list.
function newestTime(images, wanted) {
  const times = SATELLITE_IMAGERY
    .filter(layer => wanted?.[layer] && images[layer].status === 'ready' && images[layer].precision === 'instant')
    .map(layer => Date.parse(images[layer].time));
  if (wanted?.loop && images.loop?.status === 'ready') times.push(Date.parse(images.loop.times.at(-1) ?? ''));
  const drawn = times.filter(Number.isFinite);
  return drawn.length === 0 ? null : Math.max(...drawn);
}

// The read of one image while it is wanted: at once unless this poll's read already answered within the poll (the map
// came back to Región or Aproximación), then again on every tick of its own poll, every ten minutes while the tab
// shows. A first read that fails leaves the image unavailable; a later one keeps the image it had.
function useImageRead(layer, wanted, service, setImages) {
  const [tick, setTick] = useState(0);
  // The last read started: its tick, when, and whether it answered with a time.
  const lastRead = useRef(null);

  useEffect(() => {
    if (!wanted) return undefined;
    const last = lastRead.current;
    if (last?.tick === tick && last.ok && Date.now() - last.at < SATELLITE_POLL_MS) return undefined;
    const controller = new AbortController();
    const read = { tick, at: Date.now(), ok: false };
    lastRead.current = read;
    setImages(previous => (previous[layer].status === 'ready' ? previous : { ...previous, [layer]: LOADING }));
    Promise.resolve()
      .then(() => service.loadImageInfo(layer, { signal: controller.signal }))
      .then(info => {
        if (controller.signal.aborted) return;
        const ready = Boolean(info) && satelliteTileAt(layer, info.time) !== null;
        read.ok = ready;
        setImages(previous => ({ ...previous, [layer]: ready ? image('ready', info) : UNAVAILABLE }));
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setImages(previous => (previous[layer].status === 'ready' ? previous : { ...previous, [layer]: UNAVAILABLE }));
      });
    return () => abortForEffectCleanup(controller);
  }, [layer, wanted, service, setImages, tick]);

  useEffect(() => {
    if (!wanted) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(value => value + 1);
    }, SATELLITE_POLL_MS);
    return () => window.clearInterval(timer);
  }, [wanted]);
}

// The read of the images GIBS has of the loop's band while the loop is wanted (`band`, null while it is not): at once
// (not again on its way back to view within the poll), again on every tick of its own poll (every five minutes while
// the tab shows) and whenever the band changes, which cancels the read of the band before. While a new read runs the
// loop keeps the images it had; a first read that finds none leaves it unavailable.
function useLoopRead(band, service, setImages) {
  const [tick, setTick] = useState(0);
  const lastRead = useRef(null);
  const wanted = band !== null;

  useEffect(() => {
    if (band === null || typeof service?.loadLoopImages !== 'function') return undefined;
    const last = lastRead.current;
    if (last?.band === band && last.tick === tick && last.ok && Date.now() - last.at < LOOP_POLL_MS) return undefined;
    const controller = new AbortController();
    const read = { band, tick, at: Date.now(), ok: false };
    lastRead.current = read;
    setImages(previous => (previous.loop.status === 'ready' ? previous : { ...previous, loop: LOOP_LOADING }));
    Promise.resolve()
      .then(() => service.loadLoopImages(band, { signal: controller.signal, nowMs: Date.now() }))
      .then(answer => {
        if (controller.signal.aborted) return;
        const ready = Array.isArray(answer?.times) && answer.times.length > 0 && Object.hasOwn(LOOP_BANDS, answer.band);
        read.ok = ready;
        setImages(previous => {
          if (ready) return { ...previous, loop: loopImages('ready', answer) };
          return previous.loop.status === 'ready' ? previous : { ...previous, loop: LOOP_UNAVAILABLE };
        });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setImages(previous => (previous.loop.status === 'ready' ? previous : { ...previous, loop: LOOP_UNAVAILABLE }));
      });
    return () => abortForEffectCleanup(controller);
  }, [band, service, setImages, tick]);

  useEffect(() => {
    if (!wanted) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') setTick(value => value + 1);
    }, LOOP_POLL_MS);
    return () => window.clearInterval(timer);
  }, [wanted]);
}

/**
 * The satellite images of a map: `{ goes, imerg, loop }`. `goes` and `imerg` are each `{ status, time, precision,
 * tileTemplate }` with `status` `idle` (never wanted), `loading`, `ready` (GIBS named its time: `tileTemplate` is
 * pinned to it) or `unavailable` (the read failed, or GIBS named no time). `loop` is `{ status, band, times, source }`
 * (readLoopImages; `band` is the one the loop shows, `times` the GIBS instants it has). The props `goes` and `imerg` say
 * whether each is wanted now, `loop` the band the satellite loop wants (`ir` or `geocolor`) or null while it is not;
 * `service` is `{ loadImageInfo(layer, { signal }), loadLoopImages(band, { signal, nowMs }) }` (remoteSatelliteImagery,
 * or the simulated adapter). Inside the OCC frame it reports `satellite` to the source list while an image is wanted.
 */
export function useSatelliteImagery({ goes = false, imerg = false, loop = null, service = remoteSatelliteImagery } = {}) {
  const [images, setImages] = useState(INITIAL);
  const loopBand = Object.hasOwn(LOOP_BANDS, loop ?? '') ? loop : null;
  useImageRead('goes', Boolean(goes), service, setImages);
  useImageRead('imerg', Boolean(imerg), service, setImages);
  useLoopRead(loopBand, service, setImages);

  // The images in the OCC frame's source list while one is wanted, with the time of the newest one drawn.
  const channel = useOptionalOccShellChannel();
  const wantedLoop = loopBand !== null;
  const wanted = Boolean(goes) || Boolean(imerg) || wantedLoop;
  const sourceState = satelliteSourceState(images, { goes, imerg, loop: wantedLoop });
  const sourceAt = sourceState === 'ok' ? newestTime(images, { goes, imerg, loop: wantedLoop }) : null;
  useEffect(() => {
    if (!channel || !wanted) return;
    channel.sources.report('satellite', { state: sourceState, at: sourceAt });
  }, [channel, wanted, sourceAt, sourceState]);
  useEffect(() => (channel && wanted ? () => channel.sources.remove('satellite') : undefined), [channel, wanted]);

  return useMemo(() => Object.freeze({ goes: images.goes, imerg: images.imerg, loop: images.loop }), [images]);
}
