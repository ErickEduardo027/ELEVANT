'use client';

import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import DemoTag from '../../occ-ui/DemoTag';
import EstimatedTag from '../../occ-ui/EstimatedTag';
import OccFloatingPanel from '../../occ-ui/OccFloatingPanel';
import OccGlyph from '../../occ-ui/OccGlyph';
import { OccRemoteView } from '../../occ-ui/OccPanel';
import OccSegmented from '../../occ-ui/OccSegmented';
import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import OccTimeline, { OCC_TIMELINE_TEXTURES } from '../../occ-ui/OccTimeline';
import { occUiMessages } from '../../occ-ui/occUiMessages';
import { SIGNALS, STAND_STATE_KEYS, STAND_STATES } from '../../occ-ui/statusVocabulary';
import { consoleMessages } from './consoleMessages';
import { CONSOLE_SCROLL } from './consoleStyles';
import { bandWindow, buildStandTimeline, standCounts, TIMELINE_FILTERS } from './standTimeline';

// «Posiciones» (contratos 2.5): the ramp in time along the bottom of the map. Folded, a pill with the figures of the day
// and how many stands read each state; open, the stand band (occ-ui/OccTimeline.jsx, standTimeline.js) with its «ahora»
// line, its windows «4 h», «8 h» and «Día», «Con vuelos» or «Todas», and its legend in the header. A bar selects its
// stand on the map.

const RANGES = Object.freeze([['4h', 'band.range4h'], ['8h', 'band.range8h'], ['day', 'band.day']]);
const SIGNAL_KEYS = Object.freeze(['attention', 'urgent']);
const NO_STANDS = Object.freeze([]);
const SWATCH = 'inline-block h-3 w-5 shrink-0 rounded-sm border';

/** The first letter of a word in upper case: the band's words are written for the middle of a sentence. */
const sentence = (word, locale) => (typeof word === 'string' && word.length > 0
  ? word.charAt(0).toLocaleUpperCase(locale) + word.slice(1) : word);

/** A bar of the band in small, drawn with the band's own classes so the legend and the bars always agree. */
function BarSwatch({ state, estimated = false }) {
  const drawing = OCC_TIMELINE_TEXTURES.states[state];
  const style = estimated ? OCC_TIMELINE_TEXTURES.estimated : OCC_TIMELINE_TEXTURES.solid;
  return <span aria-hidden="true" className={`${SWATCH} ${drawing.border} ${drawing.surface} ${style}`} />;
}

function BandLegend({ t, tUi, locale, language }) {
  const item = 'inline-flex items-center gap-1.5 whitespace-nowrap';
  return (
    <ul aria-label={t('positions.legend')} className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-occ-muted">
      {['planned', 'onStand', 'departed'].map(state => (
        <li key={state} className={item}>
          <BarSwatch state={state} />
          {sentence(tUi(`timeline.state.${state}`), locale)}
        </li>
      ))}
      <li className={item}><BarSwatch state="planned" estimated /><EstimatedTag /></li>
      <li className={item}><DemoTag /></li>
      {SIGNAL_KEYS.map(signal => (
        <li key={signal} className={item}>
          <OccGlyph name={signal} />
          {SIGNALS[signal][language]}
        </li>
      ))}
    </ul>
  );
}

function FoldedSummary({ figures, counts, t, language }) {
  const states = STAND_STATE_KEYS.filter(key => counts[key] > 0);
  const figure = id => (figures?.[id] ?? null);
  return (
    <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
      {/* Docked under the strip of figures (CN-32), the band does not say them again: `figures` is null there. */}
      {figures === null ? null : (
        <span className="inline-flex items-center gap-3">
          {['turnarounds', 'inOperation'].map(id => (
            <span key={id} className="whitespace-nowrap">
              {t(`figures.${id}`)}{' '}
              <span className="font-semibold tabular-nums text-occ-text">{figure(id) ?? '—'}</span>
            </span>
          ))}
        </span>
      )}
      {states.length > 0 ? (
        <span aria-label={t('positions.counts')} role="list" className="inline-flex flex-wrap items-center gap-x-3 gap-y-1">
          {states.map(key => (
            <span key={key} role="listitem" className="inline-flex items-center gap-1.5 whitespace-nowrap">
              <OccStandSwatch state={key} />
              {STAND_STATES[key][language]}{' '}
              <span className="font-semibold tabular-nums text-occ-text">{counts[key]}</span>
            </span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

/**
 * The positions panel. `stands` are the console's stands as the map draws them (useStandDisplay), `flightsByTurnaround`
 * and `aircraft` the map's flights and aircraft (for the bars' times and the «est.» texture); `figures` buildFigures'
 * model for the folded summary; `state` the remote state of the positions board. `selectedBarId` is the turnaround of
 * the selection and `onSelectStand(code)` selects a bar's stand. `nowMs` is the server's time and `timeZone` the
 * station's.
 */
export default function PositionsPanel({
  stands = NO_STANDS, flightsByTurnaround, aircraft, figures, state, labels, nowMs, timeZone, selectedBarId = null,
  onSelectStand, measureRef, layout = 'float', defaultFolded = true, className = '',
}) {
  const { t, language, locale } = useTranslation(consoleMessages);
  const { t: tUi } = useTranslation(occUiMessages);
  const [range, setRange] = useState('4h');
  const [filter, setFilter] = useState('withFlights');
  const bandId = useId();
  const band = Number.isFinite(nowMs) ? bandWindow(range, nowMs, timeZone) : null;
  const windowStart = band?.windowStart ?? null;
  const windowEnd = band?.windowEnd ?? null;
  const timeline = useMemo(() => (windowStart === null ? { rows: [] } : buildStandTimeline({
    stands, flightsByTurnaround, aircraft, nowMs, windowStart, windowEnd, filter, t,
  })), [aircraft, filter, flightsByTurnaround, nowMs, stands, t, windowEnd, windowStart]);
  const counts = useMemo(() => standCounts(stands), [stands]);

  const controls = (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
      <BandLegend t={t} tUi={tUi} locale={locale} language={language} />
      <OccSegmented label={t('band.rangeLabel')} size="sm" value={range} onChange={setRange}
        options={RANGES.map(([id, key]) => ({ id, label: t(key) }))} />
      <OccSegmented label={t('band.filterLabel')} size="sm" value={filter} onChange={setFilter}
        options={TIMELINE_FILTERS.map(id => ({ id, label: t(`band.${id}`) }))} />
    </div>
  );

  return (
    <OccFloatingPanel ref={measureRef} panelId="positions" title={t('panels.positions')} layout={layout}
      defaultFolded={defaultFolded} className={className} actions={controls}
      foldedSummary={<FoldedSummary figures={figures} counts={counts} t={t} language={language} />}>
      <OccRemoteView {...state} labels={labels} timeZone={timeZone}>
        <div id={bandId} className={`max-h-[clamp(9rem,26vh,16rem)] px-2 pb-2 ${CONSOLE_SCROLL}`}>
          <OccTimeline label={t('band.label')} rows={timeline.rows} windowStart={windowStart} windowEnd={windowEnd}
            now={nowMs} timeZone={timeZone} selectedBarId={selectedBarId} density="compact"
            onSelectBar={(bar, row) => onSelectStand?.(row.id, bar)} />
          {timeline.rows.length === 0
            ? <p className="px-1 py-2 text-sm text-occ-muted">{t('band.empty')}</p>
            : null}
        </div>
      </OccRemoteView>
    </OccFloatingPanel>
  );
}
