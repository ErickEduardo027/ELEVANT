import { useEffect, useState } from 'react';
import FlightToolbar from './components/FlightToolbar';
import FlightListPanel from './components/FlightListPanel';
import FlightListDrawer from './components/FlightListDrawer';
import FlightMap from './components/FlightMap';
import FlightLegend from './components/FlightLegend';
import FlightDetailPopover from './components/FlightDetailPopover';
import FlightToastStack from './components/FlightToast';
import FlightMonitoringSkeleton from './components/FlightMonitoringSkeleton';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';
import { useFlightAlerts } from './useFlightAlerts';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';
import { getFilterOptions } from './flightMonitoringMappers';

function MonitoringMapArea({
  flights,
  selectedFlightId,
  onSelectFlight,
  theme,
  onPopoverPosition,
  popoverPosition,
  selectedFlight,
  now,
  onClosePopover,
  onStatusChange,
}) {
  return (
    <div className="relative min-h-[420px] flex-1">
      <FlightMap
        flights={flights}
        selectedFlightId={selectedFlightId}
        onSelectFlight={onSelectFlight}
        theme={theme}
        onPopoverPosition={onPopoverPosition}
      />
      <FlightLegend />
      <FlightDetailPopover flight={selectedFlight} now={now} style={popoverPosition ?? {}} onClose={onClosePopover} onStatusChange={onStatusChange} />
    </div>
  );
}

export default function FlightMonitoringPage({
  status,
  data,
  error,
  connection,
  lastUpdatedAt,
  onRetry,
  forceState = 'default',
  theme = 'light',
  focusFlightId = null,
  onStatusChange,
}) {
  const [selectedFlightId, setSelectedFlightId] = useState(focusFlightId);
  const [popoverPosition, setPopoverPosition] = useState(null);
  const [now, setNow] = useState(() => new Date().toISOString());
  const [listDrawerOpen, setListDrawerOpen] = useState(false);
  const isTablet = useIsTabletBreakpoint();

  useEffect(() => {
    const id = setInterval(() => setNow(new Date().toISOString()), 30000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    if (!isTablet) setListDrawerOpen(false);
  }, [isTablet]);

  useEffect(() => {
    if (focusFlightId) setSelectedFlightId(focusFlightId);
  }, [focusFlightId]);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'monitoringError';

  const flights = forceState === 'monitoringEmpty' ? [] : data?.flights ?? [];
  const displayConnection = forceState === 'monitoringDisconnected' ? 'disconnected' : connection;

  const {
    filters,
    setFilter,
    activeChip,
    setActiveChip,
    onlyStationRelated,
    setOnlyStationRelated,
    filteredFlights,
  } = useFlightMonitoringFilters(flights);
  const { toasts, dismissToast } = useFlightAlerts(flights, displayConnection);

  const options = getFilterOptions(flights);
  const selectedFlight = flights.find(flight => flight.id === selectedFlightId) ?? null;
  const emptyReason = flights.length === 0 ? 'no-flights' : filteredFlights.length === 0 ? 'no-results' : null;

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">
          No se pudo cargar el monitoreo de vuelos de la estación.
        </p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={onRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const listPanel = (
    <FlightListPanel
      flights={filteredFlights}
      emptyReason={emptyReason}
      search={filters.search}
      onSearchChange={value => setFilter('search', value)}
      activeChip={activeChip}
      onChipChange={setActiveChip}
      selectedFlightId={selectedFlightId}
      onSelectFlight={setSelectedFlightId}
    />
  );

  const mapArea = (
    <MonitoringMapArea
      flights={filteredFlights}
      selectedFlightId={selectedFlightId}
      onSelectFlight={setSelectedFlightId}
      theme={theme}
      onPopoverPosition={setPopoverPosition}
      popoverPosition={popoverPosition}
      selectedFlight={selectedFlight}
      now={now}
      onClosePopover={() => setSelectedFlightId(null)}
      onStatusChange={onStatusChange}
    />
  );

  return (
    <div className="mx-auto flex h-full max-w-[1440px] flex-col gap-4">
      <FlightToolbar
        connection={displayConnection}
        lastUpdatedAt={lastUpdatedAt}
        onRefresh={onRetry}
        filters={filters}
        onFilterChange={setFilter}
        options={options}
        onlyStationRelated={onlyStationRelated}
        onToggleStationRelated={setOnlyStationRelated}
      />

      {isLoading ? (
        <FlightMonitoringSkeleton />
      ) : isTablet ? (
        <div className="relative flex flex-1 flex-col">
          {mapArea}
          <button
            type="button"
            onClick={() => setListDrawerOpen(true)}
            className="absolute left-3 top-3 z-10 rounded-lg border border-black/10 bg-white/90 px-3 py-1.5 text-xs font-semibold text-ink-900 shadow-md backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
          >
            Ver vuelos
          </button>
          <FlightListDrawer open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
            {listPanel}
          </FlightListDrawer>
        </div>
      ) : (
        <div className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_7fr]">
          {listPanel}
          {mapArea}
        </div>
      )}

      <FlightToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
