'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Toast from '../../../components/Toast';
import { useToast } from '../../../hooks/useToast';
import { useTranslation } from '../../../i18n/LanguageScope';
import { normalizeStandCode } from '../../../services/standCodes';
import { OccBootContext } from '../../admin-occ/boot/occBootContext';
import { AirportDelaysPill } from '../../aviation-reference/AirportDelays';
import { useAirportRoutes } from '../../aviation-reference/useAirportRoutes';
import { STATION_TIME_ZONE } from '../../admin-occ/shell/status/OccClocks';
import { matchFlight, relatedEntities } from '../../maps/core/mapSelection';
import OccMap from '../../maps/core/OccMap';
import { useOccMap } from '../../maps/core/OccMapContext';
import Follow3dPanel from '../../maps/ui/Follow3dPanel';
import MapDock from '../../maps/ui/MapDock';
import MapLayersMenu from '../../maps/ui/MapLayersMenu';
import MapLegend from '../../maps/ui/MapLegend';
import MapMotionControl from '../../maps/ui/MapMotionControl';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import MapSourceStatus from '../../maps/ui/MapSourceStatus';
import { routesOverlay } from '../../maps/style/routeLayers';
import { useOptionalTheme } from '../../shell/useTheme';
import { useMediaQuery } from '../../../hooks/useMediaQuery';
import { notificationTargetPath } from '../../notifications/notificationKinds';
import { panelStateOf } from '../../occ-ui/OccPanel';
import ProviderFlightsDialog from '../../planning/components/ProviderFlightsDialog';
import { isInitialAssignmentCandidate, withAssignmentReadiness } from '../../planning/planningMappers';
import { consoleAlerts } from './alertModel';
import AlertsPanel from './AlertsPanel';
import BoardPanel from './BoardPanel';
import { buildBoard, selectionIdOf } from './boardModel';
import ConsoleAssignDrawer from './ConsoleAssignDrawer';
import {
  REVEAL_MARGIN_PX, aimKeyOf, aimVerdict, freeAreaOf, inFreeArea, revealOf, selectionKeyOf, standGeometryOf,
} from './consoleCamera';
import { sameInsets } from './consoleInsets';
import { consoleMessages } from './consoleMessages';
import { buildFigures } from './consoleModel';
import ConsoleOverlay, { CONSOLE_OVERLAY_LAYOUT } from './ConsoleOverlay';
import { CONSOLE_ACTION } from './consoleStyles';
import EngineStatusProbe from './EngineStatusProbe';
import FiguresPanel from './FiguresPanel';
import InspectorPanel from './InspectorPanel';
import NewArrivalPill, { useNewDemoArrival } from './NewArrivalPill';
import { buildPending } from './pendingModel';
import PositionsPanel from './PositionsPanel';
import ProvenanceLine from './ProvenanceLine';
import { flightsByTurnaroundOf } from './standTimeline';
import { useConsoleClock } from './useConsoleClock';
import { useConsoleInsets } from './useConsoleInsets';
import WeatherPanel from './WeatherPanel';
import WeatherPill from './WeatherPill';

// The OCC console, Panorama (contratos 2.5, owner decision 15; CN-32): the full-bleed map under the status bar, opening
// on Región in 3D with the regional weather and «Meteorología PUJ» (lane M7; on Rampa until 2026-11-28), with its
// panels docked flush against its edges (ConsoleOverlay.jsx: the lists at the left, the figures along
// the top, the band along the bottom and the inspector at the right from 1536 px), the maps lane's control rail down
// the right edge of the area they leave and, under the map, the provenance line and the weather pill. Presentational:
// the route (ConsoleRoute.jsx) reads and passes everything; this page only holds what the person does on it (the board's
// tab, which dialog is open, what the engine reports). One selection for the map, the board, the band and the inspector: the URL's (contratos 2.1).
//
// When the engine cannot draw, the same panels go into a plain grid beside the map's list (the map stays mounted in
// the same place); with `focus=map` the panels hide behind «Mostrar paneles»; on a narrow screen they open folded.

const EMPTY = Object.freeze([]);
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const NARROW_QUERY = '(max-width: 1279.98px)';
// From 1536 px the inspector takes a column of its own at the right of the map (ConsoleOverlay.jsx).
const WIDE_QUERY = '(min-width: 1536px)';
// Where the pill of a new arrival goes: the top left of the area the panels leave in sight (OccMap's inset variables),
// short of the map's control column at the right edge of that area (the zoom group and the rail, --occ-map-rail wide
// and 12 px from the edge, occ-map.css: CN-32), so it wraps instead of running over them.
const ARRIVAL_PLACE = Object.freeze({
  top: 'calc(var(--occ-map-inset-top, 0px) + 12px)', left: 'calc(var(--occ-map-inset-left, 0px) + 12px)',
  maxWidth: 'calc(100% - var(--occ-map-inset-left, 0px) - var(--occ-map-inset-right, 0px) '
    + '- var(--occ-map-rail, 5.5rem) - 36px)',
});

// The console tells the boot screen when its first data is on screen (ConsoleRoute.jsx). The map it hosts draws from
// the first frame, before that data, so its own report does not end the wait: the console opens with data (contratos 2.6).
const CONSOLE_MAP_BOOT = Object.freeze({ markReady: () => {} });

// Lane M7 (2026-11-28): Panorama opens in Región in 3D with the regional weather; 3 and 4 still go to Aeródromo and Rampa.
export const CONSOLE_DEFAULT_VIEW = 'region';
// Where «Meteorología PUJ» floats until the panels of lane M1: the bottom left of the area the panels leave in sight,
// over the map's key (the altitude scale and the credit of the aircraft data, occ-map.css: --occ-map-key-band), which
// stays in sight (ADR-0044, 2026-11-28). It is not measured into the insets (it would move with them), so it stays
// inside that area.
const WEATHER_PLACE = Object.freeze({
  bottom: 'calc(var(--occ-map-inset-bottom, 0px) + var(--occ-map-key-band, 7rem) + 12px)',
  left: 'calc(var(--occ-map-inset-left, 0px) + 12px)',
  maxHeight: 'calc(100% - var(--occ-map-inset-top, 0px) - var(--occ-map-inset-bottom, 0px) - var(--occ-map-key-band, 7rem) - 24px)',
});

// «Meteorología PUJ» names the runway in use the map draws (OccMapContext's `runwayInUse`, with the recent live
// arrivals the map saw), so the panel and the map never say two runways (2026-11-28).
function MapWeatherPanel(props) {
  const { runwayInUse } = useOccMap();
  return <WeatherPanel {...props} runway={runwayInUse ?? null} />;
}

const matches = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia(query).matches;

const ANSWERED = new Set(['success', 'empty']);

// The map flights before they answer, as the map situation says (useMapSituation): a situation that answered while its
// flights did not is still loading them.
function flightsWaitingOf(live) {
  const status = ANSWERED.has(live.status) ? 'loading' : live.status;
  return { status, staleSince: null, onRetry: live.retry };
}

// The map flights as one of the reads of «Pendientes de la jornada»: they answered once they are here.
const flightsStateOf = live => (live.flights ? { status: 'success', staleSince: null, onRetry: live.retry }
  : flightsWaitingOf(live));

// The board's remote state: the map flights read (useMapSituation), then whether the day has anything to show.
function boardStateOf(live, board) {
  if (!live.flights || board === null) return flightsWaitingOf(live);
  const { arrivals, departures, toImport, visits } = board.counts;
  return { status: arrivals + departures + toImport + visits > 0 ? 'success' : 'empty', staleSince: null,
    onRetry: live.retry };
}

// The flight keys of the aircraft drawn at an estimated position, one per line, sorted: what the board reads of them.
function estimatedFlightKeysOf(aircraft) {
  if (!Array.isArray(aircraft)) return '';
  return [...new Set(aircraft.filter(item => item?.quality === 'estimated' && typeof item.flightKey === 'string')
    .map(item => item.flightKey))].sort().join('\n');
}

// The first item of `items` for each key, as `Array.prototype.find` would return it.
function firstBy(items, keyOf) {
  const byKey = new Map();
  for (const item of items) {
    const key = keyOf(item);
    if (!byKey.has(key)) byKey.set(key, item);
  }
  return byKey;
}

// What is chosen, as the map draws it now (consoleCamera.js: revealOf): the stand's outline, the aircraft of a flight
// or else its stand, an aircraft's position; null with nothing chosen or nothing drawn.
function revealNow({ chosen = null, target = null, stands = EMPTY, flights = EMPTY } = {}) {
  if (chosen === null) return null;
  return revealOf({
    selection: chosen, aircraft: target?.aircraft ?? null, flightKey: target?.flight?.flightKey ?? null,
    standCode: chosen.kind === 'flight' ? relatedEntities(chosen, { flights }).standCode : null,
    standGeometry: code => standGeometryOf(stands, code),
  });
}

/**
 * The console page.
 * - `station`: `{ stationId, stationCode }` of the OCC's PUJ scope.
 * - `live`: the map situation (maps/useMapSituation.js), read once for the map, the board and the inspector.
 * - `data`: the console's own reads (useConsoleData: `planning`, `positions`, `reviewQueue`, `readiness`, `notices`).
 * - `stands`: the stands as the map draws them (useStandDisplay over the positions board and the map flights).
 * - `regionWeather`: useRegionWeather's view (lane M7), the regional layers of the map; without it the map draws none.
 * - `weather`: useMdpcWeather's view; `selection`: the URL selection store (maps/core/useMapSelection.js).
 * - `accountId`: the signed-in account, whose closed «Llegada nueva» pills the tab remembers (arrivalMemory.js).
 * - `onShown()`: called once the console is on screen (its route tells the OCC boot screen when its data are too).
 */
export default function ConsolePage({ station, live, data, stands = EMPTY, weather, regionWeather, selection,
  accountId = null, onShown }) {
  const { t } = useTranslation(consoleMessages);
  const router = useRouter();
  const mapRef = useRef(null);
  const [engineStatus, setEngineStatus] = useState('starting');
  const [importOpen, setImportOpen] = useState(false);
  const [assignTurnaroundId, setAssignTurnaroundId] = useState(null);
  // What the assignment drawer reads again with (its options, the incidents, the relieved agents): the console's own
  // changes, an import or an assignment, never the 60 s safety poll of the planning (contratos 2.7).
  const [drawerRevision, setDrawerRevision] = useState(0);
  const { toasts, showToast, dismissToast } = useToast();
  // Read once: the console is a client-only route, so the first render already knows the screen.
  const [narrow] = useState(() => matches(NARROW_QUERY));
  // Followed while the window changes: the inspector moves between the left column and its own.
  const wide = useMediaQuery(WIDE_QUERY);

  const layout = engineStatus === 'unavailable' ? 'grid' : 'map';
  const focusMap = selection.focus === 'map';
  const { insets, rootRef, measure, measured } = useConsoleInsets({ enabled: layout === 'map' && !focusMap });
  const { planning, positions, reviewQueue, readiness, notices } = data;
  const { selection: chosen, selectFlight, selectStand, selectAircraft, clear, setFocus, setFollow, setView } = selection;

  // «Rutas desde Punta Cana» (AeroDataBox, ADR-0043 note of 15 November 2026): its layer is part of the map's style from
  // the start, in the theme the map draws (the map is re-created when it changes), and its data comes with the read.
  const routes = useAirportRoutes(station.stationId);
  const mapTheme = useOptionalTheme()?.theme === 'light' ? 'light' : 'dark';
  const routeOverlays = useMemo(() => (routes.active ? [routesOverlay({ theme: mapTheme })] : EMPTY),
    [routes.active, mapTheme]);

  const timeZone = planning.data?.station?.ianaTimeZone ?? STATION_TIME_ZONE;
  const nowMs = useConsoleClock(live.clock);
  const flightRows = live.flights?.flights;
  const mapFlights = flightRows ?? EMPTY;
  const aircraft = live.situation.aircraft;
  const flightsByTurnaround = flightsByTurnaroundOf(flightRows);
  // The traffic with its motion (PR M6): the hook's own, whose frames move the demo flight on its render clock (it
  // approaches, lands, taxis and parks between two reads) and rebuild the chosen flight's route where it is drawn.
  // A situation without it (a test's) is drawn where it says, as in PR M5.
  const liveTraffic = live.traffic ?? null;
  const traffic = useMemo(() => liveTraffic ?? { aircraft, trails: live.trails, route: live.route,
    source: live.situation.source }, [aircraft, live.route, live.situation.source, live.trails, liveTraffic]);

  const planningFlights = useMemo(() => withAssignmentReadiness(planning.data?.flights ?? EMPTY, readiness.data),
    [planning.data, readiness.data]);
  // The board reads of the aircraft only which flights are drawn at an estimated position (boardModel.js: buildBoard),
  // so it is rebuilt when that list changes, not on every read of the air picture.
  const estimatedKey = estimatedFlightKeysOf(aircraft);
  const boardAircraft = useMemo(() => (estimatedKey === '' ? EMPTY
    : estimatedKey.split('\n').map(flightKey => ({ quality: 'estimated', flightKey }))), [estimatedKey]);
  const board = useMemo(() => (flightRows ? buildBoard({ flights: flightRows, aircraft: boardAircraft,
    planningTurnarounds: planning.data?.turnarounds ?? null, nowMs, t }) : null),
  [boardAircraft, flightRows, nowMs, planning.data, t]);
  const figures = useMemo(() => buildFigures({ planning: planning.data, reviewQueue: reviewQueue.data,
    flights: live.flights, visits: board?.visits ?? null, nowMs }), [board, live.flights, nowMs, planning.data,
    reviewQueue.data]);
  const alerts = useMemo(() => consoleAlerts(notices.data ?? EMPTY, { stationCode: station.stationCode }).entries,
    [notices.data, station.stationCode]);
  const pending = useMemo(() => buildPending({ board, planningFlights: planning.data ? planningFlights : null,
    readiness: readiness.data, reviewQueue: reviewQueue.data, nowMs, t }),
  [board, nowMs, planning.data, planningFlights, readiness.data, reviewQueue.data, t]);
  const { arrival, dismiss: dismissArrival } = useNewDemoArrival(flightRows, { clock: live.clock, accountId });

  // What the one selection names, for the board, the band and the inspector.
  const related = useMemo(() => (chosen?.kind === 'stand' ? relatedEntities(chosen, { flights: mapFlights }) : null),
    [chosen, mapFlights]);
  const standFlight = related?.flightKey ? matchFlight(mapFlights, related.flightKey) : null;
  const selectedStand = chosen?.kind === 'stand'
    ? stands.find(stand => normalizeStandCode(stand.id ?? stand.code) === chosen.id) ?? null : null;
  let selectedId = null;
  if (chosen?.kind === 'flight') selectedId = matchFlight(mapFlights, chosen.id)?.flightKey ?? chosen.id;
  else if (chosen?.kind === 'aircraft') selectedId = live.target?.flight?.flightKey ?? null;
  else if (chosen?.kind === 'stand') selectedId = related?.flightKey ?? null;
  const selectedTurnaroundId = chosen?.kind === 'stand'
    ? selectedStand?.display?.visit?.turnaroundId ?? standFlight?.turnaroundId ?? null
    : matchFlight(mapFlights, selectedId)?.turnaroundId ?? null;

  const planningDate = planning.data?.date ?? null;
  const canOpenImport = Boolean(station.stationId && planningDate);
  const showImport = useCallback(() => setImportOpen(true), []);
  const openImport = canOpenImport ? showImport : undefined;
  // The planning's flights and the board's strips by key, built once per read instead of searched on every call.
  const planningByTurnaround = useMemo(() => firstBy(planningFlights, item => item.turnaroundId), [planningFlights]);
  const planningFlightOf = useCallback(turnaroundId => planningByTurnaround.get(turnaroundId) ?? null,
    [planningByTurnaround]);
  const assignFlight = assignTurnaroundId === null ? null : planningFlightOf(assignTurnaroundId);
  const canImport = useCallback(flight => canOpenImport && flight?.imported !== true && flight?.proposalId != null,
    [canOpenImport]);
  const canAssign = useCallback(flight => flight?.imported === true
    && isInitialAssignmentCandidate(planningFlightOf(flight.turnaroundId)), [planningFlightOf]);
  const strips = useMemo(() => (board === null ? null : firstBy([...board.arrivals, ...board.departures,
    ...board.toImport.arrivals, ...board.toImport.departures], item => item.flightKey)), [board]);
  const stripOf = useCallback(flight => strips?.get(flight?.flightKey) ?? null, [strips]);
  // «Seguir en 3D» (CN-30): what the planning knows of the followed flight's operation, its agents and services.
  const followOperational = useCallback(flight => {
    const planned = planningFlightOf(flight?.turnaroundId);
    return planned ? { agents: planned.agents ?? [], services: planned.services ?? [] } : null;
  }, [planningFlightOf]);

  // On screen: the route may now tell the boot screen, as soon as the first data are here too.
  useEffect(() => { onShown?.(); }, [onShown]);

  // The camera and the panels (contratos 2.5; consoleCamera.js). The panels take room from the map, and when that room
  // changes the map's padding changes with it, which MapLibre applies as a jump that also stops a move under way: what
  // sat near the edge of a panel can end up under it. So the console moves the camera only once the panels are measured
  // (useConsoleInsets: `measured`):
  // - a move it asks for when something is chosen on the console or on the map (an aim) goes once the URL has that
  //   selection, so the inspector that opens with a first selection, beside a folded «Alertas», already counts. A
  //   strip, a turnaround or a pending item flies to its flight, else to its stand; a click on the map or a bar of the
  //   band brings what it chose into sight when the panels cover it; «Ver y seguir» flies to the view that follows its
  //   flight, unless the map shows that view already, and centres the flight once the map settles there;
  // - the opening view is framed in the area the panels leave once the engine is ready, and again when the panels
  //   change the room (a fold, a window resized), as long as nothing is chosen or followed and nothing moved the camera
  //   on purpose since (a person, or a selection the console brought into sight);
  // - when the room changes with something chosen that was in sight and the panels now cover it, it comes back to the
  //   middle of the area in sight, at the same zoom. What a person moved out of sight stays where they left it.
  const framing = useRef({ key: null, moved: false });
  const aim = useRef(null);
  const [aimTick, setAimTick] = useState(0);
  const userMoves = useRef(0);
  const insetsKey = `${insets.top}|${insets.right}|${insets.bottom}|${insets.left}`;
  const framedView = selection.view ?? CONSOLE_DEFAULT_VIEW;
  const framedTerminal = selection.terminal ?? null;
  const held = chosen !== null || selection.follow;
  // The newest selection and what the map draws of it, for the moves that run after this render.
  const latest = useRef({ chosen: null, target: null, stands: EMPTY, flights: EMPTY });
  useLayoutEffect(() => {
    latest.current = { chosen, target: live.target, stands, flights: mapFlights };
  });

  // Whether what is chosen lies, where the map draws it now, in the area that `room` (insets) leaves in sight, `margin`
  // pixels inside it; null when the map cannot tell (no map, no size, nothing of it drawn or placed).
  const chosenInSight = useCallback((room, margin) => {
    const map = mapRef.current;
    const reveal = revealNow(latest.current);
    const area = freeAreaOf(measured(), room);
    if (!map || reveal === null || area === null) return null;
    const pixels = reveal.points.map(point => map.project(point));
    return pixels.every(Boolean) ? inFreeArea(pixels, area, margin) : null;
  }, [measured]);
  // Brings what is chosen to the middle of the area in sight, at the same zoom; whether the camera moved.
  const bringIntoSight = useCallback(() => {
    const map = mapRef.current;
    const reveal = revealNow(latest.current);
    const zoom = map?.getCamera()?.zoom;
    if (!map || reveal === null || !Number.isFinite(zoom)) return false;
    const { move } = reveal;
    let moved;
    if (move.kind === 'stand') moved = map.flyToStand(move.code, { minZoom: zoom });
    else if (move.kind === 'flight') moved = map.flyToFlight(move.id);
    else moved = map.jumpTo({ center: move.center });
    if (moved) framing.current.moved = true;
    return Boolean(moved);
  }, []);
  // An aim, now that the URL has its selection and the panels are measured for it (`room`, the insets).
  const carryOut = useCallback((pending, room) => {
    const map = mapRef.current;
    if (!map) return;
    if (pending.kind === 'flight') {
      if (!map.flyToFlight(pending.id) && pending.standCode) map.flyToStand(pending.standCode);
      return;
    }
    if (pending.kind === 'reveal') {
      if (chosenInSight(room, REVEAL_MARGIN_PX) === false) bringIntoSight();
      return;
    }
    // «Ver y seguir»: the map takes the view from the URL, and the console centres the flight once the map settles there,
    // unless a person moved the camera or chose something else meanwhile. The console never flies to the view itself: a
    // move of the page's own ends follow mode (PR M6), which frames the aircraft from the view on (its flyToFlight then
    // does nothing). A flight whose aircraft the map does not draw stays where the view puts it.
    if (pending.viewShown || pending.view === null) {
      map.flyToFlight(pending.id);
      return;
    }
    const moves = userMoves.current;
    map.whenIdle().then(idle => {
      if (!idle || userMoves.current !== moves || selectionKeyOf(latest.current.chosen) !== pending.key) return;
      mapRef.current?.flyToFlight(pending.id);
    });
  }, [bringIntoSight, chosenInSight]);
  // Waits for the selection `next.key` (consoleCamera.js: aimKeyOf) to carry out `next`.
  const aimAt = useCallback(next => {
    if (!next.key) return;
    if (next.kind !== 'reveal') framing.current.moved = true;
    aim.current = { ...next, from: selectionKeyOf(latest.current.chosen) };
    setAimTick(tick => tick + 1);
  }, []);

  // Whether what is chosen was in sight in the room the map pads with until this render: OccMap takes the room this
  // render measured in its own effects, which run after this one.
  const padded = useRef(NO_INSETS);
  const roomBefore = useRef({ key: null, inSight: false });
  useLayoutEffect(() => {
    if (roomBefore.current.key === insetsKey) return;
    roomBefore.current = { key: insetsKey, inSight: chosenInSight(padded.current, 0) === true };
  }, [chosenInSight, insetsKey]);
  useEffect(() => {
    padded.current = insets;
  }, [insets]);

  useEffect(() => {
    const map = mapRef.current;
    if (layout !== 'map') {
      aim.current = null;
      return;
    }
    if (!map || engineStatus !== 'ready') return;
    // The panels were measured again after this render: the next render has the room the map is about to take.
    if (!sameInsets(measured().insets, insets)) return;
    const state = framing.current;
    const first = state.key === null;
    const roomChanged = state.key !== insetsKey;
    const pending = aim.current;
    const verdict = aimVerdict(pending, chosen);
    if (verdict === 'go') {
      aim.current = null;
      state.key = insetsKey;
      carryOut(pending, insets);
      return;
    }
    if (verdict === 'drop') aim.current = null;
    if (!roomChanged) return;
    state.key = insetsKey;
    if (first || (!state.moved && !held)) {
      state.moved = false;
      map.flyToPreset(framedView, { terminal: framedTerminal });
      return;
    }
    const before = roomBefore.current;
    if (chosen === null || before.key !== insetsKey || !before.inSight) return;
    if (chosenInSight(insets, REVEAL_MARGIN_PX) === false) bringIntoSight();
  }, [aimTick, bringIntoSight, carryOut, chosen, chosenInSight, engineStatus, framedTerminal, framedView, held, insets,
    insetsKey, layout, measured]);
  const handleCamera = useCallback((camera, details) => {
    if (!details?.byUser) return;
    framing.current.moved = true;
    userMoves.current += 1;
  }, []);

  // The board, the turnarounds and the pending list select through the URL; the camera follows (an aim).
  const selectItem = useCallback(item => {
    const id = selectionIdOf(item, mapFlights);
    if (id === null) return;
    selectFlight(id);
    aimAt({ kind: 'flight', key: aimKeyOf('flight', id), id, standCode: item.standCode ?? null });
  }, [aimAt, mapFlights, selectFlight]);
  // Nothing chosen: no aim waits for anything either.
  const clearChoice = useCallback(() => {
    aim.current = null;
    clear();
  }, [clear]);
  // A click on the map (OccMap) and a bar of the band select through the URL too.
  const handleMapSelect = useCallback(next => {
    if (next === null) {
      clearChoice();
      return;
    }
    if (next.kind === 'stand') selectStand(next.id);
    else if (next.kind === 'aircraft') selectAircraft(next.id);
    else if (next.kind === 'flight') selectFlight(next.id);
    else return;
    aimAt({ kind: 'reveal', key: aimKeyOf(next.kind, next.id) });
  }, [aimAt, clearChoice, selectAircraft, selectFlight, selectStand]);
  const selectBandStand = useCallback(code => {
    selectStand(code);
    aimAt({ kind: 'reveal', key: aimKeyOf('stand', code) });
  }, [aimAt, selectStand]);
  // «Ver y seguir»: the flight and the view that follows it, written by the console's one store in a row, then follow=1
  // in a later render, once the URL has them (followNext): the map takes the view first, because a view the page asks
  // for ends follow mode (PR M6). `viewShown` says that the map already shows that view.
  const followNext = useRef(null);
  const follow = useCallback((flight, view, { viewShown = false } = {}) => {
    const key = aimKeyOf('flight', flight.flightKey);
    followNext.current = { key, from: selectionKeyOf(latest.current.chosen), view: view ?? null };
    selectFlight(flight.flightKey);
    if (view) setView(view);
    aimAt({ kind: 'follow', key, id: flight.flightKey, view: view ?? null, viewShown: viewShown === true });
  }, [aimAt, selectFlight, setView]);
  // follow=1 once the URL selects the flight and shows its view; another selection meanwhile drops it.
  useEffect(() => {
    const next = followNext.current;
    if (!next) return;
    const verdict = aimVerdict(next, chosen);
    if (verdict === 'drop') followNext.current = null;
    if (verdict !== 'go' || (next.view !== null && selection.view !== next.view)) return;
    followNext.current = null;
    setFollow(true);
  });
  const reread = useCallback(() => {
    planning.refresh?.();
    positions.refresh?.();
    readiness.refresh?.();
    setDrawerRevision(value => value + 1);
  }, [planning, positions, readiness]);

  // The texts of the panels' remote states. A refusal says the plain no-permission sentence of occ-ui, except the
  // planning's: the old Panorama's «No hay una estación OCC autorizada…» answered a refusal of the station's day, which is
  // what that read is, so its figures keep it.
  const remoteLabels = useMemo(() => ({
    loading: t('states.loading'), error: t('states.error'), timeout: t('states.timeout'),
    unauthorized: t('states.unauthorized'), retry: t('states.retry'), stale: t('states.refreshFailed'),
  }), [t]);
  const planningLabels = useMemo(() => ({ ...remoteLabels, forbidden: t('states.forbidden') }), [remoteLabels, t]);
  // The map reads read a refusal as `unauthorized`; the board never says that the session expired for it.
  const boardLabels = useMemo(() => ({ ...remoteLabels, unauthorized: undefined }), [remoteLabels]);
  // The reads «Pendientes de la jornada» comes from, each blanking only its own items (pendingModel.js). The readiness
  // marks belong to the planning's day and wait for it, so they count only once the planning answered.
  const pendingSources = useMemo(() => [
    { id: 'planning', ...panelStateOf(planning) },
    ...(ANSWERED.has(planning.status) ? [{ id: 'readiness', ...panelStateOf(readiness) }] : []),
    { id: 'flights', ...flightsStateOf(live) },
    { id: 'reviewQueue', ...panelStateOf(reviewQueue) },
  ], [live, planning, readiness, reviewQueue]);
  const mapLabels = useMemo(() => ({
    map: t('map.label'), unavailableTitle: t('map.unavailableTitle'),
    unavailableDescription: t('map.unavailableDescription'), unavailableList: t('map.unavailableList'),
  }), [t]);

  // The panels, each element kept while its inputs are the same, so a render of the page that changes nothing of a
  // panel (the map's traffic moving, the clock of another panel) does not render it again.
  const place = layout === 'grid' ? 'grid' : 'float';
  const classes = CONSOLE_OVERLAY_LAYOUT[place];
  // Over the map the panels are docked flush against its edges (CN-32); in the fallback they are the plain grid.
  const panelLayout = place === 'grid' ? 'grid' : 'dock';
  const panelRef = panelId => (place === 'float' ? measure(panelId) : undefined);
  const boardRef = panelRef('board');
  const figuresRef = panelRef('figures');
  const alertsRef = panelRef('alerts');
  const inspectorRef = panelRef('inspector');
  const positionsRef = panelRef('positions');
  const boardState = useMemo(() => boardStateOf(live, board), [board, live]);
  const planningState = useMemo(() => panelStateOf(planning), [planning]);
  const positionsState = useMemo(() => panelStateOf(positions), [positions]);
  const openNotice = useCallback(entry => router.push(notificationTargetPath(entry.notice)), [router]);
  const assignFlightOf = useCallback(flight => setAssignTurnaroundId(flight.turnaroundId), []);
  const stationAirport = live.flights?.stationAirport ?? null;
  const { target, telemetry } = live;

  const boardPanel = useMemo(() => (
    <BoardPanel board={board} state={boardState} labels={boardLabels} selectedId={selectedId}
      onSelect={selectItem} onImport={openImport} onImportFlight={openImport}
      nowMs={nowMs} timeZone={timeZone} date={planningDate} measureRef={boardRef} layout={panelLayout}
      defaultFolded={narrow} className={classes.boardPanel} />
  ), [board, boardLabels, boardRef, boardState, classes.boardPanel, narrow, nowMs, openImport, panelLayout, planningDate,
    selectItem, selectedId, timeZone]);
  const figuresPanel = useMemo(() => (
    <FiguresPanel figures={figures} state={planningState} labels={planningLabels} timeZone={timeZone}
      measureRef={figuresRef} layout={panelLayout} defaultFolded={narrow} className={classes.figuresPanel} />
  ), [classes.figuresPanel, figures, figuresRef, narrow, panelLayout, planningLabels, planningState, timeZone]);
  const alertsPanel = useMemo(() => (
    <AlertsPanel alerts={alerts} notices={notices} pending={pending} pendingSources={pendingSources}
      labels={remoteLabels} onOpen={openNotice} onSelectPending={selectItem} onAssign={setAssignTurnaroundId}
      onImport={openImport} timeZone={timeZone} measureRef={alertsRef} layout={panelLayout}
      defaultFolded={narrow} className={chosen ? classes.alertsPanelWithInspector : classes.alertsPanel} />
  ), [alerts, alertsRef, chosen, classes.alertsPanel, classes.alertsPanelWithInspector, narrow, notices, openImport, openNotice,
    panelLayout, pending, pendingSources, remoteLabels, selectItem, timeZone]);
  const inspectorPanel = useMemo(() => (chosen ? (
    <InspectorPanel selection={chosen} target={target} telemetry={telemetry}
      stationAirport={stationAirport} stationId={station.stationId} stand={selectedStand}
      standFlight={standFlight} stripOf={stripOf} mapFlights={mapFlights} canImport={canImport} canAssign={canAssign}
      onImport={openImport} onAssign={assignFlightOf} onClear={clearChoice}
      nowMs={nowMs} timeZone={timeZone} measureRef={inspectorRef} layout={panelLayout}
      className={wide ? classes.inspectorPanelWide : classes.inspectorPanel} />
  ) : null), [assignFlightOf, canAssign, canImport, chosen, classes.inspectorPanel, classes.inspectorPanelWide, clearChoice,
    inspectorRef, mapFlights, nowMs, openImport, panelLayout, selectedStand, standFlight, station.stationId,
    stationAirport, stripOf, target, telemetry, timeZone, wide]);
  const positionsPanel = useMemo(() => (
    // Docked under the strip of figures (CN-32), the band does not repeat them in its summary.
    <PositionsPanel stands={stands} flightsByTurnaround={flightsByTurnaround} aircraft={aircraft}
      figures={panelLayout === 'dock' ? null : figures}
      state={positionsState} labels={remoteLabels} nowMs={nowMs} timeZone={timeZone}
      selectedBarId={selectedTurnaroundId} onSelectStand={selectBandStand}
      measureRef={positionsRef} layout={panelLayout} className={classes.positionsPanel} />
  ), [aircraft, classes.positionsPanel, figures, flightsByTurnaround, nowMs, panelLayout, positionsRef, positionsState,
    remoteLabels, selectBandStand, selectedTurnaroundId, stands, timeZone]);
  const panels = useMemo(() => ({ board: boardPanel, figures: figuresPanel, alerts: alertsPanel,
    inspector: inspectorPanel, positions: positionsPanel }),
  [alertsPanel, boardPanel, figuresPanel, inspectorPanel, positionsPanel]);

  const pill = useMemo(() => (arrival ? (
    <NewArrivalPill flight={arrival} onFollow={follow} onDismiss={dismissArrival} />
  ) : null), [arrival, dismissArrival, follow]);
  // OccMap's shortcuts wait while a dialog of the console is open: the same function while that does not change.
  const dialogOpen = importOpen || assignTurnaroundId !== null;
  const isShortcutBlocked = useCallback(() => dialogOpen, [dialogOpen]);
  const showPanels = useCallback(() => setFocus(null), [setFocus]);
  // «Meteorología PUJ» (lane M7) over the map, folded at first on a narrow screen.
  const weatherPanel = useMemo(() => (layout === 'map' && !focusMap && weather ? (
    <div data-occ-weather-place="" className="absolute z-20 flex w-[22rem] max-w-[calc(100%-24px)] flex-col overflow-hidden"
      style={WEATHER_PLACE}>
      <MapWeatherPanel weather={weather} nowMs={nowMs ?? undefined} panelLayout="float" defaultFolded={narrow} />
    </div>
  ) : null), [focusMap, layout, narrow, nowMs, weather]);
  // What the map hosts, kept while nothing of it changes, so the map is not handed new children on every render.
  const mapChildren = useMemo(() => (
    <>
      <EngineStatusProbe onChange={setEngineStatus} />
      {layout === 'map' && !focusMap ? <ConsoleOverlay layout="float" wide={wide} {...panels} /> : null}
      {layout === 'map' && focusMap ? (
        <button type="button" onClick={showPanels}
          className={`absolute left-3 top-3 z-20 bg-occ-panel-float ${CONSOLE_ACTION}`}>
          {t('focus.show')}
        </button>
      ) : null}
      <MapSourceStatus status={live.status} picture={live.picture} sourceState={live.sourceState}
        clock={live.clock} onRetry={live.retry} />
      {weatherPanel}
      <Follow3dPanel flights={mapFlights} stationCode={station.stationCode || 'PUJ'} operational={followOperational} />
      {layout === 'map' && pill ? (
        <div data-occ-arrival-place="" className="pointer-events-none absolute z-20" style={ARRIVAL_PLACE}>
          {pill}
        </div>
      ) : null}
      {/* The control rail (CN-32): the views and 3D, the pause, «Capas» and «Leyenda». «Seguir» is the S key, «Ver y
          seguir» and the inspector's flight. */}
      <MapDock>
        <MapPresetSwitcher />
        <MapMotionControl compact />
        <MapLayersMenu />
        {/* Folded at first: the legend opens over the map beside the panels. */}
        <MapLegend defaultOpen={false} />
      </MapDock>
    </>
  ), [focusMap, layout, live.clock, live.picture, live.retry, live.sourceState, live.status, panels, pill, showPanels,
    t, wide, mapFlights, station.stationCode, followOperational, weatherPanel]);

  return (
    <div data-occ-console={layout}
      className={`relative flex h-full min-h-0 flex-col bg-occ-canvas ${layout === 'grid' ? 'overflow-y-auto' : ''}`}>
      <h1 className="sr-only">{t('title')}</h1>
      <div ref={rootRef} data-occ-console-map=""
        className={layout === 'grid' ? 'relative h-80 shrink-0' : 'relative min-h-0 flex-1'}>
        <OccBootContext.Provider value={CONSOLE_MAP_BOOT}>
          <OccMap ref={mapRef} defaultView={CONSOLE_DEFAULT_VIEW} regional3d weather={weather ?? null}
            regionWeather={regionWeather} stands={stands} flights={mapFlights} traffic={traffic}
            selection={chosen} onSelect={handleMapSelect} insets={insets} labels={mapLabels}
            overlays={routeOverlays} overlayData={routes.overlayData}
            onCameraChange={handleCamera} isShortcutBlocked={isShortcutBlocked}>
            {mapChildren}
          </OccMap>
        </OccBootContext.Provider>
      </div>
      {layout === 'grid' ? (
        <>
          {pill ? <div className="px-2 pt-2">{pill}</div> : null}
          <ConsoleOverlay layout="grid" {...panels} />
        </>
      ) : null}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-occ-line bg-occ-panel px-3 py-1">
        <ProvenanceLine stands={stands} picture={live.picture} situation={live.situation} flights={mapFlights}
          clock={live.clock} className="min-w-0 flex-1" />
        {layout === 'map' && !focusMap ? (
          <button type="button" onClick={() => setFocus('map')} className={CONSOLE_ACTION}>{t('focus.hide')}</button>
        ) : null}
        <WeatherPill weather={weather} className="ml-auto" />
        <AirportDelaysPill stationId={station.stationId} label={station.stationCode || 'PUJ'} />
      </div>
      {importOpen && canOpenImport ? (
        <ProviderFlightsDialog stationId={station.stationId} date={planningDate} timeZone={timeZone}
          revision={live.flights?.serverTime ?? 0} onClose={() => setImportOpen(false)} onImported={reread} />
      ) : null}
      <ConsoleAssignDrawer flight={assignFlight} onClose={() => setAssignTurnaroundId(null)} onChanged={reread}
        showToast={showToast} dataRevision={drawerRevision} />
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
