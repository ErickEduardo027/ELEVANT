'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import { serverClock } from '../../services/serverClock';
import { STATION_TIME_ZONE } from '../admin-occ/shell/status/OccClocks';
import { inspectorMilestones } from '../dashboard/noc/milestoneModel';
import { useConsoleClock } from '../dashboard/noc/useConsoleClock';
import { useMapSelection } from '../maps/core/useMapSelection';
import OccButton from '../occ-ui/OccButton';
import OccDrawer from '../occ-ui/OccDrawer';
import OccSkeleton from '../occ-ui/OccSkeleton';
import OccToastStack from '../occ-ui/OccToastStack';
import FlightBoard from './components/FlightBoard';
import FlightInspector from './components/FlightInspector';
import FlightMap from './components/FlightMap';
import { buildFlightBoard, filterBoard, findBoardFlight } from './flightBoardModel';
import { flightMonitoringMessages } from './flightMonitoringMessages';
import { useFlightAlerts } from './useFlightAlerts';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';

// Monitoreo de vuelos as a work map (design E.2, template B «Mapa de trabajo»; CN-32): the board of flight strips at the
// left, the maps lane's map (components/FlightMap.jsx, Región to Rampa with everything it draws) in the rest, and the
// inspector of the chosen flight in the screen's docked side panel, never over the map, so it covers no aircraft and the
// map takes no inset. The map renders the flight's live data block inside that panel (its `liveSlot`), so nothing
// floats over the map.
// Below 1024 px the board opens in a drawer from «Ver vuelos». One selection, the URL's (contratos 2.1,
// maps/core/useMapSelection.js): a strip writes `flightId=` with the leg id and keeps every other key, the map reads the
// same flight and writes `hex=` for other traffic, and a link with a leg id (or its turnaround) selects that flight. The
// station and the health of its sources live in the status bar; a failed refresh keeps the flights on the board under
// its stale notice. The page's own toasts sit at the bottom right of the work area, apart from the frame's.

const NO_FLIGHTS = Object.freeze([]);

/**
 * How the screen is laid out, as pure classes so a test can read what jsdom does not lay out. The board is 24rem wide:
 * a strip's fixed columns take 20.9rem (occ-ui/OccFlightStrip.jsx) and its tags the rest. From 1024 px the board and the
 * map share the height. The map's controls run down its own right edge (maps/ui/MapDock.jsx, CN-32), so it needs no
 * width for them. The inspector of the chosen flight (CN-32):
 * - from 1536 px, a column of its own at the right of the map (22.5rem), the place of the flight panel of follow mode;
 * - from 1024 to 1536 px, in the board's column, which folds away while the inspector is open (as Mapa de posiciones
 *   folds its list), so the map keeps its width on a 1366 px laptop; «Cerrar detalle» brings the board back;
 * - below 1024 px, under the map (the board opens in a drawer from «Ver vuelos»).
 */
export const FLIGHT_MONITORING_LAYOUT = Object.freeze({
  root: 'flex h-full min-h-0 flex-col gap-3',
  grid: 'grid min-h-0 flex-1 gap-3 grid-cols-1 grid-rows-[minmax(26rem,1fr)] lg:grid-cols-[24rem_minmax(0,1fr)] '
    + 'lg:grid-rows-[minmax(0,1fr)]',
  gridWithInspector: 'grid min-h-0 flex-1 gap-3 grid-cols-1 grid-rows-[minmax(26rem,1fr)_auto] '
    + 'lg:grid-cols-[24rem_minmax(0,1fr)] lg:grid-rows-[minmax(0,1fr)] '
    + '2xl:grid-cols-[24rem_minmax(0,1fr)_22.5rem]',
  board: 'flex min-h-0 min-w-0 flex-col lg:col-start-1 lg:row-start-1',
  boardWithInspector: 'flex min-h-0 min-w-0 flex-col lg:col-start-1 lg:row-start-1 lg:max-2xl:hidden',
  map: 'relative min-h-[26rem] min-w-0 row-start-1 lg:col-start-2 lg:row-start-1 lg:min-h-0',
  mapWithInspector: 'relative min-h-[26rem] min-w-0 row-start-1 lg:col-start-2 lg:row-start-1 lg:min-h-0',
  inspector: 'flex min-h-0 min-w-0 max-h-[45dvh] flex-col row-start-2 lg:col-start-1 lg:row-start-1 lg:max-h-none '
    + '2xl:col-start-3',
});

/**
 * The remote state of the board: the read failed (`error`, `forbidden` after a 403, `unauthorized` after a 401), the day
 * has no flight (`empty`) or it has them (`success`), with `staleSince` the time of the flights kept on screen while the
 * connection is lost.
 */
export function boardStateOf({ isError, error, empty, connection, lastUpdatedAt, onRetry }) {
  if (isError) {
    if (error?.status === 403) return { status: 'forbidden', staleSince: null };
    if (error?.status === 401) return { status: 'unauthorized', staleSince: null };
    return { status: 'error', staleSince: null, onRetry };
  }
  return {
    status: empty ? 'empty' : 'success',
    staleSince: connection === 'disconnected' ? lastUpdatedAt ?? null : null,
    onRetry,
  };
}

function MonitoringSkeleton({ label }) {
  return (
    <div data-testid="flight-monitoring-skeleton" className={FLIGHT_MONITORING_LAYOUT.grid}>
      <div aria-hidden="true" className="hidden rounded-md border border-occ-line bg-occ-panel p-3 lg:block">
        <OccSkeleton rows={8} />
      </div>
      <div className="min-h-[26rem] overflow-hidden rounded-md border border-occ-line bg-occ-panel lg:min-h-0">
        <OccSkeleton variant="map" label={label} />
      </div>
    </div>
  );
}

/**
 * The page. `status`, `data`, `error`, `connection` and `lastUpdatedAt` are useFlightMonitoringData's; `onRetry()` reads
 * again; `forceState` is the OCC preview's; `theme` reaches the map as before; `stationId` and `stationCode` are the OCC
 * scope's (the links keep the station; without data the map still knows it is PUJ's). `clock` is the server's clock
 * (src/services/serverClock.js), which the strips count down with.
 */
export default function FlightMonitoringPage({
  status, data, error, connection, lastUpdatedAt, onRetry, forceState = 'default', theme = 'dark', stationId = null,
  stationCode = null, clock = serverClock,
}) {
  const { t, language } = useTranslation(flightMonitoringMessages);
  const { selection, selectFlight, clear } = useMapSelection();
  // The chosen flight as the map flights know it, and those flights (FlightMap's onSelectionFlights): its milestones.
  const [mapChoice, setMapChoice] = useState(null);
  const hearMapChoice = useCallback(value => setMapChoice(value), []);
  const nowMs = useConsoleClock(clock);
  const isTablet = useIsTabletBreakpoint();
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [followed, setFollowed] = useState(null);
  // The element of the inspector the map renders the flight's live data block into (CN-32).
  const [liveSlot, setLiveSlot] = useState(null);
  const boardRef = useRef(null);
  const toggleRef = useRef(null);
  const focusAfterClose = useRef(null);
  // The drawer exists only below 1024 px: widening the window closes it (adjusted while rendering, no effect).
  if (!isTablet && listOpen) setListOpen(false);
  const drawerOpen = isTablet && listOpen;

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'monitoringError';
  const flights = forceState === 'monitoringEmpty' ? NO_FLIGHTS : data?.flights ?? NO_FLIGHTS;
  const displayConnection = forceState === 'monitoringDisconnected' ? 'disconnected' : connection;
  const code = data?.station?.code ?? stationCode;
  const timeZone = data?.station?.ianaTimeZone ?? STATION_TIME_ZONE;

  const board = useMemo(() => buildFlightBoard(flights, { nowMs, t, stationCode: code }), [flights, nowMs, t, code]);
  const shown = filterBoard(board, filter, search);
  const { toasts, dismissToast } = useFlightAlerts(flights, displayConnection);

  // The chosen flight: the URL's, when it names a flight of the page (its leg, its `l:` key or its turnaround).
  const selectedFlight = selection?.kind === 'flight' ? findBoardFlight(flights, selection.id) : null;
  const selectedStrip = selectedFlight ? board.all.find(strip => strip.id === String(selectedFlight.id)) ?? null : null;
  const selectedId = selectedStrip?.id ?? null;
  // The map keeps a flight only it knows (a proposal still to import) by its key.
  const mapSelectedId = selectedFlight ? selectedFlight.id : (selection?.kind === 'flight' ? selection.id : null);

  // A flight chosen on the map or through a link that the direction on screen hides brings «Todos» back. Adjusted while
  // rendering, like the console's board: a direction the person picks afterwards stays.
  if (followed !== selectedId) {
    setFollowed(selectedId);
    if (selectedId !== null && filter !== 'all' && !filterBoard(board, filter).some(strip => strip.id === selectedId)) {
      setFilter('all');
    }
  }

  // «Cerrar detalle» gives the focus back to the strip of the flight, or to «Ver vuelos» while the board is folded away.
  useEffect(() => {
    const id = focusAfterClose.current;
    if (selection !== null || id === null) return;
    focusAfterClose.current = null;
    const items = [...(boardRef.current?.querySelectorAll('[data-occ-board-item]') ?? [])];
    const strip = items.find(item => item.dataset.occBoardItem === id)?.querySelector('button');
    (strip ?? toggleRef.current)?.focus?.();
  }, [selection]);

  const selectStrip = strip => {
    selectFlight(strip.id);
    setListOpen(false);
  };
  // The map names the page's flights by their ids, and gives `null` when the person leaves a flight: that clears a
  // flight, never an aircraft the map has just chosen (`hex=`).
  const selectFromMap = id => {
    if (id === null || id === undefined) {
      if (selection?.kind === 'flight') clear();
      return;
    }
    selectFlight(String(id));
  };
  const closeInspector = () => {
    focusAfterClose.current = selectedId;
    clear();
  };

  const labels = useMemo(() => ({
    loading: t('page.loading'), error: t('page.errorTitle'), timeout: t('page.errorTitle'), retry: t('page.retry'),
    forbidden: t('board.forbidden'), unauthorized: t('board.unauthorized'), stale: t('status.stale'),
  }), [t]);
  const state = boardStateOf({ isError, error, empty: board.counts.all === 0, connection: displayConnection,
    lastUpdatedAt, onRetry });

  const boardPanel = (
    <FlightBoard board={board} state={state} labels={labels} filter={filter} onFilterChange={setFilter} search={search}
      onSearchChange={setSearch} selectedId={selectedId} onSelect={selectStrip} nowMs={nowMs} timeZone={timeZone} />
  );
  const inspector = selectedStrip ? (
    <FlightInspector flight={selectedFlight} strip={selectedStrip} stationId={stationId} timeZone={timeZone}
      onClose={closeInspector} liveSlotRef={setLiveSlot} className="lg:h-full"
      milestones={mapChoice?.flight ? inspectorMilestones(mapChoice.flight, mapChoice.flights, language) : null} />
  ) : null;
  const layout = FLIGHT_MONITORING_LAYOUT;

  return (
    <div data-occ-flight-monitoring="" className={layout.root}>
      <h1 className="sr-only">{t('page.title')}</h1>
      {isTablet && !isLoading ? (
        <div className="flex justify-end">
          <OccButton ref={toggleRef} onClick={() => setListOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>
            {t('page.viewFlights', { count: shown.length })}
          </OccButton>
        </div>
      ) : null}

      {isLoading ? <MonitoringSkeleton label={t('page.loading')} /> : (
        <div className={inspector ? layout.gridWithInspector : layout.grid}>
          {isTablet ? null : (
            <div ref={boardRef} className={inspector ? layout.boardWithInspector : layout.board}>{boardPanel}</div>
          )}
          <div className={inspector ? layout.mapWithInspector : layout.map}>
            {code === 'PUJ' ? (
              // The same props as before: every flight of the page, so a click on the map finds any of them; the
              // inspector replaces the page's card (`detail`).
              <FlightMap flights={flights} selectedFlightId={mapSelectedId} onSelectFlight={selectFromMap} theme={theme}
                detail={null} onSelectionFlights={hearMapChoice} dataBlockSlot={inspector ? liveSlot : null}
                follow3dButton />
            ) : (
              <div role="status"
                className="absolute inset-0 flex items-center justify-center rounded-md border border-occ-line bg-occ-panel p-8 text-center text-sm text-occ-muted">
                {t('page.noLiveSource')}
              </div>
            )}
          </div>
          {inspector ? <div className={layout.inspector}>{inspector}</div> : null}
        </div>
      )}

      {isTablet ? (
        <OccDrawer open={drawerOpen} onClose={() => setListOpen(false)} title={t('list.drawer')} returnFocusRef={toggleRef}>
          <div ref={boardRef} className="flex h-full min-h-0 flex-col">{boardPanel}</div>
        </OccDrawer>
      ) : null}

      <OccToastStack toasts={toasts} onDismiss={dismissToast} placement="workArea" />
    </div>
  );
}
