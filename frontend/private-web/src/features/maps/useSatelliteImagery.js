'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { loadSatelliteImageInfo, satelliteTileAt } from '../../services/satelliteService';
import { useOptionalOccShellChannel } from '../admin-occ/shell/occShellContext';

// The time of the satellite images of the OCC maps (PR M8, traffic/weatherLayers.js): NASA GIBS names in a header the
// time of the GOES-East and IMERG image it serves (services/satelliteService.js: loadSatelliteImageInfo, read straight
// from GIBS, an origin the CSP already allows), and the map pins its tiles to that time. A layer is read only while it
// is wanted (the layers menu shows it and the map is in Región or Aproximación), again every ten minutes while the tab
// shows, and not again on its way back to view within those ten minutes. The host passes the adapter: the map lab and
// the tests use createSimulatedSatelliteImagery, which never touches the network.

/** How often a wanted image is read again: ten minutes, as the old dashboard's satellite panel did. */
export const SATELLITE_POLL_MS = 600_000;
/** The satellite images the maps read. */
export const SATELLITE_IMAGERY = Object.freeze(['goes', 'imerg']);

const image = (status, info = null) => Object.freeze({
  status,
  time: info?.time ?? null,
  precision: info?.precision ?? null,
  tileTemplate: info?.tileTemplate ?? null,
});
const IDLE = image('idle');
const LOADING = image('loading');
const UNAVAILABLE = image('unavailable');
const INITIAL = Object.freeze({ goes: IDLE, imerg: IDLE });

/** The adapter of the browser: the time of an image as GIBS reports it (services/satelliteService.js). */
export const remoteSatelliteImagery = Object.freeze({
  loadImageInfo: (layer, options) => loadSatelliteImageInfo(layer, options),
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

/**
 * An adapter that answers from fixed images, for the map lab and the tests; never the network. `goes` and `imerg` are
 * `{ time, precision }` (the time GIBS would name: an instant `2026-11-13T14:50:00Z` or a day `2026-11-13`), `null` for
 * an image GIBS serves without a time, or `{ fails: true }` for a read that fails. `latencyMs` delays each answer;
 * `calls` records every read (`{ layer }`).
 */
export function createSimulatedSatelliteImagery({ goes = null, imerg = null, latencyMs = 0 } = {}) {
  const images = { goes, imerg };
  const calls = [];
  return Object.freeze({
    calls,
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
 * The state of the images in the OCC frame's source list (admin-occ/live/sourceHealth.js), from the wanted ones:
 * `ok` while one is drawn, `offline` when every wanted one failed, `idle` while they load.
 */
export function satelliteSourceState(images, wanted) {
  const states = SATELLITE_IMAGERY.filter(layer => wanted?.[layer]).map(layer => images?.[layer]?.status);
  if (states.includes('ready')) return 'ok';
  if (states.length > 0 && states.every(state => state === 'unavailable')) return 'offline';
  return 'idle';
}

// The newest instant of the wanted images that are drawn, for the source list.
function newestTime(images, wanted) {
  const times = SATELLITE_IMAGERY
    .filter(layer => wanted?.[layer] && images[layer].status === 'ready' && images[layer].precision === 'instant')
    .map(layer => Date.parse(images[layer].time))
    .filter(Number.isFinite);
  return times.length === 0 ? null : Math.max(...times);
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

/**
 * The satellite images of a map: `{ goes, imerg }`, each `{ status, time, precision, tileTemplate }` with `status`
 * `idle` (never wanted), `loading`, `ready` (GIBS named its time: `tileTemplate` is pinned to it) or `unavailable` (the
 * read failed, or GIBS named no time). `goes` and `imerg` say whether each is wanted now; `service` is
 * `{ loadImageInfo(layer, { signal }) }` (remoteSatelliteImagery, or the simulated adapter). Inside the OCC frame it
 * reports `satellite` to the source list while an image is wanted.
 */
export function useSatelliteImagery({ goes = false, imerg = false, service = remoteSatelliteImagery } = {}) {
  const [images, setImages] = useState(INITIAL);
  useImageRead('goes', Boolean(goes), service, setImages);
  useImageRead('imerg', Boolean(imerg), service, setImages);

  // The images in the OCC frame's source list while one is wanted, with the time of the newest one drawn.
  const channel = useOptionalOccShellChannel();
  const wanted = Boolean(goes) || Boolean(imerg);
  const sourceState = satelliteSourceState(images, { goes, imerg });
  const sourceAt = sourceState === 'ok' ? newestTime(images, { goes, imerg }) : null;
  useEffect(() => {
    if (!channel || !wanted) return;
    channel.sources.report('satellite', { state: sourceState, at: sourceAt });
  }, [channel, wanted, sourceAt, sourceState]);
  useEffect(() => (channel && wanted ? () => channel.sources.remove('satellite') : undefined), [channel, wanted]);

  return useMemo(() => Object.freeze({ goes: images.goes, imerg: images.imerg }), [images]);
}
