import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import PositionsToolbar from './components/PositionsToolbar';
import PositionMap from './components/PositionMap';
import MapControls from './components/MapControls';
import PositionsBand from './components/PositionsBand';
import PositionsTable from './components/PositionsTable';
import PositionDetailDrawer from './components/PositionDetailDrawer';
import PositionsMapSkeleton from './components/PositionsMapSkeleton';
import OccButton from '../occ-ui/OccButton';
import OccDrawer from '../occ-ui/OccDrawer';
import OccGlyph from '../occ-ui/OccGlyph';
import OccPlate from '../occ-ui/OccPlate';
import OccToastStack from '../occ-ui/OccToastStack';
import OccToolbar from '../occ-ui/OccToolbar';
import { STATION_TIME_ZONE } from '../admin-occ/shell/status/OccClocks';
import { flightsByTurnaroundOf } from '../dashboard/noc/standTimeline';
import { useConsoleClock } from '../dashboard/noc/useConsoleClock';
import { serverClock } from '../../services/serverClock';
import { usePositionsMapFilters } from './usePositionsMapFilters';
import { usePositionAlerts } from './usePositionAlerts';
import { useIsTabletBreakpoint } from '../flight-monitoring/useIsTabletBreakpoint';
import { findPositionByQuery, mapStandCode } from './positionsMapMappers';
import { ADMIN_OCC_MODULE_IDS } from '../admin-occ/navigation';
import { useTranslation } from '../../i18n/LanguageScope';
import { positionsMapMessages } from './positionsMapMessages';
import { locateOccStand } from '../../services/occPositionsService';
import { useMapSelection } from '../maps/core/useMapSelection';
import { useStageInsets } from '../maps/ui/useStageInsets';
import MapSituationGate, { MapSituationOverlays, trafficSelectionOf } from '../maps/MapSituationGate';
import { mapMessages } from '../maps/mapMessages';
import { attachStandGeometry, unlocatedStands } from '../maps/stands/standModel';
import { useStandDisplay } from '../maps/stands/useStandDisplay';
import { useOccStation } from '../admin-occ/useOccStation';
import { useMdpcWeather } from '../weather/useMdpcWeather';
import { standInputsOf } from '../maps/traffic/standInputs';

const NO_POSITIONS = Object.freeze([]);
const NO_MESSAGE = Object.freeze({ tone: '', text: '' });
// The data block of the chosen flight or aircraft (PR M6) docks at the top left of the area the floating panels leave in
// sight (OccMap's inset variables, M1), so it never goes under the bar or the list; the page's notices keep the top
// centre and the page's map tools are in the map's control rail at the right (CN-32).
const DATA_BLOCK_STYLE = Object.freeze({
  top: 'calc(var(--occ-map-inset-top, 0px) + 12px)', left: 'calc(var(--occ-map-inset-left, 0px) + 12px)',
  maxWidth: 'calc(100% - var(--occ-map-inset-left, 0px) - var(--occ-map-clear-right, 0px) - 24px)',
});
const TOOLBAR_PANEL_ID = 'pm-toolbar';
const LIST_PANEL_ID = 'pm-list';
const INSPECTOR_PANEL_ID = 'pm-inspector';
const BAND_PANEL_ID = 'pm-band';
// The location saved for a stand, as «Ubicar en el mapa» always sent it: six decimals, about 10 cm.
const toSixDecimals = value => Number(Number(value).toFixed(6));

/**
 * The edge of the map each floating panel of the screen takes room from (maps/ui/stageInsets.js): the bar the top, the
 * list the left, the inspector the right and the stand band the bottom.
 */
export const POSITIONS_MAP_PANEL_EDGES = Object.freeze({
  [TOOLBAR_PANEL_ID]: 'top',
  [LIST_PANEL_ID]: 'left',
  [INSPECTOR_PANEL_ID]: 'right',
  [BAND_PANEL_ID]: 'bottom',
});

// Between the bar and the band: a column at either side starts under the bar and ends over the band, 8 px from both
// (the gap of the insets), or 12 px from the map's edge while neither is measured.
const COLUMN = 'top-[max(12px,var(--occ-map-inset-top,0px))] bottom-[max(12px,var(--occ-map-inset-bottom,0px))]';
const FLOAT_SLAB = 'rounded-[var(--occ-radius-overlay)] border border-occ-line bg-occ-panel-float';
const CHIP = 'pointer-events-auto rounded-md border border-occ-line px-3 py-2 text-sm';

/**
 * How the screen is laid out (design E.2; M1, «pantalla completa con paneles flotantes», which replaces the docked
 * template B of CN-32), as pure classes so a test can read what jsdom does not lay out.
 * - Over the map (`stage`): the map fills the screen, and full screen takes the whole stage. Its panels float in it
 *   12 px from its edges, under the cards of the map (z-20) and its control column (z-30, occ-map.css): the bar
 *   (`toolbar`: the title, the terminals, the search and «Lista de posiciones», on one compact row from 1280 px) at the
 *   top left; «Lista de posiciones» (`list`, 24 rem, 28 rem from 1536 px, where the terminal and agent columns show) at
 *   the left under the bar, folded away below 1536 px while the inspector is open (`listWithInspector`); the inspector
 *   of the chosen stand (`inspector`, 24 rem) at the right, left of the control column (--occ-map-rail-reserve); the
 *   stand band (`band`) along the bottom, ending before the column. None is ever wider than the map leaves beside the
 *   column. The page's notices (`chips`) sit at the top centre of the area the panels leave in sight.
 * - Without a map (`scroll`): the first load, a failed read and another station's planned stands scroll in the frame.
 * Below 1024 px the list opens in a drawer.
 */
export const POSITIONS_MAP_LAYOUT = Object.freeze({
  stage: 'relative h-full min-h-0 overflow-hidden bg-occ-canvas',
  scroll: 'flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3',
  toolbar: `pointer-events-auto absolute left-3 top-3 z-10 max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)] px-3 py-2 ${FLOAT_SLAB}`,
  toolbarRow: 'gap-1.5 xl:flex-row xl:items-end xl:gap-4',
  list: `pointer-events-auto absolute left-3 z-10 flex w-[24rem] 2xl:w-[28rem] ${COLUMN} `
    + 'max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)] min-h-0 flex-col',
  listWithInspector: `pointer-events-auto absolute left-3 z-10 hidden w-[28rem] ${COLUMN} `
    + 'max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)] min-h-0 flex-col 2xl:flex',
  inspector: `pointer-events-auto absolute right-[var(--occ-map-rail-reserve)] z-10 w-[24rem] ${COLUMN} `
    + 'max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)]',
  band: 'pointer-events-auto absolute bottom-3 left-3 right-[var(--occ-map-rail-reserve)] z-10',
  chips: 'occ-map-page-chips pointer-events-none',
  notice: `${CHIP} bg-occ-panel-float text-occ-muted`,
  danger: `${CHIP} border-l-[3px] border-l-occ-danger bg-occ-danger-soft text-occ-text`,
  stale: `${CHIP} flex flex-wrap items-center gap-2 border-l-[3px] border-l-occ-warn bg-occ-warn-soft py-1.5 text-occ-text`,
  placing: `${CHIP} flex flex-wrap items-center gap-x-3 gap-y-2 border-occ-line-strong bg-occ-panel-float text-occ-text`,
});

// Flights that can be brought to a stand: the unassigned ones and those parked elsewhere.
export function assignCandidates(data) {
  const elsewhere = (data?.stands ?? []).flatMap(stand =>
    (stand.turnarounds ?? []).map(item => ({ ...item, standCode: stand.code })));
  return [...(data?.unassigned ?? []), ...elsewhere];
}

/**
 * Mapa de posiciones. Inside the OCC frame (PR M6) its stands read the map flights and the aircraft positions of the
 * station (maps/MapSituationGate.jsx, useMapSituation): a stand reads «Llegando» until its aircraft is on it, draws that
 * aircraft to scale, counts its milestones and asks to record an arrival nobody recorded; and its map draws the live,
 * estimated and demo traffic with the chosen flight's route and data block. The selection is the URL's (`stand=`,
 * `flightId=`, `hex=`). Outside the frame it reads nothing more than the board, as before.
 */
export default function PositionsMapPage(props) {
  const { selection } = useMapSelection();
  return (
    <MapSituationGate selection={selection} fallback={<PositionsMapSkeleton />}>
      {live => <PositionsMapScreen {...props} live={live} />}
    </MapSituationGate>
  );
}

function PositionsMapScreen({
  aircraftFacts = null,
  status,
  data,
  error,
  connection,
  lastUpdatedAt,
  onRetry,
  forceState = 'default',
  theme = 'light',
  onNavigateToResource = () => {},
  live = null,
}) {
  const { t } = useTranslation(positionsMapMessages);
  const { t: tMap } = useTranslation(mapMessages);
  // The selected stand lives in the URL (contracts 2.1: `stand=`); its drawer has an open state of its own, so the first
  // Esc closes the drawer and the next one, on the map, clears the selection (contracts 2.2). Inside the OCC frame a
  // flight (`flightId=`) or an aircraft (`hex=`) of the traffic may be the selection instead (PR M6).
  const { selection, selectStand, selectFlight, selectAircraft, clear } = useMapSelection();
  const selectedCode = selection?.kind === 'stand' ? selection.id : null;
  const trafficSelection = live ? trafficSelectionOf(selection) : null;
  const [drawerOpen, setDrawerOpen] = useState(() => selectedCode !== null);
  const [viewMode, setViewMode] = useState('2d');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  // The stand band starts folded (its header still counts the stands by state): the map keeps its height.
  const [bandOpen, setBandOpen] = useState(false);
  // Counts the stands brought to the centre from the list or the band: each one folds the map's legend.
  const [legendFold, setLegendFold] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);
  // The stand OCC is placing on the map (ADR-0027, Decision D-2): `pointing` until a click on the map sets a pending
  // location, `pending` until «Guardar ubicación» sends it, `saving` while it is sent.
  const [placing, setPlacing] = useState(null);
  const [placeMessage, setPlaceMessage] = useState(NO_MESSAGE);
  const mapRef = useRef(null);
  const mapAreaRef = useRef(null);
  const placingRef = useRef(null);
  const isTablet = useIsTabletBreakpoint();
  // The aerodrome weather of the OCC station (PR M8): its own 10-minute poll; the map draws its wind at the airfield.
  const station = useOccStation();
  const weather = useMdpcWeather({ enabled: station.status === 'ready' });

  useEffect(() => {
    function handleFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  // The notice of a stand being placed takes the focus, so its keys (Esc) and its buttons are at hand.
  const placingStandCode = placing?.code ?? null;
  useEffect(() => {
    if (placingStandCode !== null) placingRef.current?.focus();
  }, [placingStandCode]);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'positionsMapError';
  const plannedOnly = status === 'success' && data?.source === 'planning-no-map';
  // The map fills the screen and its panels are measured into its insets (M1); full screen takes the whole stage.
  const onStage = !isLoading && !isError && !plannedOnly;
  const { insets, rootRef, measure } = useStageInsets({ edges: POSITIONS_MAP_PANEL_EDGES, enabled: onStage });
  const stageRef = useCallback(element => {
    mapAreaRef.current = element;
    rootRef(element);
  }, [rootRef]);
  // The stands of the board that no map position shows are listed too, «Sin ubicar», so OCC can place them; the map
  // does not draw them.
  const positions = useMemo(() => {
    if (forceState === 'positionsMapEmpty') return NO_POSITIONS;
    const drawn = data?.positions ?? NO_POSITIONS;
    const missing = unlocatedStands(data?.stands ?? NO_POSITIONS, drawn,
      { asOf: data?.asOf, operationDate: data?.operationDate });
    return missing.length === 0 ? drawn : [...drawn, ...missing];
  }, [data, forceState]);
  const displayConnection = forceState === 'positionsMapDisconnected' ? 'disconnected' : connection;

  // Each stand as it reads now (the seven states, recomputed on the minute): the map draws it and the drawer says it;
  // the list, the summary and the alerts keep the board's status. Inside the OCC frame (PR M6) with the map flights and
  // the aircraft positions, and placed on the airport layout first, so a stand reads the aircraft inside its box.
  const layout = live?.layout ?? null;
  const situation = live?.situation ?? null;
  const placedPositions = useMemo(() => (layout ? attachStandGeometry(positions, layout) : positions),
    [positions, layout]);
  const standInputs = useMemo(() => standInputsOf(situation), [situation]);
  // On the clock the map draws its aircraft at (the server's, paused with the motion), so a demo stand changes state
  // when its aircraft parks or leaves.
  const standClock = live?.renderClock ?? null;
  const standOptions = useMemo(() => ({ ...standInputs, clock: standClock }), [standInputs, standClock]);
  const displayedPositions = useStandDisplay(placedPositions, standOptions);
  const { search, setSearch, terminalFilter, setTerminalFilter, filteredPositions } = usePositionsMapFilters(displayedPositions);
  const { toasts, dismissToast } = usePositionAlerts(positions, displayConnection);
  // The page's notices in the OCC's toast stack (occ-ui/OccToastStack.jsx), at the bottom right of the work area.
  const pageToasts = useMemo(() => toasts.map(toast => ({ id: toast.id, priority: 'attention',
    message: [toast.title, toast.description].filter(Boolean).join('. ') })), [toasts]);
  // The band reads the visits with the map flights of the frame (their best times), on the server's clock.
  const mapFlightRows = live?.flights?.flights;
  const flightsByTurnaround = useMemo(() => flightsByTurnaroundOf(mapFlightRows), [mapFlightRows]);
  const bandNowMs = useConsoleClock(live?.clock ?? serverClock);

  const selectedPosition = selectedCode === null ? null
    : displayedPositions.find(position => mapStandCode(position.id) === selectedCode) ?? null;
  const emptyReason = positions.length === 0 ? 'no-positions' : filteredPositions.length === 0 ? 'no-results' : null;

  function openStand(id) {
    selectStand(id);
    setDrawerOpen(true);
  }

  // «Cerrar detalle» closes the inspector; the stand stays chosen on the map until Esc there or another choice.
  function closeInspector() {
    setDrawerOpen(false);
  }

  function handleSearchChange(value) {
    setSearch(value);
    setSearchNotFound(false);
  }

  function handleSearchSubmit(query) {
    const found = findPositionByQuery(positions, query);
    if (!found) {
      setSearchNotFound(true);
      return;
    }
    setSearchNotFound(false);
    openStand(found.id);
    mapRef.current?.flyToPosition(found.id);
  }

  function handleTerminalChange(terminalId) {
    setTerminalFilter(terminalId);
    if (terminalId === 'all') {
      mapRef.current?.flyToAll();
      return;
    }
    const coords = positions.filter(position => position.terminal === terminalId).map(position => [position.longitude, position.latitude]);
    mapRef.current?.flyToBounds(coords);
  }

  // A stand chosen on the map or in the list: the map brings it into sight when it is not, and its drawer opens.
  function handleSelectPosition(id) {
    if (id == null) {
      clear();
      return;
    }
    openStand(id);
  }

  // A stand chosen in the table or on the band: the map brings it to the centre of its area, beside the inspector.
  // The legend folds then, so it does not cover the stand.
  function handleSelectFromList(id) {
    if (id == null) return;
    openStand(id);
    setLegendFold(count => count + 1);
    mapRef.current?.flyToPosition(id);
  }

  // A flight or an aircraft chosen on the map (PR M6): its data block shows and its stand is marked.
  function handleSelectTraffic(next) {
    if (next.kind === 'flight') selectFlight(next.id);
    else selectAircraft(next.id);
  }

  function handleToggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      mapAreaRef.current?.requestFullscreen?.();
    }
  }

  function handleStartPlacing(position) {
    setDrawerOpen(false);
    setPlaceMessage(NO_MESSAGE);
    setPlacing({ standId: position.standId, code: mapStandCode(position.id), phase: 'pointing', pending: null });
  }

  // A click on the map while placing sets the pending location; nothing is sent until «Guardar ubicación».
  function handleMapClick({ latitude, longitude, snapped = false }) {
    setPlacing(current => (current === null || current.phase === 'saving'
      ? current
      : { ...current, phase: 'pending', pending: { latitude, longitude, snapped } }));
  }

  function cancelPlacing() {
    setPlacing(current => (current?.phase === 'saving' ? current : null));
  }

  // The same command as always (ADR-0027): the board it answers is read again, and the saved location moves the stand's
  // box rigidly. A failure keeps the pending location and says why in Spanish, never with the server's title.
  async function handleSaveLocation() {
    if (placing?.phase !== 'pending' || !placing.pending || !data?.operationDate) return;
    const { standId, code, pending } = placing;
    setPlaceMessage(NO_MESSAGE);
    setPlacing(current => ({ ...current, phase: 'saving' }));
    try {
      await locateOccStand(standId, toSixDecimals(pending.latitude), toSixDecimals(pending.longitude), data.operationDate);
      setPlaceMessage({ tone: 'success', text: tMap('placing.saved', { code }) });
      setPlacing(null);
      onRetry?.();
    } catch (failure) {
      setPlaceMessage({ tone: 'danger', text: failure.message });
      setPlacing(current => (current?.code === code ? { ...current, phase: 'pending' } : current));
    }
  }

  function handlePlacingKeyDown(event) {
    if (event.key !== 'Escape' || placing?.phase === 'saving') return;
    event.preventDefault();
    cancelPlacing();
  }

  function handleViewFlightInMonitoring(flightId) {
    onNavigateToResource(ADMIN_OCC_MODULE_IDS.FLIGHT_MONITORING, flightId);
  }

  if (isError) {
    return (
      <div className={POSITIONS_MAP_LAYOUT.scroll}>
        <div role="alert"
          className="flex flex-col items-start gap-3 rounded-md border border-l-[3px] border-occ-line border-l-occ-danger bg-occ-panel p-4">
          <p className="text-sm font-semibold text-occ-text">{t('page.errorTitle')}</p>
          <p className="text-sm text-occ-muted">{error?.message ?? t('page.errorFallback')}</p>
          <OccButton onClick={onRetry}>{t('page.retry')}</OccButton>
        </div>
      </div>
    );
  }

  if (plannedOnly) {
    return <section className={POSITIONS_MAP_LAYOUT.scroll}>
      <OccToolbar title={t('page.plannedTitle', { station: data.station.code })} />
      <p className="max-w-3xl text-sm text-occ-muted">{t('page.plannedDescription')}</p>
      {positions.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {positions.map(position => <li key={position.id}
          className="rounded-md border border-occ-line bg-occ-panel p-3 text-sm text-occ-text">
          <OccPlate kind="stand">{position.id}</OccPlate>
          {position.terminal && <p className="mt-1 text-occ-muted">
            {t('page.terminal', { terminal: position.terminal })}</p>}
          <p className="mt-2">{t('page.plannedFlights', { flights: position.plannedFlights.join(', ') || t('page.noFlightNumber') })}</p>
        </li>)}
      </ul> : <p role="status" className="rounded-md border border-occ-line bg-occ-panel p-4 text-sm text-occ-muted">
        {t('page.noAssignedPositions')}
      </p>}
    </section>;
  }

  const frame = POSITIONS_MAP_LAYOUT;
  const selectedPositionId = selectedPosition?.id ?? selectedCode;
  const table = floating => (
    <PositionsTable
      positions={filteredPositions}
      emptyReason={emptyReason}
      selectedPositionId={selectedPositionId}
      onSelectPosition={handleSelectFromList}
      floating={floating}
      className="h-full"
    />
  );
  const toolbar = className => (
    <PositionsToolbar
      search={search}
      onSearchChange={handleSearchChange}
      onSearchSubmit={handleSearchSubmit}
      searchNotFound={searchNotFound}
      terminalFilter={terminalFilter}
      onTerminalChange={handleTerminalChange}
      onToggleSidePanel={() => setSidePanelOpen(open => !open)}
      sidePanelOpen={sidePanelOpen}
      count={isLoading ? null : positions.length}
      className={className}
    />
  );
  const toastStack = <OccToastStack toasts={pageToasts} onDismiss={dismissToast} placement="workArea" />;

  if (isLoading) {
    return (
      <div data-occ-positions-map="loading" className={frame.scroll}>
        {toolbar('')}
        <PositionsMapSkeleton />
        {toastStack}
      </div>
    );
  }

  const saving = placing?.phase === 'saving';
  // The page's notices, at the top centre of the area the panels leave in sight (occ-map.css, .occ-map-page-chips).
  const planningNote = data?.source === 'planning';
  const disconnected = displayConnection === 'disconnected';
  const chips = placing || planningNote || placeMessage.text || disconnected ? (
    <div data-occ-positions-chips="" className={frame.chips}>
      {placing && (
        <div ref={placingRef} tabIndex={-1} role="group" aria-label={tMap('placing.label', { code: placing.code })}
          onKeyDown={handlePlacingKeyDown} className={frame.placing}>
          <p role="status" className="min-w-0">
            {saving ? tMap('placing.saving', { code: placing.code }) : tMap('placing.prompt', { code: placing.code })}
          </p>
          <div className="flex items-center gap-2">
            <button type="button" disabled={placing.phase !== 'pending'} onClick={() => void handleSaveLocation()}
              className="min-h-9 rounded bg-occ-primary px-3 font-semibold text-occ-on-primary hover:bg-occ-primary-hover disabled:cursor-not-allowed disabled:bg-occ-panel-raised disabled:text-occ-faint">
              {tMap('placing.save')}
            </button>
            <button type="button" disabled={saving} onClick={cancelPlacing}
              className="min-h-9 rounded border border-occ-line px-3 font-semibold text-occ-text hover:border-occ-line-strong disabled:cursor-not-allowed disabled:text-occ-faint">
              {tMap('placing.cancel')}
            </button>
          </div>
        </div>
      )}
      {planningNote && <p role="status" className={frame.notice}>{t('page.planningNote')}</p>}
      {placeMessage.text && <p role={placeMessage.tone === 'danger' ? 'alert' : 'status'}
        className={placeMessage.tone === 'danger' ? frame.danger : frame.notice}>
        {placeMessage.text}</p>}
      {disconnected && (
        <p role="status" className={frame.stale}>
          <OccGlyph name="attention" />
          {t('page.disconnected')}
          {lastUpdatedAt && <span className="text-occ-muted">{t('page.lastSync')}</span>}
        </p>
      )}
    </div>
  ) : null;

  const inspectorOpen = drawerOpen && selectedPosition !== null;
  const listShown = sidePanelOpen && !isTablet;

  return (
    <div ref={stageRef} data-occ-positions-map="map" className={frame.stage}>
      <PositionMap
        ref={mapRef}
        positions={filteredPositions}
        selectedPositionId={selectedPositionId}
        onSelectPosition={handleSelectPosition}
        theme={theme}
        viewMode={viewMode}
        placing={placing !== null}
        placingCode={placing?.code ?? null}
        pendingLocation={placing?.pending ?? null}
        onCancelPlacing={cancelPlacing}
        onMapClick={placing ? handleMapClick : undefined}
        weather={weather}
        traffic={live?.traffic}
        trafficSelection={trafficSelection}
        onSelectTraffic={live ? handleSelectTraffic : undefined}
        focusSelectedOnStart
        legendFoldKey={legendFold}
        insets={insets}
        className=""
        railTools={(
          <MapControls
            viewMode={viewMode}
            onToggleViewMode={() => setViewMode(mode => (mode === '3d' ? '2d' : '3d'))}
            onCenterPuj={() => mapRef.current?.flyToPuj()}
            fullscreen={fullscreen}
            onToggleFullscreen={handleToggleFullscreen}
          />
        )}
      >
        {/* The panels float inside the map, under its cards and its control column, whose menus open over them. */}
        <div ref={measure(TOOLBAR_PANEL_ID)} data-occ-positions-toolbar="" className={frame.toolbar}>
          {toolbar(frame.toolbarRow)}
        </div>
        {listShown ? (
          <div ref={measure(LIST_PANEL_ID)} data-occ-positions-list=""
            className={inspectorOpen ? frame.listWithInspector : frame.list}>{table(true)}</div>
        ) : null}
        {inspectorOpen ? (
          <PositionDetailDrawer
            ref={measure(INSPECTOR_PANEL_ID)}
            variant="floating"
            position={selectedPosition}
            onClose={closeInspector}
            onViewFlightInMonitoring={handleViewFlightInMonitoring}
            canAssign={Boolean(data?.canAssign)}
            candidates={assignCandidates(data)}
            onChanged={onRetry}
            onStartPlacing={handleStartPlacing}
            operationDate={data?.operationDate}
            aircraftFacts={aircraftFacts}
            className={frame.inspector}
          />
        ) : null}
        <div ref={measure(BAND_PANEL_ID)} data-occ-positions-band-slot="" className={frame.band}>
          <PositionsBand stands={displayedPositions} flightsByTurnaround={flightsByTurnaround}
            aircraft={situation?.aircraft} nowMs={bandNowMs} timeZone={STATION_TIME_ZONE} selectedCode={selectedCode}
            onSelectStand={handleSelectFromList} open={bandOpen} onToggle={() => setBandOpen(open => !open)} floating />
        </div>
        {/* Before the traffic's state, so its chips go under the page's (occ-map.css). */}
        {chips}
        <MapSituationOverlays live={live} onClose={clear} blockStyle={DATA_BLOCK_STYLE} />
      </PositionMap>

      {isTablet ? (
        <OccDrawer open={sidePanelOpen} onClose={() => setSidePanelOpen(false)} title={t('list.drawer')}>
          <div data-testid="positions-list-drawer" className="flex h-full min-h-0 flex-col">{table(false)}</div>
        </OccDrawer>
      ) : null}

      {toastStack}
    </div>
  );
}
