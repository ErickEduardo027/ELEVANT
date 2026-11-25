'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import DemoTag from '../../occ-ui/DemoTag';
import OccBoardLegend from '../../occ-ui/OccBoardLegend';
import OccEmptyState from '../../occ-ui/OccEmptyState';
import OccFlightStrip from '../../occ-ui/OccFlightStrip';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccGlyph from '../../occ-ui/OccGlyph';
import { OccRemoteView } from '../../occ-ui/OccPanel';
import OccPlate from '../../occ-ui/OccPlate';
import OccSegmented from '../../occ-ui/OccSegmented';
import { boardLegendKeys, filterVisits, VISIT_FILTERS } from './boardModel';
import { formatConsoleDate } from './consoleFormat';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_ACTION, CONSOLE_SCROLL, CONSOLE_SECTION_TITLE } from './consoleStyles';

// «Tablero» (contratos 2.5): the console's board over the top left of the map. «Llegadas» and «Salidas» are the map
// flights as flight strips with the flights still to import under them («Por importar»), and «Escalas» the visits of the
// day (the old turnaround table), filtered by their resources. A strip selects its flight on the map; a selection made
// on the map brings its tab to the front and its strip into view. The header carries the legend of what the visible tab
// draws (contratos 2.4). The model is boardModel.js.

const TABS = Object.freeze(['arrivals', 'departures', 'turnarounds']);
const DIRECTION_TAB = Object.freeze({ Arrival: 'arrivals', Departure: 'departures' });
const NO_ITEMS = Object.freeze([]);
const NO_TO_IMPORT = Object.freeze({ arrivals: NO_ITEMS, departures: NO_ITEMS });
// What a tab of flights says without a strip of its own: none in the map's window, or none imported while «Por
// importar» lists some. Its count includes those (N25): «Llegadas 2» never sits over «No hay llegadas…».
const EMPTY_TAB = Object.freeze({
  arrivals: Object.freeze({ none: 'board.emptyArrivals', toImport: 'board.noneImportedArrivals' }),
  departures: Object.freeze({ none: 'board.emptyDepartures', toImport: 'board.noneImportedDepartures' }),
});

/** The id an item of the board is selected by: its map flight's key, else its leg or its turnaround. */
const itemId = item => item?.flightKey ?? item?.legId ?? item?.turnaroundId ?? null;

// The strips of a tab. A flight still to import has its «Importar» under its strip, so the strip keeps the full width
// of the board and its tags and status are never cut.
function StripList({ items, selectedId, onSelect, now, timeZone, locale, importLabel, onImport }) {
  return (
    <ul className="flex flex-col gap-px">
      {items.map(item => (
        <li key={item.id} data-occ-board-item={itemId(item)} className="flex flex-col">
          <OccFlightStrip flight={item} selected={itemId(item) !== null && itemId(item) === selectedId}
            onSelect={onSelect} now={now} timeZone={timeZone} locale={locale} />
          {onImport ? (
            <div className="flex justify-end px-2 pb-1">
              <button type="button" onClick={() => onImport(item)} aria-label={importLabel(item)} className={CONSOLE_ACTION}>
                {importLabel(null)}
              </button>
            </div>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

// The legend of the visible tab (boardModel.js: boardLegendKeys), in the words of the status bar's «Leyenda»: each
// signal with its glyph and its word, each tag as the board draws it with what it means.
function VisitRow({ visit, selected, onSelect, t }) {
  const arrival = visit.arrival?.flightNumber ?? null;
  const departure = visit.departure?.flightNumber ?? null;
  const missing = Array.isArray(visit.missing) ? visit.missing : null;
  const status = visit.completed ? t('status.completed')
    : (visit.arrival?.status?.label ?? visit.departure?.status?.label ?? null);
  let agents = null;
  if (missing !== null && missing.length > 0) {
    agents = missing.map(key => t(key === 'stand' ? 'board.visit.missingStand' : 'board.visit.missingAgents')).join(', ');
  } else if (Number.isInteger(visit.agentsCount) && visit.agentsCount > 0) {
    agents = visit.agentsCount === 1 ? t('board.visit.agentsOne') : t('board.visit.agents', { count: visit.agentsCount });
  }
  return (
    <button type="button" aria-pressed={selected} onClick={() => onSelect(visit)} data-occ-visit={visit.id}
      className={`grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-x-2 gap-y-1 rounded px-2 py-1.5 text-left hover:bg-occ-panel-raised ${
        selected ? 'outline outline-2 -outline-offset-2 outline-occ-accent' : ''}`}>
      <span className="flex min-w-0 flex-wrap items-center gap-1.5">
        {visit.operationCode ? <OccPlate kind="code">{visit.operationCode}</OccPlate> : null}
        {/* ADR-0041: a demo flight the superadministrator triggered is always labelled as such. */}
        {visit.demo ? <DemoTag /> : null}
      </span>
      <span className="flex items-center justify-end">
        {visit.standCode
          ? <OccPlate kind="stand">{visit.standCode}</OccPlate>
          : <span className="whitespace-nowrap text-xs text-occ-muted">{t('board.visit.noStand')}</span>}
      </span>
      <span className="col-span-2 flex min-w-0 flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-occ-muted">
        <span className="font-mono text-occ-text">
          {arrival ?? <span className="font-sans text-occ-muted">{t('board.visit.noArrival')}</span>}
          <span aria-hidden="true">{' → '}</span>
          <span className="sr-only">{` ${t('board.visit.to')} `}</span>
          {departure ?? <span className="font-sans text-occ-muted">{t('board.visit.noDeparture')}</span>}
        </span>
        {status ? <span>{status}</span> : null}
        {agents !== null ? (
          <span className={`inline-flex items-center gap-1 ${missing?.length ? 'text-occ-text' : ''}`}>
            {missing?.length ? <OccGlyph name="attention" /> : null}
            {agents}
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The board panel. `board` is buildBoard's model (or null before the first read) and `state` its remote state
 * (`{ status, onRetry }`); `selectedId` is the id of the selected flight as the board names it (a flightKey, else a leg
 * or a turnaround id); `onSelect(item)` selects a strip or a visit; `onImport()` opens «Importar vuelos» and
 * `onImportFlight(item)` the same dialog for one flight still to import (both absent while it cannot open). `nowMs` is
 * the server's time, `timeZone` and `date` the station's; `measureRef`, `layout`, `defaultFolded` and `className` place
 * it over the map or in the fallback grid.
 */
export default function BoardPanel({
  board, state, labels, selectedId = null, onSelect, onImport, onImportFlight, nowMs, timeZone, date = null,
  measureRef, layout = 'float', defaultFolded = false, className = '',
}) {
  const { t, locale } = useTranslation(consoleMessages);
  const [tab, setTab] = useState('arrivals');
  const [filter, setFilter] = useState('all');
  // The selection the board made itself, and the last selection whose tab the board followed.
  const [ownSelection, setOwnSelection] = useState(null);
  const [followed, setFollowed] = useState(null);
  const ids = useId();
  const bodyRef = useRef(null);

  const arrivals = board?.arrivals ?? NO_ITEMS;
  const departures = board?.departures ?? NO_ITEMS;
  const toImport = board?.toImport ?? NO_TO_IMPORT;
  const visits = useMemo(() => board?.visits ?? NO_ITEMS, [board]);
  const counts = {
    arrivals: arrivals.length + toImport.arrivals.length,
    departures: departures.length + toImport.departures.length,
    turnarounds: visits.length,
  };

  // A selection the map made (or a link) brings the tab of its flight to the front, also when the board answers after
  // it; one the board made itself stays where the person clicked. Adjusted while rendering: no effect, no extra pass.
  const selectedTab = selectedId === null ? null : DIRECTION_TAB[[...arrivals, ...toImport.arrivals, ...departures,
    ...toImport.departures].find(item => itemId(item) === selectedId)?.direction] ?? null;
  const selectionKey = `${selectedId ?? ''}|${selectedTab ?? ''}`;
  if (followed !== selectionKey) {
    setFollowed(selectionKey);
    if (selectedTab !== null && selectedId !== ownSelection) setTab(selectedTab);
  }
  useEffect(() => {
    if (selectedId === null) return;
    const items = [...(bodyRef.current?.querySelectorAll('[data-occ-board-item]') ?? [])];
    items.find(item => item.dataset.occBoardItem === selectedId)?.scrollIntoView?.({ block: 'nearest' });
  }, [selectedId, tab]);

  const select = item => {
    setOwnSelection(itemId(item));
    onSelect?.(item);
  };
  const selectVisit = visit => select(visit.arrival ?? visit.departure ?? { turnaroundId: visit.turnaroundId });
  const visitSelected = visit => [visit.arrival, visit.departure, { turnaroundId: visit.turnaroundId }]
    .some(item => item && itemId(item) !== null && itemId(item) === selectedId);
  const importLabel = item => (item === null ? t('board.importOne') : t('board.importFlight', { flight: item.flightNumber }));

  const tabOptions = TABS.map(id => ({ id, label: t(`board.tabs.${id}`), count: counts[id] }));
  const filterCounts = Object.fromEntries(VISIT_FILTERS.map(id => [id, filterVisits(visits, id).length]));
  const shownVisits = filterVisits(visits, filter);
  const strip = { selectedId, onSelect: select, now: nowMs, timeZone, locale };

  let panel;
  let legendKeys;
  if (tab === 'turnarounds') {
    legendKeys = boardLegendKeys({ visits: shownVisits });
    panel = (
      <>
        <div className="px-2 pt-2">
          <OccSegmented label={t('board.filterLabel')} size="sm" value={filter} onChange={setFilter}
            options={VISIT_FILTERS.map(id => ({ id, label: t(`board.filters.${id}`), count: filterCounts[id] }))} />
        </div>
        {visits.length === 0 ? <OccEmptyState title={t('board.empty')} className="p-3" /> : null}
        {visits.length > 0 && shownVisits.length === 0 ? <OccEmptyState title={t('board.emptyFilter')} className="p-3" /> : null}
        {shownVisits.length > 0 ? (
          <ul className="flex flex-col gap-px p-1">
            {shownVisits.map(visit => (
              <li key={visit.id} data-occ-board-item={itemId(visit.arrival ?? visit.departure) ?? visit.turnaroundId}>
                <VisitRow visit={visit} selected={visitSelected(visit)} onSelect={selectVisit} t={t} />
              </li>
            ))}
          </ul>
        ) : null}
      </>
    );
  } else {
    const shown = tab === 'arrivals' ? arrivals : departures;
    const pending = tab === 'arrivals' ? toImport.arrivals : toImport.departures;
    const empty = t(EMPTY_TAB[tab][pending.length > 0 ? 'toImport' : 'none'], { count: pending.length });
    legendKeys = boardLegendKeys({ strips: [...shown, ...pending] });
    panel = (
      <>
        {shown.length > 0
          ? <div className="p-1"><StripList items={shown} {...strip} /></div>
          : <OccEmptyState title={empty} className="p-3" />}
        {pending.length > 0 ? (
          <section aria-labelledby={`${ids}-import`} className="border-t border-occ-line">
            <h3 id={`${ids}-import`} className={CONSOLE_SECTION_TITLE}>{t('board.toImport')}</h3>
            <div className="px-1 pb-1">
              <StripList items={pending} {...strip} importLabel={importLabel}
                onImport={typeof onImportFlight === 'function' ? onImportFlight : undefined} />
            </div>
          </section>
        ) : null}
      </>
    );
  }

  const meta = date ? (
    <span>
      <span className="sr-only">{`${t('board.date')} `}</span>
      <time dateTime={date} className="font-mono">{formatConsoleDate(date, locale)}</time>
    </span>
  ) : null;

  // The legend of what the tab on screen draws, once the board answered: its strips are on screen only then.
  const legend = state?.status === 'success' && legendKeys.length > 0
    ? <OccBoardLegend keys={legendKeys} label={t('board.legend')} /> : null;

  return (
    <OccFloatingPanel ref={measureRef} panelId="board" title={t('panels.board')} layout={layout} meta={meta}
      defaultFolded={defaultFolded} className={className} bodyClassName="flex h-full min-h-0 flex-col" legend={legend}
      actions={typeof onImport === 'function'
        ? <button type="button" onClick={onImport} className={CONSOLE_ACTION}>{t('board.import')}</button>
        : null}>
      {/* The tabs only over a board that answered: their counts are never a zero nobody counted. */}
      {state?.status === 'success' ? (
        <div className="shrink-0 px-2 pt-2">
          <OccSegmented as="tablist" label={t('board.tabsLabel')} size="sm" value={tab} onChange={setTab}
            options={tabOptions} tabIdFor={id => `${ids}-tab-${id}`} panelIdFor={id => `${ids}-panel-${id}`} />
        </div>
      ) : null}
      <OccRemoteView {...state} labels={labels} timeZone={timeZone}
        className={`min-h-0 flex-1 ${CONSOLE_SCROLL}`}
        emptyState={<OccEmptyState title={t('board.empty')} />}>
        <div ref={bodyRef} role="tabpanel" id={`${ids}-panel-${tab}`} aria-labelledby={`${ids}-tab-${tab}`}>
          {panel}
        </div>
      </OccRemoteView>
    </OccFloatingPanel>
  );
}
