'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { boardLegendKeys } from '../../dashboard/noc/boardModel';
import OccBoardLegend from '../../occ-ui/OccBoardLegend';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import { OccTextField } from '../../occ-ui/OccField';
import OccFlightStrip, { OCC_FLIGHT_STRIP_LAYOUT } from '../../occ-ui/OccFlightStrip';
import OccPanel from '../../occ-ui/OccPanel';
import OccSegmented from '../../occ-ui/OccSegmented';
import {
  DEFAULT_FLIGHT_BOARD_SORT, FLIGHT_BOARD_FILTERS, FLIGHT_BOARD_SORT_KEYS, filterBoard, nextBoardSort, sortBoard,
} from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

// «Tablero de vuelos» of Monitoreo de vuelos (design E.2, template B; CN-32): the flights of the station as flight
// strips, dense and in columns, with «Llegadas», «Salidas», «En vuelo», «En tierra» (M8) and «Todos», a search and a header whose columns sort the
// board (Hora, Vuelo, Estado, Ruta, Pos.; a second click turns the order). Each strip carries its delay chip (CN-32) next
// to «Demo» and «est.». A strip selects its flight in the one selection of the screen (contratos 2.1), which the map and
// the inspector share; a flight chosen on the map or through a link has its strip brought into view. The header names
// the marks the strips on screen carry (contratos 2.4: a board shows its legend in its header), as a list and never as
// a button «Leyenda»: the map's legend is the screen's only one. The model is flightBoardModel.js.

const NO_STRIPS = Object.freeze([]);
const SCROLL = 'overflow-y-auto overscroll-contain [scrollbar-width:thin]';

// Where each column of the header sits on the strip's grid (occ-ui/OccFlightStrip.jsx): over the time, the flight, the
// tags (the status reads on the strip's second line, under them), the other airport and the stand.
const COLUMN_PLACE = Object.freeze({
  time: 'col-start-2', flight: 'col-start-3', status: 'col-start-4', route: 'col-start-5', stand: 'col-start-6',
});
const SORT_BUTTON = 'inline-flex min-h-7 min-w-0 items-center gap-1 rounded px-0.5 text-left text-xs font-semibold '
  + 'hover:text-occ-text focus-visible:outline focus-visible:outline-2 focus-visible:outline-occ-accent '
  + '[@media(pointer:coarse)]:min-h-11';

function SortArrow({ direction }) {
  return (
    <svg viewBox="0 0 10 10" aria-hidden="true" focusable="false" className="h-2.5 w-2.5 shrink-0">
      <path d={direction === 'descending' ? 'M2 3.5 L5 6.5 L8 3.5' : 'M2 6.5 L5 3.5 L8 6.5'}
        style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.5 }} />
    </svg>
  );
}

// The header of the board's columns: one button per column, the column sorted by pressed, in cyan, with its arrow.
function SortHeader({ sort, onSort, t }) {
  return (
    <div role="group" aria-label={t('board.sort.label')}
      className={`${OCC_FLIGHT_STRIP_LAYOUT.grid} !py-0 text-occ-muted`}>
      {FLIGHT_BOARD_SORT_KEYS.map(key => {
        const active = sort.key === key;
        const column = t(`board.sort.names.${key}`);
        const name = active ? t(`board.sort.${sort.direction}`, { column }) : t('board.sort.by', { column });
        return (
          <button key={key} type="button" data-occ-sort={key} aria-pressed={active} aria-label={name} title={name}
            onClick={() => onSort(key)}
            className={`${COLUMN_PLACE[key]} ${SORT_BUTTON} ${active ? 'text-occ-accent' : ''}`}>
            <span className="min-w-0 truncate">{t(`board.sort.columns.${key}`)}</span>
            {active ? <SortArrow direction={sort.direction} /> : null}
          </button>
        );
      })}
    </div>
  );
}

function emptyTextOf(filter, search, t) {
  if (search.trim() !== '') return { title: t('empty.no-results.title'), description: t('empty.no-results.description') };
  if (filter === 'arrivals') return { title: t('empty.arrivals') };
  if (filter === 'departures') return { title: t('empty.departures') };
  if (filter === 'inFlight') return { title: t('empty.inFlight') };
  if (filter === 'onGround') return { title: t('empty.onGround') };
  return { title: t('empty.no-flights.title'), description: t('empty.no-flights.description') };
}

/**
 * The board panel. `board` is buildFlightBoard's model and `state` its remote state (`{ status, staleSince, onRetry }`,
 * the five states of OccRemoteView: the first load, the day with flights, the empty day, a failed read with «Reintentar»,
 * no permission; `staleSince` the instant of the flights kept on screen after a failed refresh); `labels` the texts of
 * those states. `filter` (FLIGHT_BOARD_FILTERS: `arrivals`, `departures`, `inFlight`, `onGround` or `all`; the page
 * dims on the map the flights it leaves out, M8) and `search` are the page's, heard through
 * `onFilterChange(id)` and `onSearchChange(text)`. The order of the columns is the board's own (sortBoard), by time at
 * first. `selectedId` is the id of the selected strip (the leg id as text) and `onSelect(strip)` hears a strip; `nowMs`
 * is the server's time and `timeZone` the station's. Each strip forwards `data-testid="flight-list-item"`.
 */
export default function FlightBoard({
  board, state, labels, filter = 'all', onFilterChange, search = '', onSearchChange, selectedId = null, onSelect, nowMs,
  timeZone, className = '',
}) {
  const { t, locale } = useTranslation(flightMonitoringMessages);
  const listRef = useRef(null);
  const [sort, setSort] = useState(DEFAULT_FLIGHT_BOARD_SORT);
  const shown = useMemo(() => (board ? sortBoard(filterBoard(board, filter, search), sort) : NO_STRIPS),
    [board, filter, search, sort]);
  const ready = state?.status === 'success';

  // A flight chosen on the map, through a link or in the board has its strip in view.
  useEffect(() => {
    if (selectedId === null) return;
    const items = [...(listRef.current?.querySelectorAll('[data-occ-board-item]') ?? [])];
    items.find(item => item.dataset.occBoardItem === selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, filter]);

  // The legend of what the strips on screen carry, once the board answered: its strips are on screen only then.
  const legendKeys = ready ? boardLegendKeys({ strips: shown }) : NO_STRIPS;
  const legend = legendKeys.length > 0 ? <OccBoardLegend keys={legendKeys} label={t('board.legend')} /> : null;
  const options = FLIGHT_BOARD_FILTERS.map(id => ({ id, label: t(`board.filters.${id}`), count: board?.counts?.[id] }));
  const empty = emptyTextOf(filter, search, t);

  return (
    <OccPanel title={t('board.title')} meta={legend} status={state?.status ?? 'loading'} staleSince={state?.staleSince}
      onRetry={state?.onRetry} labels={labels} timeZone={timeZone} locale={locale}
      emptyState={<OccEmptyState title={t('empty.no-flights.title')} description={t('empty.no-flights.description')} />}
      className={`h-full min-h-0 ${className}`} bodyClassName={SCROLL}>
      {/* The controls and the columns stay in sight while the strips scroll under them. */}
      <div className="sticky top-0 z-[1] border-b border-occ-line bg-occ-panel">
        <div className="flex flex-col gap-2 p-2">
          <OccSegmented label={t('board.direction')} size="sm" value={filter} onChange={onFilterChange} options={options} />
          <OccTextField type="search" label={t('search.label')} placeholder={t('search.placeholder')} value={search}
            autoComplete="off" onChange={event => onSearchChange?.(event.target.value)} />
        </div>
        {shown.length > 0
          ? <SortHeader sort={sort} onSort={key => setSort(current => nextBoardSort(current, key))} t={t} />
          : null}
      </div>
      {shown.length > 0 ? (
        <ul ref={listRef} className="divide-y divide-occ-line">
          {shown.map(strip => (
            // A strip brought into view stops below the controls, not under them.
            <li key={strip.id} data-occ-board-item={strip.id} className="scroll-mt-36">
              <OccFlightStrip flight={strip} selected={strip.id === selectedId} onSelect={onSelect} now={nowMs}
                timeZone={timeZone} locale={locale} data-testid="flight-list-item" />
            </li>
          ))}
        </ul>
      ) : <OccEmptyState title={empty.title} description={empty.description} className="p-3" />}
    </OccPanel>
  );
}
