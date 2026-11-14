'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import Toast from '../../../components/Toast';
import { useToast } from '../../../hooks/useToast';
import { useTranslation } from '../../../i18n/LanguageScope';
import { normalizeStandCode } from '../../../services/standCodes';
import { OccBootContext } from '../../admin-occ/boot/occBootContext';
import { STATION_TIME_ZONE } from '../../admin-occ/shell/status/OccClocks';
import { matchFlight, relatedEntities } from '../../maps/core/mapSelection';
import OccMap from '../../maps/core/OccMap';
import MapDock from '../../maps/ui/MapDock';
import MapLayersMenu from '../../maps/ui/MapLayersMenu';
import MapLegend from '../../maps/ui/MapLegend';
import MapPresetSwitcher from '../../maps/ui/MapPresetSwitcher';
import MapSourceStatus from '../../maps/ui/MapSourceStatus';
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
import WeatherPill from './WeatherPill';

// The OCC console, Panorama (contratos 2.5, owner decision 15): the full-bleed map under the status bar, opening on
// Rampa, with the floating panels over it, the maps lane's view selector, layers and legend at the bottom centre and,
// under the map, the provenance line and the weather pill. Presentational: the route (ConsoleRoute.jsx) reads and passes
// everything; this page only holds what the person does on it (the board's tab, which dialog is open, what the engine
// reports). One selection for the map, the board, the band and the inspector: the URL's (contratos 2.1).
//
// When the engine cannot draw, the same panels go into a plain grid beside the map's list (the map stays mounted in
// the same place); with `focus=map` the panels hide behind «Mostrar paneles»; on a narrow screen they open folded.

const EMPTY = Object.freeze([]);
const NO_INSETS = Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 });
const NARROW_QUERY = '(max-width: 1279.98px)';
const FIGURES_FOLDED_QUERY = '(max-width: 1599.98px)';
// Where the pill of a new arrival goes: the top left of the area the panels leave in sight (OccMap's inset variables),
// short of the map's zoom buttons in the top right corner of that area (a 38 px column 10 px from its edge,
// occ-map.css), so it wraps instead of running over them or over «Alertas» (1440 px with both sides open).
const ARRIVAL_PLACE = Object.freeze({
  top: 'calc(var(--occ-map-inset-top, 0px) + 12px)', left: 'calc(var(--occ-map-inset-left, 0px) + 12px)',
  maxWidth: 'calc(100% - var(--occ-map-inset-left, 0px) - var(--occ-map-inset-right, 0px) - 72px)',
});

// The console tells the boot screen when its first data is on screen (ConsoleRoute.jsx). The map it hosts draws from
// the first frame, before that data, so its own report does not end the wait: the console opens with data (contratos 2.6).
const CONSOLE_MAP_BOOT = Object.freeze({ markReady: () => {} });

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
 * - `weather`: useMdpcWeather's view; `selection`: the URL selection store (maps/core/useMapSelection.js).
 * - `accountId`: the signed-in account, whose closed «Llegada nueva» pills the tab remembers (arrivalMemory.js).
 * - `onShown()`: called once the console is on screen (its route tells the OCC boot screen when its data are too).
 */
export default function ConsolePage({ station, live, data, stands = EMPTY, weather, selection, accountId = null, onShown }) {
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
  const [figuresFolded] = useState(() => matches(FIGURES_FOLDED_QUERY));

  const layout = engineStatus === 'unavailable' ? 'grid' : 'map';
  const focusMap = selection.focus === 'map';
  const { insets, rootRef, measure, measured } = useConsoleInsets({ enabled: layout === 'map' && !focusMap });
  const { planning, positions, reviewQueue, readiness, notices } = data;
  const { selection: chosen, selectFlight, selectStand, selectAircraft, clear, setFocus, setFollow, setView } = selection;

  const timeZone = planning.data?.station?.ianaTimeZone ?? STATION_TIME_ZONE;
  const nowMs = useConsoleClock(live.clock);
  const flightRows = live.flights?.flights;
  const mapFlights = flightRows ?? EMPTY;
  const aircraft = live.situation.aircraft;
  const flightsByTurnaround = flightsByTurnaroundOf(flightRows);
  const traffic = useMemo(() => ({ aircraft, trails: live.trails, route: live.route, source: live.situation.source }),
    [aircraft, live.route, live.situation.source, live.trails]);

  const planningFlights = useMemo(() => withAssignmentReadiness(planning.data?.flights ?? EMPTY, readiness.data),
    [planning.data, readiness.data]);
  const board = useMemo(() => (flightRows ? buildBoard({ flights: flightRows, aircraft,
    planningTurnarounds: planning.data?.turnarounds ?? null, nowMs, t }) : null),
  [aircraft, flightRows, nowMs, planning.data, t]);
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
  const openImport = canOpenImport ? () => setImportOpen(true) : undefined;
  const planningFlightOf = turnaroundId => planningFlights.find(item => item.turnaroundId === turnaroundId) ?? null;
  const assignFlight = assignTurnaroundId === null ? null : planningFlightOf(assignTurnaroundId);
  const canImport = flight => canOpenImport && flight?.imported !== true && flight?.proposalId != null;
  const canAssign = flight => flight?.imported === true
    && isInitialAssignmentCandidate(planningFlightOf(flight.turnaroundId));
  const stripOf = flight => (board === null ? null : [...board.arrivals, ...board.departures,
    ...board.toImport.arrivals, ...board.toImport.departures].find(item => item.flightKey === flight?.flightKey) ?? null);

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
  const framedView = selection.view ?? 'ramp';
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
  const pendingSources = [
    { id: 'planning', ...panelStateOf(planning) },
    ...(ANSWERED.has(planning.status) ? [{ id: 'readiness', ...panelStateOf(readiness) }] : []),
    { id: 'flights', ...flightsStateOf(live) },
    { id: 'reviewQueue', ...panelStateOf(reviewQueue) },
  ];
  const mapLabels = useMemo(() => ({
    map: t('map.label'), unavailableTitle: t('map.unavailableTitle'),
    unavailableDescription: t('map.unavailableDescription'), unavailableList: t('map.unavailableList'),
  }), [t]);

  function panels(place) {
    const classes = CONSOLE_OVERLAY_LAYOUT[place];
    const measured = place === 'float';
    const panelLayout = place === 'float' ? 'float' : 'grid';
    const ref = panelId => (measured ? measure(panelId) : undefined);
    return {
      board: (
        <BoardPanel board={board} state={boardStateOf(live, board)} labels={boardLabels} selectedId={selectedId}
          onSelect={selectItem} onImport={openImport} onImportFlight={canOpenImport ? () => setImportOpen(true) : undefined}
          nowMs={nowMs} timeZone={timeZone} date={planningDate} measureRef={ref('board')} layout={panelLayout}
          defaultFolded={narrow} className={classes.boardPanel} />
      ),
      figures: (
        <FiguresPanel figures={figures} state={panelStateOf(planning)} labels={planningLabels} timeZone={timeZone}
          measureRef={ref('figures')} layout={panelLayout} defaultFolded={narrow || figuresFolded}
          className={classes.figuresPanel} />
      ),
      alerts: (
        <AlertsPanel alerts={alerts} notices={notices} pending={pending} pendingSources={pendingSources}
          labels={remoteLabels} onOpen={entry => router.push(notificationTargetPath(entry.notice))}
          onSelectPending={item => selectItem(item)} onAssign={setAssignTurnaroundId}
          onImport={openImport} timeZone={timeZone} measureRef={ref('alerts')} layout={panelLayout}
          defaultFolded={narrow} className={chosen ? classes.alertsPanel : classes.alertsPanelAlone} />
      ),
      inspector: chosen ? (
        <InspectorPanel selection={chosen} target={live.target} telemetry={live.telemetry}
          stationAirport={live.flights?.stationAirport ?? null} stationId={station.stationId} stand={selectedStand}
          standFlight={standFlight} stripOf={stripOf} mapFlights={mapFlights} canImport={canImport} canAssign={canAssign}
          onImport={openImport} onAssign={flight => setAssignTurnaroundId(flight.turnaroundId)} onClear={clearChoice}
          nowMs={nowMs} timeZone={timeZone} measureRef={ref('inspector')} layout={panelLayout}
          className={classes.inspectorPanel} />
      ) : null,
      positions: (
        <PositionsPanel stands={stands} flightsByTurnaround={flightsByTurnaround} aircraft={aircraft} figures={figures}
          state={panelStateOf(positions)} labels={remoteLabels} nowMs={nowMs} timeZone={timeZone}
          selectedBarId={selectedTurnaroundId} onSelectStand={selectBandStand}
          measureRef={ref('positions')} layout={panelLayout} className={classes.positionsPanel} />
      ),
    };
  }

  const pill = arrival ? (
    <NewArrivalPill flight={arrival} onFollow={follow} onDismiss={dismissArrival} />
  ) : null;

  return (
    <div data-occ-console={layout}
      className={`relative flex h-full min-h-0 flex-col bg-occ-canvas ${layout === 'grid' ? 'overflow-y-auto' : ''}`}>
      <h1 className="sr-only">{t('title')}</h1>
      <div ref={rootRef} data-occ-console-map=""
        className={layout === 'grid' ? 'relative h-80 shrink-0' : 'relative min-h-0 flex-1'}>
        <OccBootContext.Provider value={CONSOLE_MAP_BOOT}>
          <OccMap ref={mapRef} defaultView="ramp" stands={stands} flights={mapFlights} traffic={traffic}
            selection={chosen} onSelect={handleMapSelect} insets={insets} labels={mapLabels}
            onCameraChange={handleCamera} isShortcutBlocked={() => importOpen || assignTurnaroundId !== null}>
            <EngineStatusProbe onChange={setEngineStatus} />
            {layout === 'map' && !focusMap ? <ConsoleOverlay layout="float" {...panels('float')} /> : null}
            {layout === 'map' && focusMap ? (
              <button type="button" onClick={() => setFocus(null)}
                className={`absolute left-3 top-3 z-20 bg-occ-panel-float ${CONSOLE_ACTION}`}>
                {t('focus.show')}
              </button>
            ) : null}
            <MapSourceStatus status={live.status} picture={live.picture} sourceState={live.sourceState}
              clock={live.clock} onRetry={live.retry} />
            {layout === 'map' && pill ? (
              <div data-occ-arrival-place="" className="pointer-events-none absolute z-20" style={ARRIVAL_PLACE}>
                {pill}
              </div>
            ) : null}
            <MapDock>
              <MapLayersMenu />
              <MapPresetSwitcher />
              {/* Folded at first: the console's map is the ramp under the panels, and the legend opens over it. */}
              <MapLegend defaultOpen={false} />
            </MapDock>
          </OccMap>
        </OccBootContext.Provider>
      </div>
      {layout === 'grid' ? (
        <>
          {pill ? <div className="px-2 pt-2">{pill}</div> : null}
          <ConsoleOverlay layout="grid" {...panels('grid')} />
        </>
      ) : null}
      <div className="flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-t border-occ-line bg-occ-panel px-3 py-1">
        <ProvenanceLine stands={stands} picture={live.picture} situation={live.situation} flights={mapFlights}
          clock={live.clock} className="min-w-0 flex-1" />
        {layout === 'map' && !focusMap ? (
          <button type="button" onClick={() => setFocus('map')} className={CONSOLE_ACTION}>{t('focus.hide')}</button>
        ) : null}
        <WeatherPill weather={weather} className="ml-auto" />
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
