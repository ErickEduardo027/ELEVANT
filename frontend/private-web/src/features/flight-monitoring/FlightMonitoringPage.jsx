import { useEffect, useState } from 'react';
import FlightToolbar from './components/FlightToolbar';
import FlightListPanel from './components/FlightListPanel';
import FlightDetailPopover from './components/FlightDetailPopover';
import FlightToastStack from './components/FlightToast';
import { useFlightMonitoringFilters } from './useFlightMonitoringFilters';
import { useFlightAlerts } from './useFlightAlerts';
import { getFilterOptions } from './flightMonitoringMappers';
import Drawer from '../../components/Drawer';
import { useTranslation } from '../../i18n/LanguageScope';
import { flightMonitoringMessages } from './flightMonitoringMessages';
import { occUiMessages } from '../admin-occ/ui/occUiMessages';

/** Existing read capabilities, without duplicating Panorama's maps. */
export default function FlightMonitoringPage({ status, data, error, connection, lastUpdatedAt,
  onRetry, forceState = 'default', focusFlightId = null, onStatusChange }) {
  const { t } = useTranslation(flightMonitoringMessages);
  const { t: ui } = useTranslation(occUiMessages);
  const [selectedFlightId, setSelectedFlightId] = useState(focusFlightId);
  const [now, setNow] = useState(() => new Date().toISOString());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date().toISOString()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  useEffect(() => { if (focusFlightId) setSelectedFlightId(focusFlightId); }, [focusFlightId]);
  const denied = status === 'forbidden' || error?.status === 403;
  const expired = status === 'unauthorized' || error?.status === 401;
  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = denied || expired || (status === 'error' && forceState === 'default') || forceState === 'monitoringError';
  const flights = forceState === 'monitoringEmpty' ? [] : data?.flights ?? [];
  const displayConnection = forceState === 'monitoringDisconnected' ? 'disconnected' : connection;
  const { filters, setFilter, activeChip, setActiveChip, onlyStationRelated, setOnlyStationRelated,
    filteredFlights } = useFlightMonitoringFilters(flights, data?.station.code);
  const { toasts, dismissToast } = useFlightAlerts(flights, displayConnection);
  const selectedFlight = !isLoading && !isError ? flights.find(flight => flight.id === selectedFlightId) ?? null : null;
  const emptyReason = flights.length === 0 ? 'no-flights' : filteredFlights.length === 0 ? 'no-results' : null;
  return <section className="space-y-5">
    <header data-occ-header><div><h1>{ui('flights')}</h1><p className="mt-2 text-sm text-occ-muted">{ui('flightsHint')}</p></div>
      <p className="text-xs text-occ-muted">{ui('mapsInPanorama')}</p></header>
    {!isError && !isLoading && <FlightToolbar stationCode={data?.station.code} source={data?.source} connection={displayConnection}
      lastUpdatedAt={lastUpdatedAt} onRefresh={onRetry} filters={filters} onFilterChange={setFilter}
      options={getFilterOptions(flights)} onlyStationRelated={onlyStationRelated} onToggleStationRelated={setOnlyStationRelated} />}
    {isLoading ? <p role="status" data-occ-surface>{ui('loading')}</p> : isError ?
      <div role="alert" data-occ-surface><h2 className="font-semibold text-status-danger">{denied ? ui('forbidden') : expired ? ui('sessionExpired') : t('page.errorTitle')}</h2>
        {!denied && !expired && <><p className="mt-2 text-sm">{t('page.errorFallback')}</p><button type="button" onClick={onRetry}
          className="mt-4 rounded-md bg-accent-600 px-4 text-sm font-semibold text-white">{t('page.retry')}</button></>}</div> :
      <FlightListPanel flights={filteredFlights} emptyReason={emptyReason} search={filters.search}
        onSearchChange={value => setFilter('search', value)} activeChip={activeChip} onChipChange={setActiveChip}
        selectedFlightId={selectedFlightId} onSelectFlight={setSelectedFlightId} />}
    <Drawer open={Boolean(selectedFlight)} onClose={() => setSelectedFlightId(null)} title={ui('flightDetails')}>
      <FlightDetailPopover flight={selectedFlight} now={now} inline onClose={() => setSelectedFlightId(null)} onStatusChange={onStatusChange} />
    </Drawer>
    {!isLoading && !isError && <FlightToastStack toasts={toasts} onDismiss={dismissToast} />}
  </section>;
}
