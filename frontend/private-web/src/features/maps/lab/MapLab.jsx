'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { addProtocol, removeProtocol, restoreNow, setNow } from 'maplibre-gl';
import { liveEngineCount } from '../core/mapEngine';
import OccMap from '../core/OccMap';
import { useMapSelection } from '../core/useMapSelection';
import { OPENFREEMAP_TILEJSON } from '../style/occStyle';
import MapDock from '../ui/MapDock';
import MapLegend from '../ui/MapLegend';
import MapPresetSwitcher from '../ui/MapPresetSwitcher';
import { SCENES, readLabQuery } from './scenes';

// The map lab (app/map-lab, development only): the OCC map with the fixed scenes of scenes.js, without a session or
// the API, for the visual suite (tests/visual) and for a person checking the map by eye. The URL says what to show:
// `?scene=` the scene, `?basemap=none` the style without the vector tiles, `?t=<ISO>` a frozen map clock (MapLibre's
// setNow, with symbol fades off), and the selection keys of the OCC map (stand=, view=, terminal=). It exposes
// `window.__occMapLab` for the suite: getCamera, project (a `[lng, lat]` or a stand code of the scene), flyToPreset,
// whenIdle, liveMaps (the live engines: one after a StrictMode double mount) and refresh (the «Releer posiciones»
// button).

/** On the root of the lab only: scripts/verify-map-chunks.mjs fails a production build whose chunks carry it. */
export const MAP_LAB_MARKER = 'data-occ-map-lab';

const LAB_PATH = '/map-lab';
const WEBGL_CONTEXTS = new Set(['webgl', 'webgl2', 'experimental-webgl']);
// The scene whose base map does not load: every request for the OpenFreeMap TileJSON or its tiles goes to this
// protocol of the lab, which always fails, so the map shows its notice without a request leaving the browser.
const CUT_PROTOCOL = 'occ-lab-cut';
const CUT_PREFIX = `${OPENFREEMAP_TILEJSON}/`;

function cutBasemap(url) {
  if (url === OPENFREEMAP_TILEJSON || url.startsWith(CUT_PREFIX)) return { url: `${CUT_PROTOCOL}://basemap` };
  return undefined;
}

const copyStands = stands => stands.map(stand => ({ ...stand }));

function frozenLabel(time) {
  return `${new Date(time).toISOString().slice(0, 16).replace('T', ' ')} UTC`;
}

// Layout effects run before the passive effect in which OccMap starts its engine (StrictMode re-runs them in the same
// order), so each of these is in place before the map is created and is undone after it is gone.

function useFrozenMapClock(frozenAt) {
  useLayoutEffect(() => {
    if (frozenAt === null) return undefined;
    setNow(frozenAt);
    return () => restoreNow();
  }, [frozenAt]);
}

// A browser without WebGL: the canvas refuses the WebGL contexts while the scene is open (2D drawing still works).
function useWebGlRefused(refused) {
  useLayoutEffect(() => {
    if (!refused) return undefined;
    const prototype = globalThis.HTMLCanvasElement?.prototype;
    if (!prototype) return undefined;
    const original = prototype.getContext;
    prototype.getContext = function getContext(type, ...rest) {
      return WEBGL_CONTEXTS.has(type) ? null : original.call(this, type, ...rest);
    };
    return () => {
      prototype.getContext = original;
    };
  }, [refused]);
}

function useBasemapCut(cut) {
  useLayoutEffect(() => {
    if (!cut) return undefined;
    addProtocol(CUT_PROTOCOL, async () => {
      throw new Error('The map lab cut the base map.');
    });
    return () => removeProtocol(CUT_PROTOCOL);
  }, [cut]);
}

function Plate({ children, className = '' }) {
  return (
    <span className={`shrink-0 rounded-sm border border-occ-line-strong px-1.5 py-0.5 text-xs font-semibold text-occ-muted ${className}`.trim()}>
      {children}
    </span>
  );
}

function LabScene({ scene, basemap, frozenAt }) {
  const mapRef = useRef(null);
  const openedRef = useRef(false);
  const [stands, setStands] = useState(() => copyStands(scene.stands));
  const { selection, selectStand, selectFlight, selectAircraft, clear } = useMapSelection();

  useFrozenMapClock(frozenAt);
  useWebGlRefused(!scene.webgl);
  useBasemapCut(basemap === 'cut');

  // The same stands again in new objects, as a re-read of the positions brings them: the map must stay as it is.
  const reread = useCallback(() => setStands(copyStands(scene.stands)), [scene.stands]);

  const select = useCallback(next => {
    if (next === null) clear();
    else if (next.kind === 'stand') selectStand(next.id);
    else if (next.kind === 'flight') selectFlight(next.id);
    else if (next.kind === 'aircraft') selectAircraft(next.id);
  }, [clear, selectStand, selectFlight, selectAircraft]);

  // The scene's own selection, once, when it opens on a URL that selects nothing.
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (scene.selection && selection === null) select(scene.selection);
  }, [scene.selection, selection, select]);

  useEffect(() => {
    // A stand of the scene by its code, or a `[lng, lat]`.
    const pointOf = target => {
      if (typeof target !== 'string') return target;
      const stand = scene.stands.find(item => item.id === target);
      return stand ? [stand.longitude, stand.latitude] : null;
    };
    const lab = {
      scene: scene.id,
      getCamera: () => mapRef.current?.getCamera() ?? null,
      project: target => {
        const point = pointOf(target);
        return point ? mapRef.current?.project(point) ?? null : null;
      },
      flyToPreset: (view, options) => mapRef.current?.flyToPreset(view, options) ?? false,
      whenIdle: () => mapRef.current?.whenIdle() ?? Promise.resolve(false),
      liveMaps: liveEngineCount,
      refresh: reread,
    };
    window.__occMapLab = lab;
    return () => {
      if (window.__occMapLab === lab) delete window.__occMapLab;
    };
  }, [scene.id, scene.stands, reread]);

  // Read once when the map starts, like every option of the engine.
  const [mapOptions] = useState(() => ({
    ...(frozenAt === null ? {} : { fadeDuration: 0 }),
    ...(basemap === 'cut' ? { transformRequest: cutBasemap } : {}),
  }));

  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line bg-occ-panel px-4 py-2">
        <Link href={LAB_PATH} className="rounded text-sm font-semibold text-occ-muted hover:text-occ-text">
          Escenas
        </Link>
        <span aria-hidden="true" className="text-occ-faint">/</span>
        <h1 className="text-sm font-semibold text-occ-text">{scene.title}</h1>
        <Plate>Datos de prueba, no oficiales</Plate>
        {basemap === 'none' && <Plate>Sin mapa base</Plate>}
        {frozenAt !== null && (
          <span className="font-mono text-xs text-occ-muted">Reloj fijo: {frozenLabel(frozenAt)}</span>
        )}
        <button
          type="button"
          onClick={reread}
          className="ml-auto min-h-9 rounded border border-occ-line bg-occ-panel-raised px-3 text-sm font-semibold text-occ-text hover:border-occ-line-strong"
        >
          Releer posiciones
        </button>
      </header>
      <div className="relative min-h-0 flex-1">
        <OccMap
          ref={mapRef}
          testId="map-lab-map"
          defaultView={scene.view}
          stands={stands}
          selection={selection}
          onSelect={select}
          basemap={basemap !== 'none'}
          mapOptions={mapOptions}
        >
          <MapDock>
            <MapPresetSwitcher />
            <MapLegend />
          </MapDock>
        </OccMap>
      </div>
    </>
  );
}

function SceneIndex({ unknownId }) {
  return (
    <main className="min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto max-w-3xl px-6 py-10">
        <h1 className="text-xl font-semibold text-occ-text">Laboratorio de mapas</h1>
        <p className="mt-2 max-w-prose text-sm text-occ-muted">
          Escenas fijas del mapa del OCC para revisar el motor y el estilo. Los datos son de prueba: no hace falta sesión
          ni API.
        </p>
        {unknownId !== null && (
          <p role="status" className="mt-4 rounded border border-occ-line bg-occ-panel px-3 py-2 text-sm text-occ-text">
            No existe la escena «{unknownId}». Elige una de la lista.
          </p>
        )}
        <ul aria-label="Escenas" className="mt-6 border-t border-occ-line">
          {SCENES.map(scene => (
            <li key={scene.id} className="border-b border-occ-line">
              <Link href={`${LAB_PATH}?scene=${scene.id}`} className="flex items-baseline gap-4 px-2 py-3 hover:bg-occ-panel">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-occ-text">{scene.title}</span>
                  <span className="mt-0.5 block text-sm text-occ-muted">{scene.description}</span>
                </span>
                <span className="shrink-0 font-mono text-xs text-occ-faint">{scene.id}</span>
              </Link>
            </li>
          ))}
        </ul>
      </div>
    </main>
  );
}

export default function MapLab() {
  const searchParams = useSearchParams();
  const { sceneId, scene, basemap, frozenAt } = readLabQuery(searchParams);

  return (
    <div
      {...{ [MAP_LAB_MARKER]: 'v1' }}
      data-department="occ"
      className="dark flex h-screen flex-col overflow-hidden bg-occ-canvas text-occ-text"
    >
      {scene === null
        ? <SceneIndex unknownId={sceneId} />
        : <LabScene key={`${scene.id}|${basemap}|${frozenAt ?? ''}`} scene={scene} basemap={basemap} frozenAt={frozenAt} />}
    </div>
  );
}
