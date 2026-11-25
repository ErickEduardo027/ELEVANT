'use client';

import Link from 'next/link';
import { useTranslation } from '../../i18n/LanguageScope';
import OccGlyph from './OccGlyph';
import { occUiMessages } from './occUiMessages';
import { SIGNALS } from './statusVocabulary';

/** How a figure may ask to be looked at: not at all, with the amber triangle, or with the red octagon. */
export const OCC_STAT_TONES = Object.freeze(['neutral', 'attention', 'urgent']);

// Manrope, proportional figures (the global tabular figures of tokens.css are switched off here): a figure of the day
// is read alone, not compared down a column. Never mono, because it is not an identifier.
const FIGURE = "text-2xl font-semibold leading-8 text-occ-text [font-feature-settings:'tnum'_0]";
// The figure of a strip of figures docked along the top of the console's map (CN-32): one size down, so the strip stays
// one line low over the map.
const FIGURE_COMPACT = "text-lg font-semibold leading-6 text-occ-text [font-feature-settings:'tnum'_0]";
// A linked figure stays plain text with an underline, so the console's figures never light up.
const FIGURE_LINK = 'rounded-sm underline decoration-occ-line-strong decoration-1 underline-offset-4 '
  + 'hover:decoration-occ-accent';

/**
 * A figure of the day (design F): a `dt` with its label and a `dd` with the figure, inside an OccStatList. `hint` says
 * what the figure counts, as screen-reader text in a second `dd`.
 * - `tone` `attention` or `urgent` lights only a figure above zero, and only next to the label: its glyph, with the
 *   word «Atención» or «Urgente» for assistive technology. The figure itself never takes a hue.
 * - `loading` (or no `value` yet) shows «—», read as «Cargando»: never a zero that nobody counted.
 * - `isLowerBound` writes «≥3», read as «al menos 3», for a count the read cut short.
 * - `href` makes the figure a link to where the counted items are.
 * - `detail` says more of the figure on a line under it, on screen («1 abierta tras la salida», N30), and only once
 *   the figure is counted. `detailTone` `attention` or `urgent` puts that signal's glyph before it, with its word for
 *   assistive technology; the label and the figure keep the tile's own tone.
 * - `compact` (CN-32) draws the figure one size down, for a strip of figures along the top of a map.
 * `data-occ-stat` marks the tile, `data-tone` the tone it shows and `data-occ-stat-detail` its line. An unknown tone
 * throws.
 */
export default function OccStatTile({
  label, value, hint, tone = 'neutral', isLowerBound = false, href, loading = false, detail, detailTone = 'neutral',
  compact = false, className = '',
}) {
  const { t, language } = useTranslation(occUiMessages);
  if (!OCC_STAT_TONES.includes(tone)) throw new RangeError(`Unknown OCC stat tone: ${String(tone)}`);
  if (!OCC_STAT_TONES.includes(detailTone)) throw new RangeError(`Unknown OCC stat tone: ${String(detailTone)}`);
  const pending = loading || value === null || value === undefined;
  const lit = !pending && tone !== 'neutral' && Number(value) > 0;
  const said = !pending && detail !== undefined && detail !== null && detail !== '';
  const signalled = said && detailTone !== 'neutral';

  let figure;
  if (pending) {
    figure = <><span aria-hidden="true">—</span><span className="sr-only">{t('stat.loading')}</span></>;
  } else if (isLowerBound) {
    figure = <><span aria-hidden="true">≥{value}</span><span className="sr-only">{t('stat.lowerBound', { value })}</span></>;
  } else {
    figure = value;
  }

  return (
    <div data-occ-stat="" data-tone={lit ? tone : 'neutral'} className={`min-w-0 ${className}`}>
      <dt className="flex items-center gap-1.5 text-xs font-medium text-occ-muted">
        {lit ? <OccGlyph name={tone} /> : null}
        <span className="min-w-0">{label}</span>
        {lit ? <span className="sr-only">{`, ${SIGNALS[tone][language]}`}</span> : null}
      </dt>
      <dd className={`mt-0.5 ${compact ? FIGURE_COMPACT : FIGURE}`}>
        {href && !pending ? <Link href={href} className={FIGURE_LINK}>{figure}</Link> : figure}
      </dd>
      {said ? (
        <dd data-occ-stat-detail="" className={`mt-0.5 flex items-start gap-1 text-xs ${
          signalled ? 'text-occ-text' : 'text-occ-muted'}`}>
          {signalled ? <OccGlyph name={detailTone} /> : null}
          {signalled ? <span className="sr-only">{`${SIGNALS[detailTone][language]}: `}</span> : null}
          <span className="min-w-0">{detail}</span>
        </dd>
      ) : null}
      {hint ? <dd className="sr-only">{hint}</dd> : null}
    </div>
  );
}

/**
 * The list that holds the figures of a panel: a `dl` named by `label`. It has no layout of its own (the tiles stack):
 * the panel lays them out with `className`, for example `flex flex-wrap gap-x-6 gap-y-3`.
 */
export function OccStatList({ label, className = '', children }) {
  return <dl aria-label={label} data-occ-stats="" className={className}>{children}</dl>;
}
