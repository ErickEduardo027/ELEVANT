import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from '../aircraftSilhouette';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { standAppearance } from '../stands/standLayers';
import { legendEntries } from './legendEntries';

// The swatch is the map's stand at half its size: the 24 px stand square of mapImages.js is the 12 px square at 4–16.
// The diagonal hatch of «Inhabilitada» at 45°, like the map's stand-hatch image.
const HATCH_PATH = 'M4 7 L7 4 M4 10 L10 4 M4 13 L13 4 M4 16 L16 4 M7 16 L16 7 M10 16 L16 10 M13 16 L16 13';
// The aircraft of a stand a visit holds, and the axis of an empty stand, where the map's glyph images put them.
const AIRCRAFT_TRANSFORM = `translate(5 5) scale(${10 / AIRCRAFT_SILHOUETTE_VIEWBOX})`;
const AXIS_PATH = 'M10 6.5 V13.5';
const tokenColour = token => `var(${token})`;

// A stand drawn as the map draws it: fill, outline and dash from the vocabulary, the glyph inside it (an aircraft
// while a visit holds the stand, the axis of an empty one) and the clock of «Por liberar» on its corner. The glyphs
// are what tell «Ocupada» from «Llegando» and «Por liberar» from «Ocupada» without colour, on the map and here.
function StateSwatch({ state }) {
  const { fill, outline, dash } = STAND_STATES[state];
  const { glyph, badge } = standAppearance(state);
  const mark = tokenColour(outline.token);
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0">
      <rect
        x="4"
        y="4"
        width="12"
        height="12"
        style={{
          fill: fill.kind === 'tint' || fill.kind === 'solid' ? tokenColour(fill.token) : 'none',
          stroke: mark,
          strokeWidth: outline.width,
          strokeDasharray: dash ? dash.join(' ') : 'none',
        }}
      />
      {fill.kind === 'hatch' && <path d={HATCH_PATH} style={{ fill: 'none', stroke: tokenColour(fill.token), strokeWidth: 1 }} />}
      {glyph?.image === 'glyph-aircraft' && (
        <path data-glyph="aircraft" d={AIRCRAFT_SILHOUETTE_PATH} transform={AIRCRAFT_TRANSFORM} style={{ fill: mark }} />
      )}
      {glyph?.image === 'glyph-axis' && (
        <path data-glyph="axis" d={AXIS_PATH} style={{ fill: 'none', stroke: mark, strokeWidth: 1 }} />
      )}
      {badge?.image === 'glyph-clock' && (
        <g data-glyph="clock" style={{ fill: tokenColour('--occ-panel-raised'), stroke: mark, strokeWidth: 1, strokeLinecap: 'round' }}>
          <circle cx="15" cy="5" r="3.5" />
          <path d="M15 3.4 V5 L16.2 5.7" style={{ fill: 'none' }} />
        </g>
      )}
    </svg>
  );
}

// A flight as the map draws it (traffic/flightLayers.js): the solid silhouette, nose up, in the text colour with a 1 px
// halo of the nav colour, here 16 px long. The halo is a 2 px line drawn under the fill, so 1 px of it shows outside.
const FLIGHT_SIZE_PX = 16;
const FLIGHT_TRANSFORM = `translate(2 2) scale(${FLIGHT_SIZE_PX / AIRCRAFT_SILHOUETTE_VIEWBOX})`;
const FLIGHT_HALO_UNITS = (2 * AIRCRAFT_SILHOUETTE_VIEWBOX) / FLIGHT_SIZE_PX;

function FlightSwatch() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0">
      <path
        data-glyph="flight"
        d={AIRCRAFT_SILHOUETTE_PATH}
        transform={FLIGHT_TRANSFORM}
        style={{
          fill: tokenColour('--occ-text'),
          stroke: tokenColour('--occ-nav'),
          strokeWidth: FLIGHT_HALO_UNITS,
          strokeLinejoin: 'round',
          paintOrder: 'stroke',
        }}
      />
    </svg>
  );
}

// A cluster of stands as the map draws it: a circle on the raised slab with a strong line.
function GroupSwatch() {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0">
      <circle cx="10" cy="10" r="7" style={{ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
    </svg>
  );
}

/**
 * The legend of a map (owner request: every map shows its legend). It lists only what is on screen: inside an OccMap
 * the flights drawn on screen, the stands drawn one by one there (also those the map draws on their own next to its
 * clusters) and, when a cluster of stands is drawn there, what a cluster is; or the `stands` given (inside `bounds`
 * when given). It folds through its own button, whose name stays
 * «Leyenda» while `aria-expanded` tells whether it is open, and it renders nothing when there is nothing to explain.
 */
export default function MapLegend({ stands, bounds = null, defaultOpen = true, className = '' }) {
  const { standsOnScreen, standsGrouped, flightsOnScreen } = useOccMap();
  const { t, language } = useTranslation(mapMessages);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { flights, states, tags, grouped } = useMemo(() => (stands === undefined
    ? legendEntries({ stands: standsOnScreen, flights: flightsOnScreen, grouped: standsGrouped })
    : legendEntries({ stands, bounds })), [stands, bounds, standsOnScreen, standsGrouped, flightsOnScreen]);

  if (!flights && states.length === 0 && tags.length === 0 && !grouped) return null;

  return (
    <div data-testid="map-legend" className={`relative ${className}`.trim()}>
      <div id={panelId} hidden={!open} className="absolute bottom-full right-0 mb-2 w-max max-w-xs rounded-md border border-occ-line bg-occ-panel-float p-3">
        <ul aria-label={t('legend.title')} className="grid gap-2 text-sm text-occ-text">
          {flights && (
            <li className="flex items-center gap-2">
              <FlightSwatch />
              <span>
                <span className="block">{t('legend.flight')}</span>
                <span className="block text-occ-muted">{t('legend.flightHint')}</span>
              </span>
            </li>
          )}
          {grouped && (
            <li className="flex items-center gap-2">
              <GroupSwatch />
              <span>
                <span className="block">{t('legend.group')}</span>
                <span className="block text-occ-muted">{t('legend.groupHint')}</span>
              </span>
            </li>
          )}
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
