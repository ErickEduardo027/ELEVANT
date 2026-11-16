'use client';

import { useEffect, useMemo, useRef } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { boardLegendKeys } from '../../dashboard/noc/boardModel';
import DemoTag from '../../occ-ui/DemoTag';
import EstimatedTag from '../../occ-ui/EstimatedTag';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import { OccTextField } from '../../occ-ui/OccField';
import OccFlightStrip from '../../occ-ui/OccFlightStrip';
import OccGlyph from '../../occ-ui/OccGlyph';
import OccPanel from '../../occ-ui/OccPanel';
import OccSegmented from '../../occ-ui/OccSegmented';
import { occUiMessages } from '../../occ-ui/occUiMessages';
import { SIGNALS } from '../../occ-ui/statusVocabulary';
import { FLIGHT_BOARD_FILTERS, filterBoard } from '../flightBoardModel';
import { flightMonitoringMessages } from '../flightMonitoringMessages';

// «Tablero de vuelos» of Monitoreo de vuelos (design E.2, template B): the flights of the station as flight strips, with
// «Llegadas», «Salidas» and «Todos» and a search over them. A strip selects its flight in the one selection of the screen
// (contratos 2.1), which the map and the inspector share; a flight chosen on the map or through a link has its strip
// brought into view. The header names the marks the strips on screen carry (contratos 2.4: a board shows its legend in
// its header), as a list and never as a button «Leyenda»: the map's legend is the screen's only one. The model is
// flightBoardModel.js.

const NO_STRIPS = Object.freeze([]);
const SCROLL = 'overflow-y-auto overscroll-contain [scrollbar-width:thin]';

// The marks of the strips on screen, in the words of the status bar's «Leyenda»: each signal with its glyph and its word,
// each tag as the strip draws it with what it means.
function BoardLegend({ keys, label, language, tUi }) {
  return (
    <ul aria-label={label} className="flex flex-wrap items-center gap-x-3 gap-y-1">
      {keys.map(key => {
        const signal = Object.hasOwn(SIGNALS, key);
        return (
          <li key={key} data-occ-legend-item={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
            {signal ? <OccGlyph name={key} /> : null}
            {key === 'demo' ? <DemoTag /> : null}
            {key === 'estimated' ? <EstimatedTag /> : null}
            <span>{signal ? SIGNALS[key][language] : tUi(`legend.tagMeaning.${key}`)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function emptyTextOf(filter, search, t) {
  if (search.trim() !== '') return { title: t('empty.no-results.title'), description: t('empty.no-results.description') };
  if (filter === 'arrivals') return { title: t('empty.arrivals') };
  if (filter === 'departures') return { title: t('empty.departures') };
  return { title: t('empty.no-flights.title'), description: t('empty.no-flights.description') };
}

/**
 * The board panel. `board` is buildFlightBoard's model and `state` its remote state (`{ status, staleSince, onRetry }`,
 * the five states of OccRemoteView: the first load, the day with flights, the empty day, a failed read with «Reintentar»,
 * no permission; `staleSince` the instant of the flights kept on screen after a failed refresh); `labels` the texts of
 * those states. `filter` (`arrivals`, `departures` or `all`) and `search` are the page's, heard through
 * `onFilterChange(id)` and `onSearchChange(text)`. `selectedId` is the id of the selected strip (the leg id as text) and
 * `onSelect(strip)` hears a strip; `nowMs` is the server's time and `timeZone` the station's. Each strip forwards
 * `data-testid="flight-list-item"`.
 */
export default function FlightBoard({
  board, state, labels, filter = 'all', onFilterChange, search = '', onSearchChange, selectedId = null, onSelect, nowMs,
  timeZone, className = '',
}) {
  const { t, language, locale } = useTranslation(flightMonitoringMessages);
  const { t: tUi } = useTranslation(occUiMessages);
  const listRef = useRef(null);
  const shown = useMemo(() => (board ? filterBoard(board, filter, search) : NO_STRIPS), [board, filter, search]);
  const ready = state?.status === 'success';

  // A flight chosen on the map, through a link or in the board has its strip in view.
  useEffect(() => {
    if (selectedId === null) return;
    const items = [...(listRef.current?.querySelectorAll('[data-occ-board-item]') ?? [])];
    items.find(item => item.dataset.occBoardItem === selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, filter]);

  // The legend of what the strips on screen carry, once the board answered: its strips are on screen only then.
  const legendKeys = ready ? boardLegendKeys({ strips: shown }) : NO_STRIPS;
  const legend = legendKeys.length > 0
    ? <BoardLegend keys={legendKeys} label={t('board.legend')} language={language} tUi={tUi} /> : null;
  const options = FLIGHT_BOARD_FILTERS.map(id => ({ id, label: t(`board.filters.${id}`), count: board?.counts?.[id] }));
  const empty = emptyTextOf(filter, search, t);

  return (
    <OccPanel title={t('board.title')} meta={legend} status={state?.status ?? 'loading'} staleSince={state?.staleSince}
      onRetry={state?.onRetry} labels={labels} timeZone={timeZone} locale={locale}
      emptyState={<OccEmptyState title={t('empty.no-flights.title')} description={t('empty.no-flights.description')} />}
      className={`h-full min-h-0 ${className}`} bodyClassName={SCROLL}>
      {/* The controls stay in sight while the strips scroll under them. */}
      <div className="sticky top-0 z-[1] flex flex-col gap-2 border-b border-occ-line bg-occ-panel p-2">
        <OccSegmented label={t('board.direction')} size="sm" value={filter} onChange={onFilterChange} options={options} />
        <OccTextField type="search" label={t('search.label')} placeholder={t('search.placeholder')} value={search}
          autoComplete="off" onChange={event => onSearchChange?.(event.target.value)} />
      </div>
      {shown.length > 0 ? (
        <ul ref={listRef} className="divide-y divide-occ-line">
          {shown.map(strip => (
            // A strip brought into view stops below the controls, not under them.
            <li key={strip.id} data-occ-board-item={strip.id} className="scroll-mt-28">
              <OccFlightStrip flight={strip} selected={strip.id === selectedId} onSelect={onSelect} now={nowMs}
                timeZone={timeZone} locale={locale} data-testid="flight-list-item" />
            </li>
          ))}
        </ul>
      ) : <OccEmptyState title={empty.title} description={empty.description} className="p-3" />}
    </OccPanel>
  );
}
