import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { legendEntries } from './legendEntries';

// The diagonal hatch of «Inhabilitada» inside the 12 px swatch square, at 45° like the map's stand-hatch image.
const HATCH_PATH = 'M4 7 L7 4 M4 10 L10 4 M4 13 L13 4 M4 16 L16 4 M7 16 L16 7 M10 16 L16 10 M13 16 L16 13';
const tokenColour = token => `var(${token})`;

// A stand drawn as the map draws it: fill, outline and dash from the vocabulary, and the clock of «Por liberar»,
// which is what tells it from «Ocupada» without colour.
function StateSwatch({ state }) {
  const { fill, outline, dash, extra } = STAND_STATES[state];
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0">
      <rect
        x="4"
        y="4"
        width="12"
        height="12"
        style={{
          fill: fill.kind === 'tint' || fill.kind === 'solid' ? tokenColour(fill.token) : 'none',
          stroke: tokenColour(outline.token),
          strokeWidth: outline.width,
          strokeDasharray: dash ? dash.join(' ') : 'none',
        }}
      />
      {fill.kind === 'hatch' && <path d={HATCH_PATH} style={{ fill: 'none', stroke: tokenColour(fill.token), strokeWidth: 1 }} />}
      {extra === 'clock' && (
        <g style={{ fill: 'none', stroke: tokenColour('--occ-text'), strokeWidth: 1.2, strokeLinecap: 'round' }}>
          <circle cx="10" cy="10" r="3.4" />
          <path d="M10 8 V10 L11.5 11" />
        </g>
      )}
    </svg>
  );
}

/**
 * The legend of a map (owner request: every map shows its legend). It lists only what is on screen: inside an OccMap
 * the stands on screen, or the `stands` given (inside `bounds` when given). It folds through its own button, whose
 * name stays «Leyenda» while `aria-expanded` tells whether it is open, and it renders nothing when there is nothing
 * to explain.
 */
export default function MapLegend({ stands, bounds = null, defaultOpen = true, className = '' }) {
  const { standsOnScreen } = useOccMap();
  const { t, language } = useTranslation(mapMessages);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { states, tags } = useMemo(() => (stands === undefined
    ? legendEntries({ stands: standsOnScreen })
    : legendEntries({ stands, bounds })), [stands, bounds, standsOnScreen]);

  if (states.length === 0 && tags.length === 0) return null;

  return (
    <div data-testid="map-legend" className={`relative ${className}`.trim()}>
      <div id={panelId} hidden={!open} className="absolute bottom-full right-0 mb-2 w-max max-w-xs rounded-md border border-occ-line bg-occ-panel-float p-3">
        <ul aria-label={t('legend.title')} className="grid gap-2 text-sm text-occ-text">
          {states.map(state => (
            <li key={state} className="flex items-center gap-2">
              <StateSwatch state={state} />
              <span>{STAND_STATES[state][language] ?? STAND_STATES[state].es}</span>
            </li>
          ))}
          {tags.map(tag => (
            <li key={tag} className="flex items-center gap-2">
              <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold text-occ-muted">
                {TAGS[tag][language] ?? TAGS[tag].es}
              </span>
              <span className="text-occ-muted">{t(`legend.${tag}`)}</span>
            </li>
          ))}
        </ul>
      </div>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        title={open ? t('legend.hide') : t('legend.show')}
        onClick={() => setOpen(value => !value)}
        className="min-h-11 rounded border border-occ-line bg-occ-panel px-3 text-sm font-semibold text-occ-text hover:bg-occ-panel-raised"
      >
        {t('legend.title')}
      </button>
    </div>
  );
}
