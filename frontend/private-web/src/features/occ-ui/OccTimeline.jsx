'use client';

import { useId, useRef, useState } from 'react';
import { useTranslation } from '../../i18n/LanguageScope';
import OccGlyph from './OccGlyph';
import OccPlate from './OccPlate';
import { barGeometry, hourTicks, TIMELINE_BAR_STATES, timelineBarName } from './occTimelineModel';
import { formatClock, toInstantMs } from './occTime';
import { occUiMessages } from './occUiMessages';

/** How tall the rows are: `normal`, or `compact` for a band folded into little room. 44 px on a touch screen. */
export const OCC_TIMELINE_DENSITIES = Object.freeze(['normal', 'compact']);

/**
 * How the band is laid out, as pure classes so a test can read what jsdom does not apply: a grid of two columns, the
 * stand plates and the tracks, with the hour axis on top. Bars sit in their track by `left` and `width` in percent.
 */
export const OCC_TIMELINE_LAYOUT = Object.freeze({
  root: 'relative grid grid-cols-[4.5rem_minmax(0,1fr)]',
  axis: 'relative col-start-2 h-6',
  plate: 'col-start-1 flex min-w-0 items-center border-t border-occ-line pr-2',
  track: Object.freeze({
    normal: 'relative col-start-2 h-9 border-t border-occ-line [@media(pointer:coarse)]:h-11',
    compact: 'relative col-start-2 h-6 border-t border-occ-line [@media(pointer:coarse)]:h-11',
  }),
});

/**
 * The textures that tell visits apart without a hue (design F, D21). Planned is an outline on nothing; on stand a
 * raised slab with a light outline; departed the same slab, dimmed. An estimated visit draws its outline dashed, the
 * texture of «est.»; a demo visit adds the 45° stripes of «Demo»; a conflict takes the amber outline and its triangle;
 * the selected bar the cyan casing.
 */
export const OCC_TIMELINE_TEXTURES = Object.freeze({
  states: Object.freeze({
    planned: Object.freeze({ border: 'border-occ-line-strong', surface: '' }),
    onStand: Object.freeze({ border: 'border-occ-text', surface: 'bg-occ-panel-raised' }),
    departed: Object.freeze({ border: 'border-occ-line-strong', surface: 'bg-occ-panel-raised opacity-60' }),
  }),
  solid: 'border-solid',
  estimated: 'border-dashed',
  conflict: 'border-occ-warn',
  selected: 'outline outline-2 -outline-offset-2 outline-occ-accent',
});

const NO_ROWS = Object.freeze([]);
const NO_BARS = Object.freeze([]);
const BAR = 'absolute isolate flex min-w-2 items-center gap-1 overflow-hidden rounded-sm border px-1.5 text-left font-mono '
  + 'text-xs font-medium text-occ-text hover:bg-occ-accent-soft';
const BAR_INSET = Object.freeze({ normal: 'inset-y-1', compact: 'inset-y-0.5' });

const percent = fraction => `${Math.round(fraction * 100_000) / 1_000}%`;
const middleOf = ({ geometry }) => geometry.left + geometry.width / 2;

// One border colour and one border style per bar, so no two classes of the same property meet on it.
function barClassName(bar, selected, density) {
  const drawing = OCC_TIMELINE_TEXTURES.states[bar.state];
  return [
    BAR, BAR_INSET[density], bar.conflict ? OCC_TIMELINE_TEXTURES.conflict : drawing.border, drawing.surface,
    bar.estimated ? OCC_TIMELINE_TEXTURES.estimated : OCC_TIMELINE_TEXTURES.solid,
    selected ? OCC_TIMELINE_TEXTURES.selected : '',
  ].filter(Boolean).join(' ');
}

// The bar of the next lane that has bars, upwards (`step` -1) or downwards (1), nearest in time to `from`.
function nearestBar(lanes, laneIndex, step, from) {
  const middle = middleOf(from);
  for (let index = laneIndex + step; index >= 0 && index < lanes.length; index += step) {
    const candidates = lanes[index].bars;
    if (candidates.length === 0) continue;
    return candidates.reduce((best, item) => (Math.abs(middleOf(item) - middle) < Math.abs(middleOf(best) - middle) ? item : best));
  }
  return null;
}

// Where a label sits on its line: from the line near the start, up to it near the end, centred on it elsewhere.
function tickPlacement(fraction) {
  if (fraction < 0.04) return '';
  if (fraction > 0.96) return '-translate-x-full';
  return '-translate-x-1/2';
}

// The 45° stripes of «Demo», drawn as DemoTag draws them, each bar with a pattern of its own.
function DemoStripes() {
  const patternId = `occ-band-stripes-${useId().replace(/[^a-zA-Z0-9_-]/g, '')}`;
  return (
    <svg aria-hidden="true" focusable="false" data-occ-stripes=""
      className="pointer-events-none absolute inset-0 -z-10 h-full w-full">
      <defs>
        <pattern id={patternId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <line x1="0" y1="0" x2="0" y2="6" style={{ stroke: 'var(--occ-line)', strokeWidth: 3 }} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${patternId})`} />
    </svg>
  );
}

/**
 * The stand band (design F, D21): the ramp in time, one row per stand with its plate and its visits as bars where
 * their times fall in the window, under an axis of the station's full hours and the «ahora» line.
 * - `rows` are `{ id, label, bars }`: `label` is the stand code; each bar is `{ id, arrivalFlight, departureFlight,
 *   startAt, startKind, endAt, endKind, state: 'planned' | 'onStand' | 'departed', estimated, demo,
 *   conflict: { label } | null, inOperation }`. A missing `startAt` or `endAt` leaves that end open to the window's
 *   edge; a bar outside the window is not drawn. The console's model builds the rows (filters and window included).
 * - The root is a `group` named `label`. Every bar is a toggle button named in full words (timelineBarName), with
 *   `aria-pressed` for `selectedBarId`; a click, Enter or Space calls `onSelectBar(bar, row)`. Its visible text is
 *   «AA904 → AA905». Textures tell the visits apart (OCC_TIMELINE_TEXTURES).
 * - One stop for Tab: the selected bar, else the first. ArrowLeft and ArrowRight move between the bars of a row,
 *   ArrowUp and ArrowDown to the bar nearest in time in the row above or below that has any, Home and End to the first
 *   and last bar of the row. Moving does not select.
 * - The «ahora» line is drawn at `now` with its time («ahora 14:32»), only inside the window, and never moves on its
 *   own: it follows `now`. The axis and the line are hidden from assistive technology.
 * Times are in `timeZone`, for `locale` (the language's by default). An unknown density or bar state throws.
 */
export default function OccTimeline({
  label, rows = NO_ROWS, windowStart, windowEnd, now, timeZone = 'UTC', locale, selectedBarId = null, onSelectBar,
  density = 'normal', className = '',
}) {
  const { t, locale: languageLocale } = useTranslation(occUiMessages);
  const [focusedId, setFocusedId] = useState(null);
  const barElements = useRef(new Map());
  if (!OCC_TIMELINE_DENSITIES.includes(density)) throw new RangeError(`Unknown OCC timeline density: ${String(density)}`);
  const timeLocale = locale ?? languageLocale;
  const names = { t, locale: timeLocale, timeZone };

  // Each row with the bars that fall in the window, in time order: the order of the keyboard and of a screen reader.
  const lanes = rows.map(row => ({
    row,
    bars: (row.bars ?? NO_BARS)
      .map(bar => {
        if (!TIMELINE_BAR_STATES.includes(bar.state)) throw new RangeError(`Unknown OCC timeline bar state: ${String(bar.state)}`);
        return { bar, geometry: barGeometry(bar, windowStart, windowEnd) };
      })
      .filter(item => item.geometry !== null)
      .sort((a, b) => a.geometry.left - b.geometry.left),
  }));
  const drawn = new Set(lanes.flatMap(lane => lane.bars.map(item => item.bar.id)));
  const firstId = lanes.find(lane => lane.bars.length > 0)?.bars[0].bar.id ?? null;
  // While focus is inside the band the stop follows it; once it leaves, the stop goes back to the selection.
  const tabStop = [focusedId, selectedBarId].find(id => id !== null && id !== undefined && drawn.has(id)) ?? firstId;

  const ticks = hourTicks(windowStart, windowEnd, timeZone, timeLocale);
  const start = toInstantMs(windowStart);
  const end = toInstantMs(windowEnd);
  const nowMs = toInstantMs(now);
  const nowFraction = end > start && nowMs >= start && nowMs <= end ? (nowMs - start) / (end - start) : null;
  const lastRow = lanes.length + 1;

  function onBarKeyDown(event, laneIndex, barIndex) {
    const laneBars = lanes[laneIndex].bars;
    let target;
    if (event.key === 'ArrowRight') target = laneBars[barIndex + 1];
    else if (event.key === 'ArrowLeft') target = laneBars[barIndex - 1];
    else if (event.key === 'Home') target = laneBars[0];
    else if (event.key === 'End') target = laneBars.at(-1);
    else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      target = nearestBar(lanes, laneIndex, event.key === 'ArrowDown' ? 1 : -1, laneBars[barIndex]);
    } else return;
    event.preventDefault();
    if (target) barElements.current.get(target.bar.id)?.focus();
  }

  return (
    <div role="group" aria-label={label} data-occ-timeline="" data-density={density}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocusedId(null); }}
      className={`${OCC_TIMELINE_LAYOUT.root} ${className}`}>
      {lanes.length > 0 ? (
        <div aria-hidden="true" className="pointer-events-none relative col-start-2"
          style={{ gridRow: `2 / span ${lanes.length}` }}>
          {ticks.map(tick => (
            <span key={tick.at} data-occ-hour-line="" className="absolute inset-y-0 w-px bg-occ-line"
              style={{ left: percent(tick.fraction) }} />
          ))}
        </div>
      ) : null}
      <div aria-hidden="true" data-occ-timeline-axis="" className={OCC_TIMELINE_LAYOUT.axis} style={{ gridRow: 1 }}>
        {ticks.map(tick => (
          <span key={tick.at} data-occ-hour={tick.label}
            className={`absolute top-1 font-mono text-xs text-occ-muted ${tickPlacement(tick.fraction)}`}
            style={{ left: percent(tick.fraction) }}>
            {tick.label}
          </span>
        ))}
        {nowFraction !== null ? (
          <span data-occ-now-label=""
            className={`absolute top-0.5 z-10 whitespace-nowrap rounded-sm bg-occ-text px-1 font-mono text-xs font-semibold text-occ-on-primary ${nowFraction > 0.5 ? '-translate-x-full' : ''}`}
            style={{ left: percent(nowFraction) }}>
            {t('timeline.nowAt', { time: formatClock(nowMs, timeLocale, timeZone) })}
          </span>
        ) : null}
      </div>
      {lanes.map((lane, laneIndex) => (
        <div key={lane.row.id} data-occ-timeline-row={lane.row.id} className="contents">
          <div className={OCC_TIMELINE_LAYOUT.plate} style={{ gridRow: laneIndex + 2 }}>
            <OccPlate kind="stand">{lane.row.label}</OccPlate>
          </div>
          <div data-occ-timeline-track="" className={OCC_TIMELINE_LAYOUT.track[density]} style={{ gridRow: laneIndex + 2 }}>
            {lane.bars.map(({ bar, geometry }, barIndex) => {
              const selected = bar.id === selectedBarId;
              return (
                <button key={bar.id} type="button" aria-pressed={selected} aria-label={timelineBarName(bar, lane.row, names)}
                  tabIndex={bar.id === tabStop ? 0 : -1} data-occ-bar={bar.id} data-state={bar.state}
                  data-estimated={bar.estimated ? 'true' : undefined} data-demo={bar.demo ? 'true' : undefined}
                  data-conflict={bar.conflict ? 'true' : undefined}
                  ref={element => {
                    if (element) barElements.current.set(bar.id, element);
                    else barElements.current.delete(bar.id);
                  }}
                  onClick={() => onSelectBar?.(bar, lane.row)} onFocus={() => setFocusedId(bar.id)}
                  onKeyDown={event => onBarKeyDown(event, laneIndex, barIndex)}
                  style={{ left: percent(geometry.left), width: percent(geometry.width) }}
                  className={barClassName(bar, selected, density)}>
                  {bar.demo ? <DemoStripes /> : null}
                  {bar.conflict ? <OccGlyph name="attention" /> : null}
                  <span className="min-w-0 truncate">
                    {bar.arrivalFlight}
                    {bar.arrivalFlight && bar.departureFlight ? <span aria-hidden="true">{' → '}</span> : null}
                    {bar.departureFlight}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {nowFraction !== null ? (
        <div aria-hidden="true" className="pointer-events-none relative col-start-2" style={{ gridRow: `1 / span ${lastRow}` }}>
          <span data-occ-now-line="" className="absolute inset-y-0 w-px bg-occ-text" style={{ left: percent(nowFraction) }} />
        </div>
      ) : null}
    </div>
  );
}
