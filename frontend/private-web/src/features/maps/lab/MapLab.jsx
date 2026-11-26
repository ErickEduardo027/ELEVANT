'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { addProtocol, removeProtocol } from 'maplibre-gl';
import { parseInstant } from '../../../services/serverClock';
import { createRenderClock } from '../core/frameLoop';
import { liveEngineCount } from '../core/mapEngine';
import OccMap from '../core/OccMap';
import { useOccMap } from '../core/OccMapContext';
import { useMapSelection } from '../core/useMapSelection';
import { useStandDisplay } from '../stands/useStandDisplay';
import { OPENFREEMAP_TILEJSON } from '../style/occStyle';
import { createMotionStore } from '../traffic/motionStore';
import { createTelemetryStore } from '../traffic/telemetryStore';
import { windPoint } from '../traffic/weatherLayers';
import FlightDataBlock from '../ui/FlightDataBlock';
import Follow3dPanel from '../ui/Follow3dPanel';
import MapDock from '../ui/MapDock';
import MapFollowButton from '../ui/MapFollowButton';
import MapLayersMenu from '../ui/MapLayersMenu';
import MapLegend from '../ui/MapLegend';
import MapMotionControl from '../ui/MapMotionControl';
import MapPresetSwitcher from '../ui/MapPresetSwitcher';
import MapSourceStatus from '../ui/MapSourceStatus';
import { LAB_PATH, LabPlate, frozenLabel, useFrozenMapClock } from './labChrome';
import LayoutQaScene from './LayoutQaScene';
import { SCENES, labWeather, readLabQuery } from './scenes';
import { feedScenarioAt, labTraffic } from './trafficScenes';
import { createSimulatedSatelliteImagery } from '../useSatelliteImagery';

// The map lab (app/map-lab, development only): the OCC map with the fixed scenes of scenes.js, without a session or
// the API, for the visual suite (tests/visual) and for a person checking the map by eye. The URL says what to show:
// `?scene=` the scene, `?basemap=none` the style without the vector tiles, `?t=<ISO>` a frozen map clock (MapLibre's
// setNow, with symbol fades off, and the instant the stands read at; without it they read at the scene's own instant),
// and the selection keys of the OCC map (stand=, view=, terminal=). A scene that places a stand draws its box at the
// pointer and its pending location; a click on the map moves the pending location and Esc stops the placing (there is
// no API to save it). It exposes `window.__occMapLab` for the suite: getCamera, project (a `[lng, lat]` or a stand code
// of the scene), flyToPreset, jumpTo, whenIdle, liveMaps (the live engines: one after a StrictMode double mount),
// refresh (the «Releer posiciones» button) and placing (the stand being placed and its pending location, or null). The
// review scene of the airport layout (`kind: 'layout-qa'`) is a screen of its own: LayoutQaScene.jsx.
// A traffic scene (PR M5) draws its synthetic traffic with its state and credit (MapSourceStatus), the data block of
// the aircraft the URL selects (flightId= or hex=) and the layers menu, and the handle adds aircraftAt(id), where the
// map draws one of its aircraft. Its traffic moves as in the app (PR M6): through the motion store, on a render clock
// frozen at `?t=` (one frame, no loop: the visual suite's pictures are still) or, without it, running from the scene's
// own instant, so a person sees the demo flight move; «Pausar movimiento» is in the dock. The chosen flight's route
// follows its aircraft (PR M6), and «Seguir» is in the dock and in the data block; a scene with `follow` opens
// following (`follow=1`): on the frozen clock the camera frames the aircraft once. A reference scene (PR M8) draws the
// references with its synthetic weather, read once, and the night scene at its own instant. A weather scene (PR M8)
// draws the wind and, with the layers it opens with, the simulated satellite images; the handle adds windAt(), where
// the map draws the wind by the airfield.
// The 3D aircraft (PR M7): each scene opens in its own 2D or 3D (`pitchMode`), which the dock's control and D change
// while it is open (never remembered, so every run opens the same); the governor stays off unless `?governor=on`, so a
// slow software GPU never lightens a picture; and the handle adds aircraft3d(), the 3D's state and the governor's pause.

/** On the root of the lab only: scripts/verify-map-chunks.mjs fails a production build whose chunks carry it. */
export const MAP_LAB_MARKER = 'data-occ-map-lab';

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
// The data block is docked at the top left of the map, as Monitoreo docks it.
const DOCKED_BLOCK_STYLE = Object.freeze({ top: 12, left: 12 });

// The data block of the scene's selection, with «Seguir» from the map it sits in (PR M6), as the screens give it.
function LabDataBlock(props) {
  const { follow } = useOccMap();
  return <FlightDataBlock {...props} onFollow={follow.available ? follow.toggle : null} following={follow.following} />;
}

// A scene that opens with its layers menu open (region-layers-menu): once, as soon as the map offers its layers.
function OpenLayersMenu() {
  const { layers, setLayersMenuOpen } = useOccMap();
  const offered = layers.keys.length > 0;
  const openedRef = useRef(false);
  useEffect(() => {
    if (!offered || openedRef.current) return;
    openedRef.current = true;
    setLayersMenuOpen(true);
  }, [offered, setLayersMenuOpen]);
  return null;
}

// Layout effects run before the passive effect in which OccMap starts its engine (StrictMode re-runs them in the same
// order), so each of these, and the frozen clock of labChrome.jsx, is in place before the map is created and is undone
// after it is gone.

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

function LabScene({ scene, basemap, frozenAt, governed = false }) {
  const mapRef = useRef(null);
  const openedRef = useRef(false);
  const [stands, setStands] = useState(() => copyStands(scene.stands));
  // The stands read at the frozen instant of the URL, else at the scene's own: the same states on every run.
  const standClock = frozenAt ?? scene.at ?? null;
  const displayed = useStandDisplay(stands, { nowMs: standClock, flightsByTurnaround: scene.standFlights });
  const [pitchMode, setPitchMode] = useState(() => scene.pitchMode ?? '2d');
  const { selection, follow, selectStand, selectFlight, selectAircraft, clear, setFollow } = useMapSelection();
  // The render clock of the scene's traffic (PR M6): frozen at `?t=`, else running from the scene's own instant; and
  // its motion store, one for the scene's whole life, as useMapSituation keeps one.
  // A feed scene (CN-18) reads on a server clock whose offset moves at every read, as the app's does.
  const feed = frozenAt === null ? scene.traffic?.feed ?? null : null;
  // The server offset of a feed scene, a plain holder the clock reads (not React state: it changes no render).
  const [feedOffset] = useState(() => ({ ms: 0 }));
  const [renderClock] = useState(() => {
    if (frozenAt !== null) return createRenderClock({ frozenAt });
    const sceneAt = parseInstant(scene.traffic?.at ?? null) ?? 0;
    const openedAt = Date.now();
    if (feed) {
      return createRenderClock({ clock: { now: () => sceneAt + (Date.now() - openedAt) + feedOffset.ms,
        localNow: () => Date.now() } });
    }
    return createRenderClock({ clock: { now: () => sceneAt + (Date.now() - openedAt) } });
  });
  const [motion] = useState(() => createMotionStore({ clock: renderClock }));
  // A feed scene's reads (CN-18): every `periodMs` the server answers at its time, and the answer reaches the map
  // `lateMs` later, moving the clock's offset by the next of `offsetsMs`.
  const [feedAt, setFeedAt] = useState(null);
  useEffect(() => {
    if (!feed) return undefined;
    const timers = new Set();
    let reads = 0;
    const read = () => {
      const readAt = renderClock.now();
      const timer = setTimeout(() => {
        timers.delete(timer);
        reads += 1;
        feedOffset.ms = feed.offsetsMs[reads % feed.offsetsMs.length];
        setFeedAt(readAt);
      }, feed.lateMs);
      timers.add(timer);
    };
    const interval = setInterval(read, feed.periodMs);
    return () => {
      clearInterval(interval);
      timers.forEach(clearTimeout);
    };
  }, [feed, feedOffset, renderClock]);
  // A replayed visit (CN-31) frozen with `?t=` reads its fixes of that instant.
  const scenario = useMemo(() => {
    if (!scene.traffic) return scene.traffic;
    if (feedAt === null) return scene.traffic.replay === true && frozenAt !== null
      ? feedScenarioAt(scene.traffic, frozenAt) : scene.traffic;
    return feedScenarioAt(scene.traffic, feedAt);
  }, [feedAt, frozenAt, scene.traffic]);
  // The traffic of a traffic scene (PR M5, lab/trafficScenes.js), built at the frozen clock for the URL's selection:
  // the lab never polls (a feed scene reads its synthetic feed). Every trail is there; the map shows the other
  // traffic's only when the layers menu asks.
  const traffic = useMemo(() => (scenario
    ? labTraffic(scenario, { nowMs: frozenAt, selection, allTrails: true, motion })
    : null), [scenario, frozenAt, selection, motion]);
  // What the map draws of it, with the map flights whose counterparts the references emphasise (PR M8).
  const mapTraffic = useMemo(() => (traffic ? { ...traffic.map, flights: traffic.situation.flights } : undefined), [traffic]);
  // The weather of a reference scene (PR M8), read once as useMdpcWeather would answer it: the lab never polls. A scene
  // without weather gives the map none, so it draws no weather. The satellite images are always the simulated ones: the
  // lab never reads GIBS, also when a person turns them on in a scene that names none.
  const weather = useMemo(() => labWeather(scene.weather ?? null), [scene.weather]);
  const [satelliteService] = useState(() => createSimulatedSatelliteImagery(scene.satellite ?? {}));
  // The data block's telemetry on the lab's render clock, where the map draws each aircraft: frozen with `?t=`, so the
  // age of a position stays what the scene says.
  const [telemetry] = useState(() => createTelemetryStore({ clock: renderClock,
    sample: (id, tMs, aircraft) => motion.sampleOne(id, tMs, aircraft) }));
  useEffect(() => {
    if (traffic) telemetry.set(traffic.situation);
  }, [telemetry, traffic]);
  // The stand the scene places, with its pending location: a click moves it, Esc or the map's cancel drops it.
  const [placing, setPlacing] = useState(() => scene.placing);
  const placingRef = useRef(placing);
  useLayoutEffect(() => {
    placingRef.current = placing;
  });
  const placingStand = useMemo(() => (placing ? { code: placing.code, sizeHint: placing.sizeHint ?? null } : null), [placing]);
  const placeAt = useCallback(location => setPlacing(current => (current ? { ...current, pending: location } : current)), []);
  const stopPlacing = useCallback(() => setPlacing(null), []);

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

  // The scene's own selection, once, when it opens on a URL that selects nothing, and with it follow mode when the
  // scene follows (PR M6).
  useEffect(() => {
    if (openedRef.current) return;
    openedRef.current = true;
    if (!scene.selection || selection !== null) return;
    select(scene.selection);
    if (scene.follow && !follow) setFollow(true);
  }, [scene.selection, scene.follow, selection, follow, select, setFollow]);

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
      jumpTo: camera => mapRef.current?.jumpTo(camera) ?? false,
      whenIdle: () => mapRef.current?.whenIdle() ?? Promise.resolve(false),
      liveMaps: liveEngineCount,
      refresh: reread,
      // Where the scene's traffic draws an aircraft (`f:<flightKey>` or `h:<hex>`) now, as `[lng, lat]`, or null.
      aircraftAt: id => {
        const item = traffic?.map.aircraft.find(entry => entry.id === id && !entry.hiddenInStand);
        const drawn = item ? motion.sampleOne(item.id, renderClock.now(), item) : null;
        return drawn ? [drawn.lon, drawn.lat] : null;
      },
      // What the motion draws of an aircraft now (CN-31: on the ground, parked on its stand), or null.
      sampleAt: id => {
        const item = traffic?.map.aircraft.find(entry => entry.id === id);
        const drawn = item ? motion.sampleOne(item.id, renderClock.now(), item) : null;
        return drawn ? JSON.parse(JSON.stringify(drawn)) : null;
      },
      // The instants of the phases of a replayed visit (CN-31, lab/replayScenes.js: REPLAY_PHASES), or null.
      replayPhases: () => (scene.traffic?.phases ? { ...scene.traffic.phases } : null),
      // The chosen flight's route the scene draws (CN-29), a FeatureCollection, or null.
      route: () => (traffic?.map.route ? JSON.parse(JSON.stringify(traffic.map.route)) : null),
      placing: () => (placingRef.current ? JSON.parse(JSON.stringify(placingRef.current)) : null),
      // Where the map's last traffic write drew an aircraft, as `[lng, lat]`, or null (the motion measurements, CN-18).
      drawnAt: id => mapRef.current?.drawnPosition?.(id) ?? null,
      // Where the scene's wind stands by the airfield (PR M8), as `[lng, lat]`, or null without weather.
      windAt: () => (scene.weather ? windPoint() : null),
      // The 3D aircraft (PR M7): `{ enabled, status, notice, level, stats, pause, resume }`, or null.
      aircraft3d: () => mapRef.current?.aircraft3d?.() ?? null,
    };
    window.__occMapLab = lab;
    return () => {
      if (window.__occMapLab === lab) delete window.__occMapLab;
    };
  }, [scene.id, scene.stands, scene.weather, scene.traffic, reread, traffic, motion, renderClock]);

  // Read once when the map starts, like every option of the engine.
  const [mapOptions] = useState(() => ({
    ...(frozenAt === null ? {} : { fadeDuration: 0 }),
    ...(basemap === 'cut' ? { transformRequest: cutBasemap } : {}),
  }));
  const [aircraft3d] = useState(() => ({ governor: governed }));

  return (
    <>
      <header className="flex min-h-12 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b border-occ-line bg-occ-panel px-4 py-2">
        <Link href={LAB_PATH} className="rounded text-sm font-semibold text-occ-muted hover:text-occ-text">
          Escenas
        </Link>
        <span aria-hidden="true" className="text-occ-faint">/</span>
        <h1 className="text-sm font-semibold text-occ-text">{scene.title}</h1>
        <LabPlate>Datos de prueba, no oficiales</LabPlate>
        {basemap === 'none' && <LabPlate>Sin mapa base</LabPlate>}
        {frozenAt !== null && (
          <span className="font-mono text-xs text-occ-muted">Reloj fijo: {frozenLabel(frozenAt)}</span>
        )}
        {frozenAt === null && scene.at !== null && (
          <span className="font-mono text-xs text-occ-muted">Hora de la escena: {frozenLabel(scene.at)}</span>
        )}
        {placing && <LabPlate>Ubicando {placing.code}: haz clic en el mapa; Esc lo deja</LabPlate>}
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
          stands={displayed}
          frozenAt={standClock}
          selection={selection}
          onSelect={select}
          placingStand={placingStand}
          pendingLocation={placing?.pending ?? null}
          onMapClick={placing ? placeAt : undefined}
          onCancelPlacing={stopPlacing}
          basemap={basemap !== 'none'}
          mapOptions={mapOptions}
          traffic={mapTraffic}
          weather={scene.weather ? weather : undefined}
          satelliteService={satelliteService}
          layerOverrides={scene.layers}
          pitchMode={pitchMode}
          onPitchModeChange={setPitchMode}
          aircraft3d={aircraft3d}
        >
          {traffic && <MapSourceStatus status="success" picture={traffic.picture} nowMs={traffic.nowMs} />}
          {traffic?.target && (
            <LabDataBlock target={traffic.target} telemetry={telemetry} station={traffic.stationAirport} onClose={clear}
              style={DOCKED_BLOCK_STYLE} />
          )}
          {traffic && <Follow3dPanel flights={traffic.flights ?? null} />}
          {scene.layersMenu && <OpenLayersMenu />}
          <MapDock>
            <MapLayersMenu />
            <MapPresetSwitcher />
            <MapFollowButton />
            <MapMotionControl />
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
  const governed = searchParams?.get('governor') === 'on';
  const sceneKey = scene === null ? null : `${scene.id}|${basemap}|${frozenAt ?? ''}`;
  // The review scene of the airport layout is a screen of its own; every other scene is the map with its stands.
  let screen = <SceneIndex unknownId={sceneId} />;
  if (scene?.kind === 'layout-qa') {
    screen = <LayoutQaScene key={sceneKey} scene={scene} basemap={basemap} frozenAt={frozenAt} />;
  } else if (scene !== null) {
    screen = <LabScene key={sceneKey} scene={scene} basemap={basemap} frozenAt={frozenAt} governed={governed} />;
  }

  // The OCC's theme (dark unless the account chose light): ThemeProvider sets it on the document, as in the OCC.
  return (
    <div
      {...{ [MAP_LAB_MARKER]: 'v1' }}
      data-department="occ"
      className="flex h-screen flex-col overflow-hidden bg-occ-canvas text-occ-text"
    >
      {screen}
    </div>
  );
}
