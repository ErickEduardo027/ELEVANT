import { useEffect, useMemo, useRef, useState } from 'react';
import PositionsToolbar from './components/PositionsToolbar';
import PositionMap from './components/PositionMap';
import MapControls from './components/MapControls';
import PositionSummary from './components/PositionSummary';
import PositionsSidePanel from './components/PositionsSidePanel';
import PositionsListDrawer from './components/PositionsListDrawer';
import PositionDetailDrawer from './components/PositionDetailDrawer';
import PositionToastStack from './components/PositionToast';
import PositionsMapSkeleton from './components/PositionsMapSkeleton';
import { usePositionsMapFilters } from './usePositionsMapFilters';
import { usePositionAlerts } from './usePositionAlerts';
import { useIsTabletBreakpoint } from '../flight-monitoring/useIsTabletBreakpoint';
import { findPositionByQuery, mapStandCode } from './positionsMapMappers';
import { ADMIN_OCC_MODULE_IDS } from '../admin-occ/navigation';
import { useTranslation } from '../../i18n/LanguageScope';
import { positionsMapMessages } from './positionsMapMessages';
import { locateOccStand } from '../../services/occPositionsService';
import { useMapSelection } from '../maps/core/useMapSelection';
import MapSituationGate, { MapSituationOverlays, trafficSelectionOf } from '../maps/MapSituationGate';
import { mapMessages } from '../maps/mapMessages';
import { attachStandGeometry, unlocatedStands } from '../maps/stands/standModel';
import { useStandDisplay } from '../maps/stands/useStandDisplay';
import { useOccStation } from '../admin-occ/useOccStation';
import { useMdpcWeather } from '../weather/useMdpcWeather';
import { standInputsOf } from '../maps/traffic/standInputs';

const NO_POSITIONS = Object.freeze([]);
const NO_MESSAGE = Object.freeze({ tone: '', text: '' });
// The data block of the chosen flight or aircraft (PR M6) docks at the top left of the map, right of the page's map
// controls; «Ubicar en el mapa» keeps the top centre.
const DATA_BLOCK_STYLE = Object.freeze({ top: 12, left: 56 });
// The location saved for a stand, as «Ubicar en el mapa» always sent it: six decimals, about 10 cm.
const toSixDecimals = value => Number(Number(value).toFixed(6));

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
  // The stands of the board that no map position shows are listed too, «Sin ubicar», so OCC can place them; the map
  // does not draw them.
  const positions = useMemo(() => {
    if (forceState === 'positionsMapEmpty') return NO_POSITIONS;
    const drawn = data?.positions ?? NO_POSITIONS;
    const missing = unlocatedStands(data?.stands ?? NO_POSITIONS, drawn, { asOf: data?.asOf });
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

  const selectedPosition = selectedCode === null ? null
    : displayedPositions.find(position => mapStandCode(position.id) === selectedCode) ?? null;
  const emptyReason = positions.length === 0 ? 'no-positions' : filteredPositions.length === 0 ? 'no-results' : null;

  function openStand(id) {
    selectStand(id);
    setDrawerOpen(true);
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
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">{t('page.errorTitle')}</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? t('page.errorFallback')}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          {t('page.retry')}
        </button>
      </div>
    );
  }

  if (status === 'success' && data?.source === 'planning-no-map') {
    return <section className="mx-auto max-w-[1200px] space-y-4">
      <header className="rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
        <h1 className="text-lg font-semibold">{t('page.plannedTitle', { station: data.station.code })}</h1>
        <p className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">
          {t('page.plannedDescription')}
        </p>
      </header>
      {positions.length ? <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {positions.map(position => <li key={position.id}
          className="rounded-xl border border-black/5 bg-white/70 p-4 dark:border-white/5 dark:bg-surface-dark-card">
          <p className="font-semibold">{position.id}</p>
          {position.terminal && <p className="text-xs text-text-secondary-light">
            {t('page.terminal', { terminal: position.terminal })}</p>}
          <p className="mt-2 text-xs">{t('page.plannedFlights', { flights: position.plannedFlights.join(', ') || t('page.noFlightNumber') })}</p>
        </li>)}
      </ul> : <p role="status" className="rounded-xl bg-white/70 p-5 text-sm dark:bg-surface-dark-card">
        {t('page.noAssignedPositions')}
      </p>}
    </section>;
  }

  const selectedPositionId = selectedPosition?.id ?? selectedCode;
  const sidePanel = (
    <PositionsSidePanel
      positions={filteredPositions}
      emptyReason={emptyReason}
      selectedPositionId={selectedPositionId}
      onSelectPosition={handleSelectPosition}
    />
  );

  const saving = placing?.phase === 'saving';
  const mapArea = (
    <div ref={mapAreaRef} className="relative min-h-[420px] flex-1 bg-surface-light dark:bg-surface-dark">
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
      >
        <MapSituationOverlays live={live} onClose={clear} blockStyle={DATA_BLOCK_STYLE} />
      </PositionMap>
      {placing && (
        <div ref={placingRef} tabIndex={-1} role="group" aria-label={tMap('placing.label', { code: placing.code })}
          onKeyDown={handlePlacingKeyDown}
          className="absolute left-1/2 top-3 z-10 flex max-w-[calc(100%-1.5rem)] -translate-x-1/2 flex-wrap items-center gap-x-3 gap-y-2 rounded-md border border-occ-line-strong bg-occ-panel-float px-3 py-2 text-sm text-occ-text">
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
      <MapControls
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(mode => (mode === '3d' ? '2d' : '3d'))}
        onCenterPuj={() => mapRef.current?.flyToPuj()}
        fullscreen={fullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />
      {/* The map's own legend explains what it draws. */}
      <PositionSummary positions={positions} source={data?.source} />
    </div>
  );

  return (
    <div className="mx-auto flex h-full max-w-[1440px] 3xl:max-w-[1760px] flex-col gap-4">
      <PositionsToolbar
        search={search}
        onSearchChange={handleSearchChange}
        onSearchSubmit={handleSearchSubmit}
        searchNotFound={searchNotFound}
        terminalFilter={terminalFilter}
        onTerminalChange={handleTerminalChange}
        onToggleSidePanel={() => setSidePanelOpen(open => !open)}
        sidePanelOpen={sidePanelOpen}
      />

      {data?.source === 'planning' && <p role="status" className="rounded-lg border border-accent-600/25 bg-accent-600/5 px-4 py-3 text-sm text-text-secondary-light dark:text-text-secondary-dark">
        {t('page.planningNote')}
      </p>}

      {placeMessage.text && <p role={placeMessage.tone === 'danger' ? 'alert' : 'status'}
        className={`rounded-lg px-4 py-2 text-sm ${placeMessage.tone === 'danger' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10 text-status-success'}`}>
        {placeMessage.text}</p>}

      {displayConnection === 'disconnected' && (
        <p
          role="status"
          className="flex items-center gap-2 rounded-lg border border-status-danger/30 bg-status-danger/10 px-3 py-1.5 text-xs font-medium text-status-danger"
        >
          {t('page.disconnected')}
          {lastUpdatedAt && <span className="font-mono opacity-80">{t('page.lastSync')}</span>}
        </p>
      )}

      {isLoading ? (
        <PositionsMapSkeleton />
      ) : isTablet ? (
        <div className="relative flex flex-1 flex-col">
          {mapArea}
          <PositionsListDrawer open={sidePanelOpen} onClose={() => setSidePanelOpen(false)}>
            {sidePanel}
          </PositionsListDrawer>
        </div>
      ) : (
        <div className={`grid min-h-0 flex-1 gap-4 ${sidePanelOpen ? 'grid-cols-1 lg:grid-cols-[minmax(16rem,3fr)_7fr] 2xl:grid-cols-[minmax(20rem,2fr)_7fr]' : 'grid-cols-1'}`}>
          {sidePanelOpen && sidePanel}
          {mapArea}
        </div>
      )}

      <PositionDetailDrawer
        position={drawerOpen ? selectedPosition : null}
        onClose={() => setDrawerOpen(false)}
        onViewFlightInMonitoring={handleViewFlightInMonitoring}
        canAssign={Boolean(data?.canAssign)}
        candidates={assignCandidates(data)}
        onChanged={onRetry}
        onStartPlacing={handleStartPlacing}
        operationDate={data?.operationDate}
        aircraftFacts={aircraftFacts}
      />

      <PositionToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
