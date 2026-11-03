import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { loadOccPositions } from '../../../services/occPositionsService';
import { useTranslation } from '../../../i18n/LanguageScope';
import { planningMessages } from '../planningMessages';

// MapLibre needs the browser: the map loads only on the client.
const PositionMap = dynamic(() => import('../../positions-map/components/PositionMap'), {
  ssr: false,
  loading: () => <div role="status" className="p-6 text-sm">…</div>,
});

const panelClass = 'rounded-2xl border border-black/5 bg-white/70 dark:border-white/5 dark:bg-surface-dark-card';

function time(value, timeZone) {
  return value ? new Intl.DateTimeFormat('es-DO', { timeStyle: 'short', timeZone: timeZone ?? 'America/Santo_Domingo' })
    .format(new Date(value)) : '—';
}

/**
 * Planning on the map (ADR-0027): the station's stands with the day's flights, from the same
 * OCC positions board the positions map reads. Selecting a flight opens it in the planning drawer.
 * Stands use the location OCC saved; the rest fall back to the unverified internal reference.
 */
export default function PlanningMap({ stationId, date, flights = [], timeZone, onSelectFlight, dataRevision = 0 }) {
  const { t } = useTranslation(planningMessages);
  const [state, setState] = useState({ status: 'loading' });
  const [selectedId, setSelectedId] = useState(null);
  const mapRef = useRef(null);

  useEffect(() => {
    if (!stationId || !date) return undefined;
    const controller = new AbortController();
    loadOccPositions(stationId, date, { signal: controller.signal })
      .then(board => setState({ status: 'success', board }))
      .catch(error => { if (error?.name !== 'AbortError') setState({ status: 'error', error }); });
    return () => controller.abort();
  }, [stationId, date, dataRevision]);

  const plannedIds = useMemo(() => new Set(flights.map(flight => flight.id)), [flights]);
  const positions = useMemo(() => state.board ? mapOccupancyToRampPositions(RAMP_POSITIONS, state.board) : [],
    [state.board]);
  const withFlights = positions.filter(position => position.turnarounds.length > 0);
  const selected = positions.find(position => position.id === selectedId) ?? null;
  const unassigned = (state.board?.unassigned ?? []).filter(item => plannedIds.has(item.turnaroundId));
  const located = positions.filter(position => position.locationSource === 'occ').length;

  if (state.status === 'loading') return <p role="status" className={`${panelClass} p-5 text-sm`}>{t('map.loading')}</p>;
  if (state.status === 'error') return <p role="alert" className={`${panelClass} p-5 text-sm text-status-danger`}>{state.error.message}</p>;

  const flightButton = item => (
    <li key={item.turnaroundId}>
      <button type="button" disabled={!plannedIds.has(item.turnaroundId)} onClick={() => onSelectFlight?.(item.turnaroundId)}
        className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent-600/10 disabled:opacity-60">
        <span className="font-semibold">{item.arrivalFlightNumber ?? item.departureFlightNumber ?? item.operationCode}</span>
        {' · '}{item.airlineName}{' · '}{time(item.arrivalScheduledAt ?? item.departureScheduledAt, timeZone)}
      </button>
    </li>
  );

  return (
    <section aria-label={t('map.label')} className="grid gap-4 lg:grid-cols-[7fr_minmax(16rem,3fr)]">
      <div className={`${panelClass} relative min-h-[460px] overflow-hidden`}>
        <PositionMap ref={mapRef} positions={positions} selectedPositionId={selectedId} onSelectPosition={setSelectedId}
          theme="light" viewMode="2d" />
      </div>
      <aside className={`${panelClass} space-y-3 p-4 text-sm`}>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {t('map.located', { located, total: positions.length })}</p>
        {selected ? <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('map.stand', { code: selected.id })}</h3>
            <button type="button" className="text-xs text-accent-600" onClick={() => setSelectedId(null)}>{t('map.showAll')}</button>
          </div>
          {selected.turnarounds.length ? <ul>{selected.turnarounds.map(flightButton)}</ul>
            : <p className="text-xs">{t('map.standFree')}</p>}
        </div> : <>
          <h3 className="font-semibold">{t('map.standsWithFlights', { count: withFlights.length })}</h3>
          {withFlights.length ? <ul className="space-y-1">{withFlights.map(position => (
            <li key={position.id}>
              <button type="button" onClick={() => { setSelectedId(position.id); mapRef.current?.flyToPosition?.(position.id); }}
                className="w-full rounded-lg px-2 py-1.5 text-left text-xs hover:bg-accent-600/10">
                <span className="font-mono font-semibold">{position.id}</span>
                {' · '}{position.turnarounds.map(item => item.arrivalFlightNumber ?? item.operationCode).join(', ')}
              </button>
            </li>))}</ul> : <p className="text-xs">{t('map.noStands')}</p>}
        </>}
        <div className="border-t border-black/5 pt-3 dark:border-white/5">
          <h3 className="font-semibold">{t('map.unassigned', { count: unassigned.length })}</h3>
          {unassigned.length ? <ul>{unassigned.map(flightButton)}</ul> : <p className="text-xs">{t('map.allAssigned')}</p>}
        </div>
      </aside>
    </section>
  );
}
