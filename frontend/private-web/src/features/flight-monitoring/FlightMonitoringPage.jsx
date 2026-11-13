import { useEffect, useState } from 'react';
import FlightToolbar from './components/FlightToolbar';
import FlightListPanel from './components/FlightListPanel';
import FlightListDrawer from './components/FlightListDrawer';
import FlightMap from './components/FlightMap';
import FlightDetailPopover from './components/FlightDetailPopover';
import FlightToastStack from './components/FlightToast';
import FlightMonitoringSkeleton from './components/FlightMonitoringSkeleton';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';
import { useFlightAlerts } from './useFlightAlerts';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';
import { getFilterOptions } from './flightMonitoringMappers';
import { useTranslation } from '../../i18n/LanguageScope';
import { flightMonitoringMessages } from './flightMonitoringMessages';

// The detail card is docked at the top left of the map, so it never follows the aircraft on screen.
const DOCKED_POPOVER_STYLE = Object.freeze({ top: 12, left: 12 });

function MonitoringMapArea({
  stationCode,
  flights,
  selectedFlightId,
  onSelectFlight,
  theme,
  selectedFlight,
  now,
  onClosePopover,
  onStatusChange,
}) {
  const { t } = useTranslation(flightMonitoringMessages);
  const geolocatedFlights = flights.filter(flight =>
    Number.isFinite(flight.latitude) && Number.isFinite(flight.longitude));
  // Only PUJ has reviewed coordinates; do not center a different station on PUJ. The map's own legend explains what
  // it draws.
  return (
    <div className="relative min-h-[420px] flex-1">
      {stationCode === 'PUJ' ? <>
        <FlightMap
          flights={geolocatedFlights}
          selectedFlightId={selectedFlightId}
          onSelectFlight={onSelectFlight}
          theme={theme}
        />
        {/* Above the map's dock (views, «Restablecer vista», «Centrar PUJ»), which sits at the bottom of the map. */}
        {geolocatedFlights.length === 0 && <p role="status" className="absolute bottom-20 left-3 z-10 max-w-sm rounded-lg bg-white/90 p-3 text-xs shadow dark:bg-surface-dark-card/90">
          {t('page.noLivePositions')}
        </p>}
      </> : <div role="status" className="flex h-full min-h-[420px] items-center justify-center rounded-2xl border border-black/10 bg-white/80 p-8 text-center text-sm text-text-secondary-light dark:border-white/10 dark:bg-surface-dark-card dark:text-text-secondary-dark">
        {t('page.noLiveSource')}
      </div>}
      <FlightDetailPopover flight={selectedFlight} now={now} style={DOCKED_POPOVER_STYLE} onClose={onClosePopover} onStatusChange={onStatusChange} />
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
  const { t } = useTranslation(flightMonitoringMessages);
  const [selectedFlightId, setSelectedFlightId] = useState(focusFlightId);
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
  } = useFlightMonitoringFilters(flights, data?.station.code);
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
          {t('page.errorTitle')}
        </p>
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
      stationCode={data?.station.code}
      flights={filteredFlights}
      selectedFlightId={selectedFlightId}
      onSelectFlight={setSelectedFlightId}
      theme={theme}
      selectedFlight={selectedFlight}
      now={now}
      onClosePopover={() => setSelectedFlightId(null)}
      onStatusChange={onStatusChange}
    />
  );

  return (
    <div className="mx-auto flex h-full max-w-[1440px] 3xl:max-w-[1760px] flex-col gap-4">
      <h1 className="sr-only">{t('page.title')}</h1>
      <FlightToolbar
        stationCode={data?.station.code}
        source={data?.source}
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
        <div className="relative flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => setListDrawerOpen(true)}
              className="rounded-lg border border-black/10 bg-white/90 px-3 py-2 text-xs font-semibold text-ink-900 shadow-sm dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
            >
              {t('page.viewFlights', { count: filteredFlights.length })}
            </button>
          </div>
          {mapArea}
          <FlightListDrawer open={listDrawerOpen} onClose={() => setListDrawerOpen(false)}>
            {listPanel}
          </FlightListDrawer>
        </div>
      ) : (
        // One bounded row on wide screens: an `auto` row grows with a long flight list and stretched the map to the
        // list's height (3 000 px with 30 flights), which left PUJ and the map's dock below the fold. The list scrolls
        // inside its own panel.
        <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 lg:grid-cols-[minmax(16rem,3fr)_7fr] lg:grid-rows-[minmax(0,1fr)] 2xl:grid-cols-[minmax(20rem,2fr)_7fr]">
          {listPanel}
          {mapArea}
        </div>
      )}

      <FlightToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
