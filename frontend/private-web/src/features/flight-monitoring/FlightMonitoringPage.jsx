'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMediaQuery } from '../../hooks/useMediaQuery';
import { useTranslation } from '../../i18n/LanguageScope';
import { serverClock } from '../../services/serverClock';
import { STATION_TIME_ZONE } from '../admin-occ/shell/status/OccClocks';
import { inspectorMilestones } from '../dashboard/noc/milestoneModel';
import { useConsoleClock } from '../dashboard/noc/useConsoleClock';
import { useMapSelection } from '../maps/core/useMapSelection';
import { useStageInsets } from '../maps/ui/useStageInsets';
import OccButton from '../occ-ui/OccButton';
import OccDrawer from '../occ-ui/OccDrawer';
import OccSkeleton from '../occ-ui/OccSkeleton';
import OccToastStack from '../occ-ui/OccToastStack';
import FlightBoard, { FLIGHT_BOARD_PANEL_ID } from './components/FlightBoard';
import FlightInspector from './components/FlightInspector';
import FlightMap from './components/FlightMap';
import { buildFlightBoard, filterBoard, findBoardFlight } from './flightBoardModel';
import { flightMonitoringMessages } from './flightMonitoringMessages';
import { useFlightAlerts } from './useFlightAlerts';
import { useIsTabletBreakpoint } from './useIsTabletBreakpoint';

// Monitoreo de vuelos as a full-screen map with floating panels (design E.2; M1, «pantalla completa con paneles
// flotantes», which replaces the docked template B of CN-32): the maps lane's map (components/FlightMap.jsx, Región to
// Rampa with everything it draws) fills the screen, the board of flight strips floats at its left and the inspector of
// the chosen flight at its right, left of the map's control column. Both are measured into the map's insets
// (maps/ui/useStageInsets.js, FLIGHT_MONITORING_PANEL_EDGES), so the views, the controls, the key of the map and the
// camera keep to the area they leave in sight. The map renders the chosen flight's live data block inside the
// inspector (its `liveSlot`); another aircraft's is docked at the top left of that area.
// Below 1024 px the board opens in a drawer from «Ver vuelos», which floats at the top left of the map. One selection,
// the URL's (contratos 2.1, maps/core/useMapSelection.js): a strip writes `flightId=` with the leg id and keeps every
// other key, the map reads the same flight and writes `hex=` for other traffic, and a link with a leg id (or its
// turnaround) selects that flight. The station and the health of its sources live in the status bar; a failed refresh
// keeps the flights on the board under its stale notice. Without a map (the first load, another station) the screen is
// a plain grid that scrolls. The page's own toasts sit at the bottom right of the work area, apart from the frame's.

const NO_FLIGHTS = Object.freeze([]);
// From 1536 px the board and the inspector stay open side by side; below (a 1366 px laptop) the board folds to its
// pill while the inspector is open, so the map keeps room between them.
const WIDE_QUERY = '(min-width: 1536px)';
const INSPECTOR_PANEL_ID = 'fm-inspector';
const VIEW_FLIGHTS_ID = 'fm-view-flights';

/**
 * The edge of the map each floating panel of the screen takes room from (maps/ui/stageInsets.js): the board the left,
 * the inspector the right, and «Ver vuelos» (below 1024 px) the top, so the data block of an aircraft opens under it.
 */
export const FLIGHT_MONITORING_PANEL_EDGES = Object.freeze({
  [FLIGHT_BOARD_PANEL_ID]: 'left',
  [INSPECTOR_PANEL_ID]: 'right',
  [VIEW_FLIGHTS_ID]: 'top',
});

/**
 * How the screen is laid out, as pure classes so a test can read what jsdom does not lay out.
 * - Over the map (`stage`): the map fills the screen, and the panels float in it 12 px from its edges, under the cards
 *   of the map (z-20) and its control column (z-30, occ-map.css). The board is 24rem wide at the left: a strip's fixed
 *   columns take 20.9rem (occ-ui/OccFlightStrip.jsx) and its tags the rest; folded, it is a pill at the top left. The
 *   inspector is 22.5rem wide at the right, left of the control column (--occ-map-rail-reserve). Neither is ever wider
 *   than the map leaves beside the column.
 * - Without a map (`scroll`): the first load and another station, whose card says it has no live source, scroll in a
 *   grid: the board, the card and, from 1280 px, the inspector in a column of its own (below, under them).
 */
export const FLIGHT_MONITORING_LAYOUT = Object.freeze({
  stage: 'relative h-full min-h-0 overflow-hidden bg-occ-canvas',
  board: 'pointer-events-auto absolute bottom-3 left-3 top-3 z-10 w-[24rem] '
    + 'max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)] data-[folded=true]:bottom-auto data-[folded=true]:w-auto',
  inspector: 'pointer-events-auto absolute bottom-3 right-[var(--occ-map-rail-reserve)] top-3 z-10 w-[22.5rem] '
    + 'max-w-[calc(100%_-_var(--occ-map-rail-reserve)_-_12px)]',
  viewFlights: 'pointer-events-auto absolute left-3 top-3 z-10',
  scroll: 'flex h-full min-h-0 flex-col gap-3 overflow-y-auto overscroll-contain p-3',
  grid: 'grid min-h-[26rem] flex-1 gap-3 grid-cols-1 lg:grid-cols-[24rem_minmax(0,1fr)]',
  gridWithInspector: 'grid min-h-[26rem] flex-1 gap-3 grid-cols-1 lg:grid-cols-[24rem_minmax(0,1fr)] '
    + 'xl:grid-cols-[24rem_minmax(0,1fr)_22.5rem]',
  gridBoard: 'flex min-h-[26rem] min-w-0 flex-col lg:min-h-0',
  gridCard: 'flex min-h-[16rem] min-w-0 items-center justify-center rounded-md border border-occ-line bg-occ-panel p-8 '
    + 'text-center text-sm text-occ-muted',
  gridInspector: 'flex min-h-0 min-w-0 flex-col lg:col-span-2 xl:col-span-1',
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
  const wide = useMediaQuery(WIDE_QUERY);
  const [filter, setFilter] = useState('all');
  const [search, setSearch] = useState('');
  const [listOpen, setListOpen] = useState(false);
  const [followed, setFollowed] = useState(null);
  // The element of the inspector the map renders the flight's live data block into (CN-32).
  const [liveSlot, setLiveSlot] = useState(null);
  // The flight beside whose inspector the person unfolded the board below 1536 px.
  const [boardOpenFor, setBoardOpenFor] = useState(null);
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
  // The map draws only PUJ's live picture: another station has a card instead, and no panel floats.
  const hasMap = code === 'PUJ';
  const { insets, rootRef, measure } = useStageInsets({ edges: FLIGHT_MONITORING_PANEL_EDGES,
    enabled: hasMap && !isLoading });
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

  // The board and «Ver vuelos» are measured into the map's insets and kept for the focus too.
  const measureBoard = measure(FLIGHT_BOARD_PANEL_ID);
  const boardPanelRef = useCallback(element => {
    boardRef.current = element;
    measureBoard(element);
  }, [measureBoard]);

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

  // Below 1536 px the open inspector folds the board to its pill, until the person unfolds it beside this flight.
  const boardYields = selectedStrip !== null && !wide;
  const boardFold = boardYields ? {
    folded: boardOpenFor !== selectedId,
    onFoldedChange: next => setBoardOpenFor(next ? null : selectedId),
  } : {};
  const boardProps = {
    board, state, labels, filter, onFilterChange: setFilter, search, onSearchChange: setSearch, selectedId,
    onSelect: selectStrip, nowMs, timeZone,
  };
  const inspecting = selectedStrip !== null;
  const milestones = mapChoice?.flight ? inspectorMilestones(mapChoice.flight, mapChoice.flights, language) : null;
  const inspector = place => (inspecting ? (
    <FlightInspector flight={selectedFlight} strip={selectedStrip} stationId={stationId} timeZone={timeZone}
      onClose={closeInspector} liveSlotRef={setLiveSlot} milestones={milestones} {...place} />
  ) : null);
  const layout = FLIGHT_MONITORING_LAYOUT;
  const viewFlights = isTablet && !isLoading ? (
    <OccButton ref={toggleRef} onClick={() => setListOpen(true)} aria-haspopup="dialog" aria-expanded={drawerOpen}>
      {t('page.viewFlights', { count: shown.length })}
    </OccButton>
  ) : null;

  let body;
  if (isLoading) {
    body = <div className={layout.scroll}><MonitoringSkeleton label={t('page.loading')} /></div>;
  } else if (hasMap) {
    // The panels float inside the map, under its cards and its control column (FlightMap's `panels`).
    const panels = (
      <>
        {isTablet ? null : (
          <FlightBoard ref={boardPanelRef} floating {...boardProps} {...boardFold} className={layout.board} />
        )}
        {viewFlights ? (
          <div ref={measure(VIEW_FLIGHTS_ID)} data-occ-view-flights="" className={layout.viewFlights}>{viewFlights}</div>
        ) : null}
        {inspector({ ref: measure(INSPECTOR_PANEL_ID), variant: 'floating', className: layout.inspector })}
      </>
    );
    body = (
      <div ref={rootRef} data-occ-flight-stage="" className={layout.stage}>
        {/* The same props as before: every flight of the page, so a click on the map finds any of them; the inspector
            replaces the page's card (`detail`). */}
        <FlightMap flights={flights} selectedFlightId={mapSelectedId} onSelectFlight={selectFromMap} theme={theme}
          detail={null} onSelectionFlights={hearMapChoice} dataBlockSlot={inspecting ? liveSlot : null}
          insets={insets} panels={panels} />
      </div>
    );
  } else {
    body = (
      <div className={layout.scroll}>
        {viewFlights ? <div className="flex justify-end">{viewFlights}</div> : null}
        <div className={inspecting ? layout.gridWithInspector : layout.grid}>
          {isTablet ? null : <div ref={boardRef} className={layout.gridBoard}><FlightBoard {...boardProps} /></div>}
          <div role="status" className={layout.gridCard}>{t('page.noLiveSource')}</div>
          {inspecting ? <div className={layout.gridInspector}>{inspector({ className: 'h-full' })}</div> : null}
        </div>
      </div>
    );
  }

  return (
    <div data-occ-flight-monitoring={hasMap && !isLoading ? 'map' : 'grid'} className="h-full min-h-0">
      <h1 className="sr-only">{t('page.title')}</h1>
      {body}

      {isTablet ? (
        <OccDrawer open={drawerOpen} onClose={() => setListOpen(false)} title={t('list.drawer')} returnFocusRef={toggleRef}>
          <div ref={boardRef} className="flex h-full min-h-0 flex-col"><FlightBoard {...boardProps} /></div>
        </OccDrawer>
      ) : null}

      <OccToastStack toasts={toasts} onDismiss={dismissToast} placement="workArea" />
    </div>
  );
}
