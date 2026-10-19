import { useEffect, useRef, useState } from 'react';
import PositionsToolbar from './components/PositionsToolbar';
import PositionMap from './components/PositionMap';
import MapControls from './components/MapControls';
import PositionLegend from './components/PositionLegend';
import PositionSummary from './components/PositionSummary';
import PositionsSidePanel from './components/PositionsSidePanel';
import PositionsListDrawer from './components/PositionsListDrawer';
import PositionDetailDrawer from './components/PositionDetailDrawer';
import PositionToastStack from './components/PositionToast';
import PositionsMapSkeleton from './components/PositionsMapSkeleton';
import { usePositionsMapFilters } from './usePositionsMapFilters';
import { usePositionAlerts } from './usePositionAlerts';
import { useIsTabletBreakpoint } from '../flight-monitoring/useIsTabletBreakpoint';
import { findPositionByQuery } from './positionsMapMappers';
import { ADMIN_OCC_MODULE_IDS } from '../admin-occ/navigation';
import { useTranslation } from '../../i18n/LanguageScope';
import { positionsMapMessages } from './positionsMapMessages';

export default function PositionsMapPage({
  status,
  data,
  error,
  connection,
  lastUpdatedAt,
  onRetry,
  forceState = 'default',
  theme = 'light',
  onNavigateToResource = () => {},
}) {
  const { t } = useTranslation(positionsMapMessages);
  const [selectedPositionId, setSelectedPositionId] = useState(null);
  const [viewMode, setViewMode] = useState('2d');
  const [sidePanelOpen, setSidePanelOpen] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);
  const [searchNotFound, setSearchNotFound] = useState(false);
  const mapRef = useRef(null);
  const mapAreaRef = useRef(null);
  const isTablet = useIsTabletBreakpoint();

  useEffect(() => {
    function handleFullscreenChange() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'positionsMapError';
  const positions = forceState === 'positionsMapEmpty' ? [] : data?.positions ?? [];
  const displayConnection = forceState === 'positionsMapDisconnected' ? 'disconnected' : connection;

  const { search, setSearch, terminalFilter, setTerminalFilter, filteredPositions } = usePositionsMapFilters(positions);
  const { toasts, dismissToast } = usePositionAlerts(positions, displayConnection);

  const selectedPosition = positions.find(position => position.id === selectedPositionId) ?? null;
  const emptyReason = positions.length === 0 ? 'no-positions' : filteredPositions.length === 0 ? 'no-results' : null;

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
    setSelectedPositionId(found.id);
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

  function handleSelectFromList(id) {
    setSelectedPositionId(id);
    mapRef.current?.flyToPosition(id);
  }

  function handleToggleFullscreen() {
    if (document.fullscreenElement) {
      document.exitFullscreen?.();
    } else {
      mapAreaRef.current?.requestFullscreen?.();
    }
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

  const sidePanel = (
    <PositionsSidePanel
      positions={filteredPositions}
      emptyReason={emptyReason}
      selectedPositionId={selectedPositionId}
      onSelectPosition={handleSelectFromList}
    />
  );

  const mapArea = (
    <div ref={mapAreaRef} className="relative min-h-[420px] flex-1 bg-surface-light dark:bg-surface-dark">
      <PositionMap
        ref={mapRef}
        positions={filteredPositions}
        selectedPositionId={selectedPositionId}
        onSelectPosition={setSelectedPositionId}
        theme={theme}
        viewMode={viewMode}
      />
      <MapControls
        viewMode={viewMode}
        onToggleViewMode={() => setViewMode(mode => (mode === '3d' ? '2d' : '3d'))}
        onCenterPuj={() => mapRef.current?.flyToPuj()}
        fullscreen={fullscreen}
        onToggleFullscreen={handleToggleFullscreen}
      />
      <PositionLegend source={data?.source} />
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
        position={selectedPosition}
        onClose={() => setSelectedPositionId(null)}
        onViewFlightInMonitoring={handleViewFlightInMonitoring}
      />

      <PositionToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
