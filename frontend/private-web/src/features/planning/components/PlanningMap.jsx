import { useEffect, useMemo, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { mapOccupancyToRampPositions, mapStandCode } from '../../positions-map/positionsMapMappers';
import { loadOccPositions } from '../../../services/occPositionsService';
import { useTranslation } from '../../../i18n/LanguageScope';
import { useMapSelection } from '../../maps/core/useMapSelection';
import MapSituationGate, { MapSituationOverlays, trafficSelectionOf } from '../../maps/MapSituationGate';
import { attachStandGeometry } from '../../maps/stands/standModel';
import { useStandDisplay } from '../../maps/stands/useStandDisplay';
import { standInputsOf } from '../../maps/traffic/standInputs';
import StandDetailFacts from '../../maps/ui/StandDetailFacts';
import { formatClock } from '../../occ-ui/occTime';
import { useMdpcWeather } from '../../weather/useMdpcWeather';
import { planningMessages } from '../planningMessages';

// MapLibre needs the browser: the map loads only on the client.
const PositionMap = dynamic(() => import('../../positions-map/components/PositionMap'), {
  ssr: false,
  loading: () => <div role="status" className="p-6 text-sm">…</div>,
});

const panelClass = 'rounded-2xl border border-black/5 bg-white/70 dark:border-white/5 dark:bg-surface-dark-card';

// «19:53», on 24 hours in the station's zone as the OCC console writes it (N28); «—» without a time.
function time(value, timeZone) {
  return value ? formatClock(value, 'es-DO', timeZone ?? 'America/Santo_Domingo') : '—';
}

/**
 * Planning on the map (ADR-0027): the station's stands with the day's flights, from the same
 * OCC positions board the positions map reads. Selecting a flight opens it in the planning drawer.
 * Stands use the location OCC saved; the rest fall back to the unverified internal reference.
 * The selected stand lives in the URL (`stand=`, contracts 2.1), as on the positions map. Inside the OCC frame (PR M6)
 * the stands also read the map flights and the aircraft positions (maps/MapSituationGate.jsx), and the map draws the
 * live, estimated and demo traffic with the chosen flight (`flightId=`) or aircraft (`hex=`), its route and data block.
 * The map also draws the wind at the airfield from the station's aerodrome weather (PR M8, useMdpcWeather).
 */
export default function PlanningMap(props) {
  const { t } = useTranslation(planningMessages);
  const { selection } = useMapSelection();
  return (
    <MapSituationGate selection={selection} fallback={<p role="status" className={`${panelClass} p-5 text-sm`}>{t('map.loading')}</p>}>
      {live => <PlanningMapView {...props} live={live} />}
    </MapSituationGate>
  );
}

function PlanningMapView({ stationId, date, flights = [], timeZone, onSelectFlight, dataRevision = 0, live = null }) {
  const { t } = useTranslation(planningMessages);
  const [state, setState] = useState({ status: 'loading' });
  const { selection, selectStand, selectFlight, selectAircraft, clear } = useMapSelection();
  const selectedCode = selection?.kind === 'stand' ? selection.id : null;
  const trafficSelection = live ? trafficSelectionOf(selection) : null;
  const mapRef = useRef(null);
  // The aerodrome weather of the station (PR M8): its own 10-minute poll; the map draws its wind at the airfield.
  const weather = useMdpcWeather({ stationId, enabled: Boolean(stationId) });

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
  // The map draws each stand as it reads now, and the panel says it; the lists beside it keep the board. Inside the OCC
  // frame (PR M6) with the map flights and the aircraft positions, placed on the airport layout first.
  const layout = live?.layout ?? null;
  const situation = live?.situation ?? null;
  const placedPositions = useMemo(() => (layout ? attachStandGeometry(positions, layout) : positions),
    [positions, layout]);
  const standInputs = useMemo(() => standInputsOf(situation), [situation]);
  // On the clock the map draws its aircraft at (the server's, paused with the motion), so a demo stand changes state
  // when its aircraft parks or leaves.
  const standClock = live?.renderClock ?? null;
  const standOptions = useMemo(() => ({ ...standInputs, clock: standClock }), [standInputs, standClock]);
  const mapPositions = useStandDisplay(placedPositions, standOptions);
  const withFlights = positions.filter(position => position.turnarounds.length > 0);
  const selected = selectedCode === null ? null
    : mapPositions.find(position => mapStandCode(position.id) === selectedCode) ?? null;
  const unassigned = (state.board?.unassigned ?? []).filter(item => plannedIds.has(item.turnaroundId));
  const located = positions.filter(position => position.locationSource === 'occ').length;
  const selectPosition = id => (id == null ? clear() : selectStand(id));
  // A flight or an aircraft chosen on the map (PR M6): the same selection of the URL as on the positions map.
  const selectTraffic = next => (next.kind === 'flight' ? selectFlight(next.id) : selectAircraft(next.id));

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
        <PositionMap ref={mapRef} positions={mapPositions} selectedPositionId={selected?.id ?? selectedCode}
          onSelectPosition={selectPosition} viewMode="2d" traffic={live?.traffic} weather={weather}
          trafficSelection={trafficSelection} onSelectTraffic={live ? selectTraffic : undefined}>
          <MapSituationOverlays live={live} onClose={clear} />
        </PositionMap>
      </div>
      <aside className={`${panelClass} space-y-3 p-4 text-sm`}>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {t('map.located', { located, total: positions.length })}</p>
        {selected ? <div className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="font-semibold">{t('map.stand', { code: selected.id })}</h3>
            <button type="button" className="text-xs text-accent-600" onClick={clear}>{t('map.showAll')}</button>
          </div>
          <StandDetailFacts position={selected} />
          {selected.turnarounds.length ? <ul>{selected.turnarounds.map(flightButton)}</ul>
            : <p className="text-xs">{t('map.standFree')}</p>}
        </div> : <>
          <h3 className="font-semibold">{t('map.standsWithFlights', { count: withFlights.length })}</h3>
          {withFlights.length ? <ul className="space-y-1">{withFlights.map(position => (
            <li key={position.id}>
              <button type="button" onClick={() => { selectStand(position.id); mapRef.current?.flyToPosition?.(position.id); }}
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
