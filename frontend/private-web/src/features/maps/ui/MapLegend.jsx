import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { SIGNALS, STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from '../aircraftSilhouette';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { standPaint } from '../stands/standLayers';
import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { BASEMAP_COLORS } from '../style/mapTheme';
import { legendEntries } from './legendEntries';

const tokenColour = token => `var(${token})`;
const SWATCH_PROPS = Object.freeze({
  width: 20, height: 20, viewBox: '0 0 20 20', 'aria-hidden': 'true', focusable: 'false', className: 'shrink-0',
});

// Diagonal lines x + y = c every `step` px, clipped to the square from `min` to `max`: the hatch of «Inhabilitada».
function hatchPath(min, max, step) {
  const segments = [];
  for (let sum = 2 * min + step; sum < 2 * max; sum += step) {
    const fromX = Math.max(min, sum - max);
    const toX = Math.min(max, sum - min);
    segments.push(`M${fromX} ${sum - fromX} L${toX} ${sum - toX}`);
  }
  return segments.join(' ');
}

// A stand of the swatch: a 14 px box in the middle, the map's polygon at a size the legend can hold.
const BOX = Object.freeze({ x: 3, y: 3, size: 14 });
const HATCH_PATH = hatchPath(BOX.x, BOX.x + BOX.size, 3.5);
// The aircraft of a stand with an aircraft on it, 10 px long in the middle of the box, nose up.
const AIRCRAFT_TRANSFORM = `translate(5 5) scale(${10 / AIRCRAFT_SILHOUETTE_VIEWBOX})`;

/**
 * A stand state as the map draws it (stands/standLayers.js: standPaint): the box filled with its tint or slab, or
 * hatched, its outline at the vocabulary's width and dash, the aircraft of a stand with an aircraft on it, the clock of
 * «Por liberar» on its corner and the emphasised lead-in of «Llegando». Each state differs from every other in at least
 * one of these, never in colour alone.
 */
function StateSwatch({ state }) {
  const paint = standPaint(state);
  const line = tokenColour(paint.outline.token);
  const filled = paint.fill.kind === 'tint' || paint.fill.kind === 'solid';
  return (
    <svg {...SWATCH_PROPS} data-swatch="state" data-fill={paint.fill.kind}>
      <rect
        x={BOX.x}
        y={BOX.y}
        width={BOX.size}
        height={BOX.size}
        style={{
          fill: filled ? tokenColour(paint.fill.token) : 'none',
          stroke: line,
          strokeWidth: paint.outline.width,
          strokeDasharray: paint.outline.dash ? paint.outline.dash.join(' ') : 'none',
        }}
      />
      {paint.fill.kind === 'hatch' && (
        <path data-glyph="hatch" d={HATCH_PATH} style={{ fill: 'none', stroke: tokenColour(paint.fill.token), strokeWidth: 1 }} />
      )}
      {paint.leadIn && (
        <path data-glyph="leadin" d="M10 20 V10" style={{ fill: 'none', stroke: line, strokeWidth: paint.outline.width }} />
      )}
      {paint.glyph === 'aircraft' && (
        <path data-glyph="aircraft" d={AIRCRAFT_SILHOUETTE_PATH} transform={AIRCRAFT_TRANSFORM} style={{ fill: line }} />
      )}
      {paint.clock && (
        <g data-glyph="clock" style={{ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-text'), strokeWidth: 1, strokeLinecap: 'round' }}>
          <circle cx="15.5" cy="4.5" r="3.5" />
          <path d="M15.5 2.9 V4.5 L16.7 5.2" style={{ fill: 'none' }} />
        </g>
      )}
    </svg>
  );
}

// A signal as the map draws it (style/mapImages.js): its shape filled in its colour, the «!» in the dark of the halo.
function SignalSwatch({ signal }) {
  const [shape, ...cuts] = MAP_IMAGE_SHAPES[`signal-${signal}`].ops;
  return (
    <svg {...SWATCH_PROPS} data-swatch="signal" data-shape={SIGNALS[signal].shape}>
      <path d={shape.fill} style={{ fill: tokenColour(SIGNALS[signal].colorToken), stroke: tokenColour('--occ-nav'), strokeWidth: 1 }} />
      <path data-glyph="exclamation" d={cuts.map(cut => cut.clear).join(' ')} style={{ fill: tokenColour('--occ-nav') }} />
    </svg>
  );
}

// The chip of a terminal as the map draws it: the raised slab with a 1 px joint around its text.
function ChipSwatch() {
  return (
    <svg {...SWATCH_PROPS} data-swatch="chip">
      <rect x="1.5" y="5.5" width="17" height="9" rx="2" style={{ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
      <path d="M5 10 H15" style={{ fill: 'none', stroke: tokenColour('--occ-text'), strokeWidth: 1.5 }} />
    </svg>
  );
}

// The marks of the stands: the dashed link from a cancelled stand to the one that cancels it, the dotted code-C box
// inside a larger stand limited to narrow-body aircraft, the thin ring around the stands covered by the same agent as
// the selected one (stands/standLayers.js: the same-agent casing), and while a stand is placed, its box at the pointer
// (dashed cyan) and the pending location (solid cyan over a wash, with its centre).
const ACCENT = tokenColour('--occ-accent');
const MARK_SWATCHES = Object.freeze({
  combined: (
    <>
      <rect x="1.5" y="6.5" width="6" height="7" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1.5, strokeDasharray: '2 2' }} />
      <rect x="12.5" y="6.5" width="6" height="7" style={{ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-text'), strokeWidth: 1.5 }} />
      <path d="M7.5 10 H12.5" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1.5, strokeDasharray: '2 1' }} />
    </>
  ),
  narrowbody: (
    <>
      <rect x="2.5" y="2.5" width="15" height="15" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
      <rect x="6.5" y="5.5" width="7" height="9" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1, strokeDasharray: '1 2' }} />
    </>
  ),
  sameAgent: (
    <>
      <rect x="5.5" y="5.5" width="9" height="9" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
      <rect x="2.5" y="2.5" width="15" height="15" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1 }} />
    </>
  ),
  ghost: (
    <rect x="3" y="3" width="14" height="14" style={{ fill: 'none', stroke: ACCENT, strokeWidth: 2, strokeDasharray: '4 3' }} />
  ),
  pending: (
    <>
      <rect x="3.25" y="3.25" width="13.5" height="13.5" style={{ fill: ACCENT, fillOpacity: 0.2, stroke: ACCENT, strokeWidth: 2.5 }} />
      <circle cx="10" cy="10" r="2.5" style={{ fill: ACCENT, stroke: tokenColour('--occ-nav'), strokeWidth: 1 }} />
    </>
  ),
});
const MARK_MESSAGES = Object.freeze({
  combined: 'legend.combined', narrowbody: 'legend.narrowbody', sameAgent: 'legend.sameAgent', ghost: 'legend.ghost',
  pending: 'legend.pending',
});
const MARK_HINTS = Object.freeze({ ghost: 'legend.ghostHint' });

// A flight as the map draws it (traffic/flightLayers.js): the solid silhouette, nose up, in the text colour with a 1 px
// halo of the nav colour, here 16 px long. The halo is a 2 px line drawn under the fill, so 1 px of it shows outside.
const FLIGHT_SIZE_PX = 16;
const FLIGHT_TRANSFORM = `translate(2 2) scale(${FLIGHT_SIZE_PX / AIRCRAFT_SILHOUETTE_VIEWBOX})`;
const FLIGHT_HALO_UNITS = (2 * AIRCRAFT_SILHOUETTE_VIEWBOX) / FLIGHT_SIZE_PX;

function FlightSwatch() {
  return (
    <svg {...SWATCH_PROPS}>
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

// The airfield items, each a small crop of the map (style/airfieldLayers.js): on the land colour, the pavement in the
// base-map colours and the markings in --occ-text. The map draws an apron without an outline; its swatch frames the
// patch with a hairline so its tone, barely lighter than the land, reads at this size.
const MARK = tokenColour('--occ-text');
const AIRFIELD_SWATCHES = Object.freeze({
  runway: (
    <>
      <rect x="1" y="6.5" width="18" height="7" style={{ fill: BASEMAP_COLORS.runway }} />
      <path d="M2.5 7.8 V12.2 M17.5 7.8 V12.2" style={{ fill: 'none', stroke: MARK, strokeWidth: 1 }} />
      <path d="M4.5 10 H15.5" style={{ fill: 'none', stroke: MARK, strokeWidth: 1, strokeDasharray: '2.5 2' }} />
    </>
  ),
  taxiway: (
    <path d="M2 15.5 C7.5 15.5 11 4.5 18 4.5" style={{ fill: 'none', stroke: BASEMAP_COLORS.taxiway, strokeWidth: 4, strokeLinecap: 'round' }} />
  ),
  holdBar: (
    <>
      <path d="M10 1 V19" style={{ fill: 'none', stroke: BASEMAP_COLORS.taxiway, strokeWidth: 4 }} />
      <path d="M5 10 H15" style={{ fill: 'none', stroke: MARK, strokeWidth: 2 }} />
    </>
  ),
  apron: (
    <rect x="3.5" y="4.5" width="13" height="11" style={{ fill: BASEMAP_COLORS.apron, stroke: tokenColour('--occ-line'), strokeWidth: 1 }} />
  ),
  terminal: (
    <rect x="4.5" y="5.5" width="11" height="9" style={{ fill: BASEMAP_COLORS.building, stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
  ),
});
const AIRFIELD_MESSAGES = Object.freeze({
  runway: 'legend.runway', taxiway: 'legend.taxiway', holdBar: 'legend.hold', apron: 'legend.apron', terminal: 'legend.terminal',
});

function AirfieldSwatch({ kind }) {
  return (
    <svg {...SWATCH_PROPS} data-swatch={kind}>
      <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: BASEMAP_COLORS.land }} />
      {AIRFIELD_SWATCHES[kind]}
    </svg>
  );
}

// An entry with a hint below its name, across the whole legend.
function WideEntry({ swatch, name, hint }) {
  return (
    <li className="col-span-2 flex items-center gap-2">
      {swatch}
      <span>
        <span className="block">{name}</span>
        {hint && <span className="block text-occ-muted">{hint}</span>}
      </span>
    </li>
  );
}

/**
 * The legend of a map (owner request: every map shows its legend). It lists only what is on screen: inside an OccMap
 * the flights drawn there, the terminal chips (below the stand polygons), the states of the stands whose polygon is
 * drawn there with the signals they carry and the marks drawn there (the link of a cancelled stand, the narrow-body
 * box, the ring of the stands the selected one's agent covers, the boxes of a stand being placed), «No oficial» for a
 * stand at its reference location, and the airfield items drawn there (runway, taxiway,
 * holding point, apron, terminal), set apart below the rest; or the `stands` given (inside `bounds` when given). The
 * stand states use the words of the vocabulary (STAND_STATES) and the signals theirs (SIGNALS). The short entries (the
 * states, the signals and the airfield items) sit two to a row, so the open legend stays low over the map. It folds
 * through its own button, whose name stays «Leyenda» while `aria-expanded` tells whether it is open, and it renders
 * nothing when there is nothing to explain.
 */
export default function MapLegend({ stands, bounds = null, defaultOpen = true, className = '' }) {
  const { standsOnScreen, chipsOnScreen, standMarksOnScreen, flightsOnScreen, airfieldOnScreen } = useOccMap();
  const { t, language } = useTranslation(mapMessages);
  const [open, setOpen] = useState(defaultOpen);
  const panelId = useId();
  const { flights, states, chips, signals, tags, marks, airfield } = useMemo(() => (stands === undefined
    ? legendEntries({
      stands: standsOnScreen, flights: flightsOnScreen, chips: chipsOnScreen, marks: standMarksOnScreen, airfield: airfieldOnScreen,
    })
    : legendEntries({ stands, bounds })), [stands, bounds, standsOnScreen, chipsOnScreen, standMarksOnScreen, flightsOnScreen, airfieldOnScreen]);

  const word = entry => entry[language] ?? entry.es;
  const listsOthers = flights || chips || states.length > 0 || signals.length > 0 || marks.length > 0 || tags.length > 0;
  if (!listsOthers && airfield.length === 0) return null;

  return (
    <div data-testid="map-legend" className={`relative ${className}`.trim()}>
      <div id={panelId} hidden={!open} className="absolute bottom-full right-0 mb-2 w-max max-w-xs rounded-md border border-occ-line bg-occ-panel-float p-3">
        <ul aria-label={t('legend.title')} className="grid grid-cols-2 gap-y-1.5 text-sm text-occ-text">
          {flights && <WideEntry swatch={<FlightSwatch />} name={t('legend.flight')} hint={t('legend.flightHint')} />}
          {chips && <WideEntry swatch={<ChipSwatch />} name={t('legend.chip')} hint={t('legend.chipHint')} />}
          {states.map(state => (
            <li key={state} data-state={state} className="flex items-center gap-2 pr-3">
              <StateSwatch state={state} />
              <span>{word(STAND_STATES[state])}</span>
            </li>
          ))}
          {signals.map(signal => (
            <li key={signal} data-signal={signal} className="flex items-center gap-2 pr-3">
              <SignalSwatch signal={signal} />
              <span>{word(SIGNALS[signal])}</span>
            </li>
          ))}
          {marks.map(mark => (
            <WideEntry key={mark} swatch={<svg {...SWATCH_PROPS} data-swatch={mark}>{MARK_SWATCHES[mark]}</svg>} name={t(MARK_MESSAGES[mark])}
              hint={MARK_HINTS[mark] ? t(MARK_HINTS[mark]) : null} />
          ))}
          {tags.map(tag => (
            <li key={tag} className="col-span-2 flex items-center gap-2">
              <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold text-occ-muted">
                {word(TAGS[tag])}
              </span>
              <span className="text-occ-muted">{t(`legend.${tag}`)}</span>
            </li>
          ))}
          {/* The airfield, set apart from what moves and changes on it by a rule across the legend. */}
          {airfield.length > 0 && listsOthers && (
            <li role="presentation" aria-hidden="true" data-legend-rule className="col-span-2 border-t border-occ-line" />
          )}
          {airfield.map(kind => (
            <li key={kind} className="flex items-center gap-2 pr-3">
              <AirfieldSwatch kind={kind} />
              <span>{t(AIRFIELD_MESSAGES[kind])}</span>
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
