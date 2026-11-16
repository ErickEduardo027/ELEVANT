'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { consoleMessages } from '../../dashboard/noc/consoleMessages';
import { bandWindow, buildStandTimeline, standCounts, TIMELINE_FILTERS } from '../../dashboard/noc/standTimeline';
import OccSegmented from '../../occ-ui/OccSegmented';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import OccTimeline from '../../occ-ui/OccTimeline';
import { STAND_STATE_KEYS, STAND_STATES } from '../../occ-ui/statusVocabulary';
import { ChevronDownIcon } from '../../shell/components/icons';
import { positionsMapMessages } from '../positionsMapMessages';

// The stand band of Mapa de posiciones (design E.2, template B): under the map, the ramp in time, one row per stand with
// its visits as bars and the «ahora» line (occ-ui/OccTimeline.jsx over the console's model, dashboard/noc/
// standTimeline.js, so both screens draw the same visit the same way). Folded, its header still says how many stands read
// each state, with the shape the map draws them with. A bar chooses its stand: the one selection of the URL (`stand=`).

const RANGES = Object.freeze(['4h', '8h', 'day']);
const NO_STANDS = Object.freeze([]);

/**
 * The band. `stands` are the stands as the map draws them (useStandDisplay), `flightsByTurnaround` and `aircraft` the
 * map flights and aircraft of the frame (both may be empty outside it); `nowMs` is the server's time and `timeZone` the
 * station's. `selectedCode` is the chosen stand and `onSelectStand(code)` chooses one. `open` and `onToggle()` fold it.
 */
export default function PositionsBand({
  stands = NO_STANDS, flightsByTurnaround = null, aircraft, nowMs, timeZone, selectedCode = null, onSelectStand,
  open = true, onToggle, className = '',
}) {
  const { t, language } = useTranslation(positionsMapMessages);
  const { t: tConsole } = useTranslation(consoleMessages);
  const [range, setRange] = useState('4h');
  const [filter, setFilter] = useState('withFlights');
  const bodyId = useId();
  const titleId = useId();
  const band = Number.isFinite(nowMs) ? bandWindow(range, nowMs, timeZone) : null;
  const windowStart = band?.windowStart ?? null;
  const windowEnd = band?.windowEnd ?? null;
  const timeline = useMemo(() => (windowStart === null || !open ? { rows: [] } : buildStandTimeline({
    stands, flightsByTurnaround, aircraft, nowMs, windowStart, windowEnd, filter, t: tConsole,
  })), [aircraft, filter, flightsByTurnaround, nowMs, open, stands, tConsole, windowEnd, windowStart]);
  const counts = useMemo(() => standCounts(stands), [stands]);
  // The bar of the chosen stand's visit on screen: the first bar of its row.
  const selectedBarId = selectedCode === null ? null
    : timeline.rows.find(row => row.id === selectedCode)?.bars[0]?.id ?? null;
  const states = STAND_STATE_KEYS.filter(key => counts[key] > 0);

  return (
    <section aria-labelledby={titleId} data-occ-positions-band={open ? 'open' : 'folded'}
      className={`flex min-h-0 min-w-0 flex-col rounded-md border border-occ-line bg-occ-panel ${className}`}>
      <header className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-3 py-2">
        <button type="button" onClick={() => onToggle?.()} aria-expanded={open} aria-controls={bodyId}
          className="-ml-1 inline-flex min-h-8 items-center gap-1.5 rounded px-1 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised [@media(pointer:coarse)]:min-h-11">
          <ChevronDownIcon aria-hidden="true" className={`h-4 w-4 text-occ-muted ${open ? '' : '-rotate-90'}`} />
          <span id={titleId}>{t('band.title')}</span>
        </button>
        {states.length > 0 ? (
          <ul aria-label={t('band.counts')} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-occ-muted">
            {states.map(key => (
              <li key={key} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                <OccStandSwatch state={key} />
                {STAND_STATES[key][language]}{' '}
                <span className="font-semibold tabular-nums text-occ-text">{counts[key]}</span>
              </li>
            ))}
          </ul>
        ) : null}
        {open ? (
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <OccSegmented label={t('band.rangeLabel')} size="sm" value={range} onChange={setRange}
              options={RANGES.map(id => ({ id, label: t(`band.ranges.${id}`) }))} />
            <OccSegmented label={t('band.filterLabel')} size="sm" value={filter} onChange={setFilter}
              options={TIMELINE_FILTERS.map(id => ({ id, label: t(`band.filters.${id}`) }))} />
          </div>
        ) : null}
      </header>
      <div id={bodyId} hidden={!open}
        className="max-h-[clamp(8rem,24vh,15rem)] min-h-0 overflow-y-auto overscroll-contain border-t border-occ-line px-2 pb-2 [scrollbar-width:thin]">
        {open ? (
          <>
            <OccTimeline label={t('band.label')} rows={timeline.rows} windowStart={windowStart} windowEnd={windowEnd}
              now={nowMs} timeZone={timeZone} selectedBarId={selectedBarId} density="compact"
              onSelectBar={(bar, row) => onSelectStand?.(row.id)} />
            {timeline.rows.length === 0 ? <p className="px-1 py-2 text-sm text-occ-muted">{t('band.empty')}</p> : null}
          </>
        ) : null}
      </div>
    </section>
  );
}
