'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
const NARROW_QUERY = '(max-width: 1279.98px)';
const FIGURES_FOLDED_QUERY = '(max-width: 1599.98px)';
// Where the pill of a new arrival goes: the top left of the area the panels leave in sight (OccMap's inset variables).
const ARRIVAL_PLACE = Object.freeze({
  top: 'calc(var(--occ-map-inset-top, 0px) + 12px)', left: 'calc(var(--occ-map-inset-left, 0px) + 12px)',
});

// The console tells the boot screen when its first data is on screen (ConsoleRoute.jsx). The map it hosts draws from
// the first frame, before that data, so its own report does not end the wait: the console opens with data (contratos 2.6).
const CONSOLE_MAP_BOOT = Object.freeze({ markReady: () => {} });

const matches = query => typeof window !== 'undefined' && typeof window.matchMedia === 'function'
  && window.matchMedia(query).matches;

// The board's remote state: the map flights read (useMapSituation), then whether the day has anything to show.
function boardStateOf(live, board) {
  if (!live.flights || board === null) {
    const status = live.status === 'success' || live.status === 'empty' ? 'loading' : live.status;
    return { status, staleSince: null, onRetry: live.retry };
  }
  const { arrivals, departures, toImport, visits } = board.counts;
  return { status: arrivals + departures + toImport + visits > 0 ? 'success' : 'empty', staleSince: null,
    onRetry: live.retry };
}

/**
 * The console page.
 * - `station`: `{ stationId, stationCode }` of the OCC's PUJ scope.
 * - `live`: the map situation (maps/useMapSituation.js), read once for the map, the board and the inspector.
 * - `data`: the console's own reads (useConsoleData: `planning`, `positions`, `reviewQueue`, `readiness`, `notices`).
 * - `stands`: the stands as the map draws them (useStandDisplay over the positions board and the map flights).
 * - `weather`: useMdpcWeather's view; `selection`: the URL selection store (maps/core/useMapSelection.js).
 * - `onShown()`: called once the console is on screen (its route tells the OCC boot screen when its data are too).
 */
export default function ConsolePage({ station, live, data, stands = EMPTY, weather, selection, onShown }) {
  const { t } = useTranslation(consoleMessages);
  const router = useRouter();
  const mapRef = useRef(null);
  const [engineStatus, setEngineStatus] = useState('starting');
  const [importOpen, setImportOpen] = useState(false);
  const [assignTurnaroundId, setAssignTurnaroundId] = useState(null);
  const { toasts, showToast, dismissToast } = useToast();
  // Read once: the console is a client-only route, so the first render already knows the screen.
  const [narrow] = useState(() => matches(NARROW_QUERY));
  const [figuresFolded] = useState(() => matches(FIGURES_FOLDED_QUERY));

  const layout = engineStatus === 'unavailable' ? 'grid' : 'map';
  const focusMap = selection.focus === 'map';
  const { insets, rootRef, measure } = useConsoleInsets({ enabled: layout === 'map' && !focusMap });
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
    flights: live.flights, nowMs }), [live.flights, nowMs, planning.data, reviewQueue.data]);
  const alerts = useMemo(() => consoleAlerts(notices.data ?? EMPTY, { stationCode: station.stationCode }).entries,
    [notices.data, station.stationCode]);
  const pending = useMemo(() => buildPending({ board, planningFlights: planning.data ? planningFlights : null,
    readiness: readiness.data, reviewQueue: reviewQueue.data, nowMs, t }),
  [board, nowMs, planning.data, planningFlights, readiness.data, reviewQueue.data, t]);
  const { arrival, dismiss: dismissArrival } = useNewDemoArrival(flightRows);

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

  // The opening view framed in the area the panels leave (contratos 2.5): the engine starts before the panels are
  // measured, so the view is framed again once it is ready with the insets known, and again when the panels change the
  // room (a fold, a window resized), as long as nothing moved the camera on purpose since: a person, a selection the
  // console flew to, or a selection at all (OccMap keeps a selected stand in sight; follow mode keeps its flight).
  const framing = useRef({ key: null, moved: false });
  const insetsKey = `${insets.top}|${insets.right}|${insets.bottom}|${insets.left}`;
  const framedView = selection.view ?? 'ramp';
  const framedTerminal = selection.terminal ?? null;
  const held = chosen !== null || selection.follow;
  useEffect(() => {
    const state = framing.current;
    if (engineStatus !== 'ready' || layout !== 'map' || state.key === insetsKey) return;
    const first = state.key === null;
    state.key = insetsKey;
    if (!first && (state.moved || held)) return;
    state.moved = false;
    mapRef.current?.flyToPreset(framedView, { terminal: framedTerminal });
  }, [engineStatus, framedTerminal, framedView, held, insetsKey, layout]);
  const handleCamera = useCallback((camera, details) => {
    if (details?.byUser) framing.current.moved = true;
  }, []);

  // The board, the band and the pending list select through the URL; the map follows the selection.
  const selectItem = useCallback(item => {
    const id = selectionIdOf(item, mapFlights);
    if (id === null) return;
    selectFlight(id);
    const map = mapRef.current;
    if (!map) return;
    framing.current.moved = true;
    if (!map.flyToFlight(id) && item.standCode) map.flyToStand(item.standCode);
  }, [mapFlights, selectFlight]);
  const handleMapSelect = useCallback(next => {
    if (next === null) clear();
    else if (next.kind === 'stand') selectStand(next.id);
    else if (next.kind === 'aircraft') selectAircraft(next.id);
    else if (next.kind === 'flight') selectFlight(next.id);
  }, [clear, selectAircraft, selectFlight, selectStand]);
  // «Ver y seguir»: the flight, follow=1 and the view that follows it, written by the console's one store in a row.
  const follow = useCallback((flight, view) => {
    selectFlight(flight.flightKey);
    setFollow(true);
    if (view) setView(view);
  }, [selectFlight, setFollow, setView]);
  const reread = useCallback(() => {
    planning.refresh?.();
    positions.refresh?.();
    readiness.refresh?.();
  }, [planning, positions, readiness]);

  const remoteLabels = useMemo(() => ({
    loading: t('states.loading'), error: t('states.error'), timeout: t('states.timeout'),
    unauthorized: t('states.unauthorized'), forbidden: t('states.forbidden'), retry: t('states.retry'),
    stale: t('states.refreshFailed'),
  }), [t]);
  // The map reads read a refusal as `unauthorized`; the board never says that the session expired for it.
  const boardLabels = useMemo(() => ({ ...remoteLabels, unauthorized: undefined }), [remoteLabels]);
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
        <FiguresPanel figures={figures} state={panelStateOf(planning)} labels={remoteLabels} timeZone={timeZone}
          measureRef={ref('figures')} layout={panelLayout} defaultFolded={narrow || figuresFolded}
          className={classes.figuresPanel} />
      ),
      alerts: (
        <AlertsPanel alerts={alerts} notices={notices} pending={pending} pendingState={panelStateOf(planning)}
          labels={remoteLabels} onOpen={entry => router.push(notificationTargetPath(entry.notice))}
          onSelectPending={item => selectItem(item)} onAssign={setAssignTurnaroundId}
          onImport={openImport} timeZone={timeZone} measureRef={ref('alerts')} layout={panelLayout}
          defaultFolded={narrow} className={chosen ? classes.alertsPanel : classes.alertsPanelAlone} />
      ),
      inspector: chosen ? (
        <InspectorPanel selection={chosen} target={live.target} telemetry={live.telemetry}
          stationAirport={live.flights?.stationAirport ?? null} stationId={station.stationId} stand={selectedStand}
          standFlight={standFlight} stripOf={stripOf} mapFlights={mapFlights} canImport={canImport} canAssign={canAssign}
          onImport={openImport} onAssign={flight => setAssignTurnaroundId(flight.turnaroundId)} onClear={clear}
          nowMs={nowMs} timeZone={timeZone} measureRef={ref('inspector')} layout={panelLayout}
          className={classes.inspectorPanel} />
      ) : null,
      positions: (
        <PositionsPanel stands={stands} flightsByTurnaround={flightsByTurnaround} aircraft={aircraft} figures={figures}
          state={panelStateOf(positions)} labels={remoteLabels} nowMs={nowMs} timeZone={timeZone}
          selectedBarId={selectedTurnaroundId} onSelectStand={code => selectStand(code)}
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
              <div className="pointer-events-none absolute z-20 max-w-[calc(100%_-_1.5rem)]" style={ARRIVAL_PLACE}>
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
        showToast={showToast} dataRevision={Date.parse(planning.fetchedAt ?? '') || 0} />
      <Toast toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
