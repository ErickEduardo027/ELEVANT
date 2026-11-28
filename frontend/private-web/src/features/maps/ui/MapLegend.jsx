import { useId, useMemo, useState } from 'react';
import { useTranslation } from '../../../i18n/LanguageScope';
import { SIGNALS, STAND_STATES, TAGS } from '../../occ-ui/statusVocabulary';
import { AIRCRAFT_SILHOUETTE_PATH, AIRCRAFT_SILHOUETTE_VIEWBOX } from '../aircraftSilhouette';
import { useOccMap } from '../core/OccMapContext';
import { mapMessages } from '../mapMessages';
import { FOOTPRINT_PAINT, PROGRESS_PAINT, standFill, standPaint } from '../stands/standLayers';
import { MILESTONES_TOTAL } from '../stands/standModel';
import { mapColorsFor } from '../style/mapColors';
import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { AIRPORT_KINDS } from '../style/referenceLayers';
import { basemapColorsFor } from '../style/mapTheme';
import { useOptionalTheme } from '../../shell/useTheme';
import { legendEntries } from './legendEntries';
import { RAIL_FLYOUT, RAIL_KEY, railToolClass } from './railClasses';
import { referenceLegendEntries } from './referenceLegend';
import ReferenceSwatch from './ReferenceSwatch';
import { trafficLegendEntries } from './trafficLegend';
import TrafficSwatch from './TrafficSwatch';

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
  // Its own colour (owner request of 2026-11-15), as the map fills it.
  const fill = standFill(state, useOptionalTheme()?.theme);
  return (
    <svg {...SWATCH_PROPS} data-swatch="state" data-fill={paint.fill.kind}>
      <rect
        x={BOX.x}
        y={BOX.y}
        width={BOX.size}
        height={BOX.size}
        style={{
          fill: fill.color,
          fillOpacity: fill.opacity,
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

// A signal as the map draws it (style/mapImages.js): its shape filled in its colour, the «!» in the dark of the halo; a
// plain notice (PR M6) is its diamond's outline alone, in the text colour, without a hue.
function SignalSwatch({ signal }) {
  const [shape, ...cuts] = MAP_IMAGE_SHAPES[`signal-${signal}`].ops;
  if (SIGNALS[signal].colorToken === null) {
    return (
      <svg {...SWATCH_PROPS} data-swatch="signal" data-shape={SIGNALS[signal].shape}>
        <path d={shape.stroke} style={{ fill: 'none', stroke: tokenColour('--occ-text'), strokeWidth: shape.lineWidth, strokeLinejoin: 'miter' }} />
      </svg>
    );
  }
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

// The marks of the stands: the arrow over the chip of a terminal with a flight arriving at one of its stands, pointing
// down at it as the map draws it (style/mapImages.js: glyph-arriving, in --occ-text), the dashed link from a cancelled
// stand to the one that cancels it, the dotted code-C box inside a larger stand limited to narrow-body aircraft, the
// thin ring around the stands covered by the same agent as the selected one or the one under the pointer
// (stands/standLayers.js: the same-agent casing, one ring drawn the same way for both; the entry says which stand it
// follows), and while a stand is placed, its box at the pointer (dashed cyan) and the pending location (solid cyan over
// a wash, with its centre).
const ACCENT = tokenColour('--occ-accent');
const [ARRIVING_SHAFT, ARRIVING_HEAD] = MAP_IMAGE_SHAPES['glyph-arriving'].ops;
// The aircraft of a stand to scale (PR M6, stands/standLayers.js: FOOTPRINT_PAINT), 14 px long on the slab of a stand
// with an aircraft on it, or dashed on a stand still waiting for it; and the progress bar of its turnaround
// (PROGRESS_PAINT) along the rear edge, a third of it done.
const FOOTPRINT_SCALE = 14 / AIRCRAFT_SILHOUETTE_VIEWBOX;
const FOOTPRINT_TRANSFORM = `translate(3 3) scale(${FOOTPRINT_SCALE})`;
const units = pixels => pixels / FOOTPRINT_SCALE;
const SLAB = Object.freeze({ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-text'), strokeWidth: 1 });
const SAME_AGENT_RING = (
  <>
    <rect x="5.5" y="5.5" width="9" height="9" style={{ fill: 'none', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
    <rect x="2.5" y="2.5" width="15" height="15" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1 }} />
  </>
);
const MARK_SWATCHES = Object.freeze({
  chipArriving: (
    <>
      <g data-glyph="arriving" transform="translate(2 -3.5)">
        <path d={ARRIVING_SHAFT.stroke} style={{ fill: 'none', stroke: tokenColour('--occ-text'), strokeWidth: ARRIVING_SHAFT.lineWidth }} />
        <path d={ARRIVING_HEAD.fill} style={{ fill: tokenColour('--occ-text') }} />
      </g>
      <rect x="2.5" y="13.5" width="15" height="5" rx="2" style={{ fill: tokenColour('--occ-panel-raised'), stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
    </>
  ),
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
  sameAgent: SAME_AGENT_RING,
  sameAgentHover: SAME_AGENT_RING,
  footprint: (
    <>
      <rect x="1.5" y="1.5" width="17" height="17" style={SLAB} />
      <path data-glyph="footprint" d={AIRCRAFT_SILHOUETTE_PATH} transform={FOOTPRINT_TRANSFORM} style={{
        fill: tokenColour(`--occ-${FOOTPRINT_PAINT.solid.fillToken}`), fillOpacity: FOOTPRINT_PAINT.solid.fillOpacity,
        stroke: tokenColour(`--occ-${FOOTPRINT_PAINT.solid.outlineToken}`), strokeWidth: units(FOOTPRINT_PAINT.solid.width),
      }} />
    </>
  ),
  footprintPlanned: (
    <>
      <rect x="1.5" y="1.5" width="17" height="17" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1.5, strokeDasharray: '4 3' }} />
      <path data-glyph="footprint-planned" d={AIRCRAFT_SILHOUETTE_PATH} transform={FOOTPRINT_TRANSFORM} style={{
        fill: 'none', stroke: tokenColour(`--occ-${FOOTPRINT_PAINT.planned.token}`), strokeWidth: units(FOOTPRINT_PAINT.planned.width),
        strokeDasharray: FOOTPRINT_PAINT.planned.dash.map(units).join(' '),
      }} />
    </>
  ),
  progress: (
    <>
      <rect x="1.5" y="1.5" width="17" height="17" style={SLAB} />
      <path data-glyph="progress-track" d="M4 5 H16" style={{ fill: 'none', stroke: tokenColour(`--occ-${PROGRESS_PAINT.trackToken}`), strokeWidth: PROGRESS_PAINT.width }} />
      <path data-glyph="progress-done" d="M4 5 H8" style={{ fill: 'none', stroke: tokenColour(`--occ-${PROGRESS_PAINT.doneToken}`), strokeWidth: PROGRESS_PAINT.width }} />
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
  chipArriving: 'legend.chipArriving', footprint: 'legend.footprint', footprintPlanned: 'legend.footprintPlanned',
  progress: 'legend.progress', combined: 'legend.combined', narrowbody: 'legend.narrowbody', sameAgent: 'legend.sameAgent',
  sameAgentHover: 'legend.sameAgentHover', ghost: 'legend.ghost', pending: 'legend.pending',
});
// The hint under a mark's name, with what it is filled with.
const MARK_HINTS = Object.freeze({
  ghost: ['legend.ghostHint'],
  footprintPlanned: ['legend.footprintPlannedHint'],
  progress: ['legend.progressHint', { total: MILESTONES_TOTAL }],
});

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
      <rect x="1" y="6.5" width="18" height="7" style={{ fill: 'var(--occ-swatch-runway)' }} />
      <path d="M2.5 7.8 V12.2 M17.5 7.8 V12.2" style={{ fill: 'none', stroke: MARK, strokeWidth: 1 }} />
      <path d="M4.5 10 H15.5" style={{ fill: 'none', stroke: MARK, strokeWidth: 1, strokeDasharray: '2.5 2' }} />
    </>
  ),
  taxiway: (
    <path d="M2 15.5 C7.5 15.5 11 4.5 18 4.5" style={{ fill: 'none', stroke: 'var(--occ-swatch-taxiway)', strokeWidth: 4, strokeLinecap: 'round' }} />
  ),
  holdBar: (
    <>
      <path d="M10 1 V19" style={{ fill: 'none', stroke: 'var(--occ-swatch-taxiway)', strokeWidth: 4 }} />
      <path d="M5 10 H15" style={{ fill: 'none', stroke: MARK, strokeWidth: 2 }} />
    </>
  ),
  apron: (
    <rect x="3.5" y="4.5" width="13" height="11" style={{ fill: 'var(--occ-swatch-apron)', stroke: tokenColour('--occ-line'), strokeWidth: 1 }} />
  ),
  terminal: (
    <rect x="4.5" y="5.5" width="11" height="9" style={{ fill: 'var(--occ-swatch-building)', stroke: tokenColour('--occ-line-strong'), strokeWidth: 1 }} />
  ),
});
const AIRFIELD_MESSAGES = Object.freeze({
  runway: 'legend.runway', taxiway: 'legend.taxiway', holdBar: 'legend.hold', apron: 'legend.apron', terminal: 'legend.terminal',
});

// The base-map colours of the shell theme (light or dark) reach the swatches as variables of the svg.
const SWATCH_KEYS = Object.freeze(['runway', 'taxiway', 'apron', 'building']);

function AirfieldSwatch({ kind }) {
  const colours = basemapColorsFor(useOptionalTheme()?.theme);
  const variables = Object.fromEntries(SWATCH_KEYS.map(key => [`--occ-swatch-${key}`, colours[key]]));
  return (
    <svg {...SWATCH_PROPS} data-swatch={kind} style={variables}>
      <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: colours.land }} />
      {AIRFIELD_SWATCHES[kind]}
    </svg>
  );
}

// The region's airports (style/referenceLayers.js) while the map shows them: from the Región and Aproximación views,
// with «Aeropuertos de la región» on. Each kind its dot as the map draws it, the home airport larger.
const AIRPORT_VIEWS = new Set(['region', 'approach']);
function airportsShown({ layers, activeView }) {
  return AIRPORT_VIEWS.has(activeView) && layers?.keys?.includes('reference.airports') === true
    && layers?.values?.['reference.airports'] === true;
}
// The routes from Punta Cana (style/routeLayers.js) while the map shows them: in the Región view with the layer on.
function routesShown({ layers, activeView }) {
  return activeView === 'region' && layers?.keys?.includes('reference.routes') === true
    && layers?.values?.['reference.routes'] === true;
}
function RouteSwatch() {
  const { routes: colours } = mapColorsFor(useOptionalTheme()?.theme);
  return (
    <svg {...SWATCH_PROPS} data-swatch="route-reference">
      <path d="M2 15 Q10 3 18 9" style={{ fill: 'none', stroke: colours.line, strokeWidth: 1.2, strokeLinecap: 'round' }} />
      <path d="M2 18 Q10 8 18 14" style={{ fill: 'none', stroke: colours.line, strokeWidth: 3, strokeLinecap: 'round' }} />
    </svg>
  );
}
function AirportSwatch({ kind }) {
  const { airports: colours } = mapColorsFor(useOptionalTheme()?.theme);
  return (
    <svg {...SWATCH_PROPS} data-swatch="airport" data-airport={kind}>
      <circle cx="10" cy="10" r={kind === 'home' ? 6.5 : 4.5} style={{ fill: colours[kind], stroke: colours.halo, strokeWidth: 1.5 }} />
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
 * drawn there with the signal the map draws on each (attention, urgent, or the plain notice of PR M6) and the marks
 * drawn there (the arrow over a chip whose terminal has a flight arriving, the aircraft of a stand to scale on it or
 * still to come and the progress bar of its turnaround (PR M6), the link of a cancelled stand, the narrow-body box, the
 * ring of the stands covered by the agent of the selected stand or of the one under the pointer, the boxes of a stand
 * being placed), «No oficial» for a stand at its reference location, and the airfield items drawn there (runway,
 * taxiway, holding point, apron, terminal), set
 * apart below the rest; or the `stands` given (inside `bounds` when given). The stand states use the words of the
 * vocabulary (STAND_STATES) and the signals theirs (SIGNALS). The short entries (the states, the signals and the
 * airfield items) sit two to a row, so the open legend stays low over the map. It folds through its own button, whose
 * name stays «Leyenda» while `aria-expanded` tells whether it is open, and it renders nothing when there is nothing to
 * explain.
 * The traffic an OccMap draws on screen comes first (ui/trafficLegend.js): the kinds of aircraft, their tags (Demo,
 * est., Sin actualizar) and their trails. The references it draws there (PR M8, ui/referenceLegend.js: rings,
 * centrelines and the runway in use, the region's airports, the navaids and the night) go with the airfield, below the
 * rule and before it: what frames the map, apart from what moves and changes on it. The weather drawn there follows them
 * (the wind with «No oficial», plus «Sin actualizar» when stale, and each satellite image with the time of its image).
 */
/**
 * The legend of an OccMap. `defaultOpen` is how it starts; `foldKey` (U5), when it changes after the first render,
 * folds it, so a stand a screen brings to the centre (a row of its list) is not left under the open legend. In the
 * map's control rail (CN-32) it is the last control, and its panel flies out to the left of the rail, capped at the
 * height of the column and scrolling past it (occ-map.css: .occ-map-flyout); the layers menu opens in the same place,
 * so opening one closes the other. While the map follows an aircraft (follow mode) an open legend steps aside, so it
 * never covers what the camera tracks, and comes back when following ends; its button opens it meanwhile.
 */
export default function MapLegend({ stands, bounds = null, defaultOpen = true, foldKey = null, className = '' }) {
  const {
    standsOnScreen, chipsOnScreen, standMarksOnScreen, flightsOnScreen, airfieldOnScreen, trafficOnScreen, layers,
    activeView, referencesOnScreen, layersMenuOpen = false, setLayersMenuOpen, follow, view3d,
  } = useOccMap();
  const { t, language } = useTranslation(mapMessages);
  const [open, setOpen] = useState(defaultOpen);
  // A new fold key folds the legend (adjusted while rendering, no effect); the first one is the starting state's.
  const [heardFoldKey, setHeardFoldKey] = useState(foldKey);
  if (foldKey !== heardFoldKey) {
    setHeardFoldKey(foldKey);
    if (open) setOpen(false);
  }
  // The layers menu opens where the legend does: its opening folds the legend (adjusted while rendering, no effect).
  const [heardLayersOpen, setHeardLayersOpen] = useState(layersMenuOpen);
  if (layersMenuOpen !== heardLayersOpen) {
    setHeardLayersOpen(layersMenuOpen);
    if (layersMenuOpen && open) setOpen(false);
  }
  // Follow mode (CN-32): the open legend steps aside while the map follows an aircraft and comes back when it stops
  // (adjusted while rendering, no effect). `shown` is what the button and the panel say.
  const following = follow?.following === true;
  const [heardFollowing, setHeardFollowing] = useState(following);
  const [asideForFollow, setAsideForFollow] = useState(following);
  if (following !== heardFollowing) {
    setHeardFollowing(following);
    setAsideForFollow(following);
  }
  const shownOpen = open && !asideForFollow;
  const panelId = useId();
  const { flights, states, chips, signals, tags, marks, airfield } = useMemo(() => (stands === undefined
    ? legendEntries({
      stands: standsOnScreen, flights: flightsOnScreen, chips: chipsOnScreen, marks: standMarksOnScreen, airfield: airfieldOnScreen,
    })
    : legendEntries({ stands, bounds })), [stands, bounds, standsOnScreen, chipsOnScreen, standMarksOnScreen, flightsOnScreen, airfieldOnScreen]);
  // The traffic on screen (PR M5): the aircraft kinds, their tags and their trails.
  // In 3D (PR M5) its kinds say whether their 3D aircraft wear a livery.
  const models3d = view3d?.on === true;
  const traffic = useMemo(() => trafficLegendEntries(trafficOnScreen, { language, models3d }),
    [trafficOnScreen, language, models3d]);
  // The references on screen (PR M8).
  const references = useMemo(() => referenceLegendEntries(referencesOnScreen ?? {}, { language }),
    [referencesOnScreen, language]);

  const word = entry => entry[language] ?? entry.es;
  const airports = stands === undefined && airportsShown({ layers, activeView }) ? AIRPORT_KINDS : [];
  const routes = stands === undefined && routesShown({ layers, activeView });
  const listsOthers = traffic.length > 0 || flights || chips || states.length > 0 || signals.length > 0
    || marks.length > 0 || tags.length > 0 || airports.length > 0 || routes;
  const framesMap = references.length > 0 || airfield.length > 0;
  const shown = listsOthers || framesMap;
  if (!shown) return null;
  const toggle = () => {
    if (shownOpen) {
      setOpen(false);
      return;
    }
    setLayersMenuOpen?.(false);
    setAsideForFollow(false);
    setOpen(true);
  };

  return (
    // No position of its own: the panel is placed against the rail (occ-map.css), as the layers menu's.
    <div data-testid="map-legend" className={className || undefined}>
      <div id={panelId} hidden={!shownOpen} className={`${RAIL_FLYOUT} w-max max-w-xs overflow-y-auto`}>
        <ul aria-label={t('legend.title')} className="grid grid-cols-2 gap-y-1.5 text-sm text-occ-text">
          {traffic.map(entry => (
            <li key={entry.key} data-legend-traffic={entry.key}
              className={`${entry.span === 2 ? 'col-span-2 ' : ''}flex items-center gap-2 pr-3`}>
              <TrafficSwatch kind={entry.swatch} />
              <span>
                {entry.label}
                {entry.hint !== null && <span className="ml-1.5 text-occ-muted">{entry.hint}</span>}
              </span>
            </li>
          ))}
          {airports.map(kind => (
            <li key={kind} data-legend-airport={kind} className="col-span-2 flex items-center gap-2 pr-3">
              <AirportSwatch kind={kind} />
              <span>{t(`airports.${kind}`)}</span>
            </li>
          ))}
          {routes && <WideEntry swatch={<RouteSwatch />} name={t('routes.name')} hint={t('routes.hint')} />}
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
              hint={MARK_HINTS[mark] ? t(...MARK_HINTS[mark]) : null} />
          ))}
          {tags.map(tag => (
            <li key={tag} className="col-span-2 flex items-center gap-2">
              <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold text-occ-muted">
                {word(TAGS[tag])}
              </span>
              <span className="text-occ-muted">{t(`legend.${tag}`)}</span>
            </li>
          ))}
          {/* The references and the airfield, set apart from what moves and changes on them by a rule across the legend. */}
          {framesMap && listsOthers && (
            <li role="presentation" aria-hidden="true" data-legend-rule className="col-span-2 border-t border-occ-line" />
          )}
          {references.map(entry => (
            <li key={entry.key} data-legend-reference={entry.key} className="col-span-2 flex items-center gap-2">
              <ReferenceSwatch kind={entry.swatch} />
              {/* The weather (PR M8): the time of a satellite image, or «Sin actualizar» of a stale wind, below its name,
                  and its tag of the vocabulary as a plate after it. */}
              {entry.hint ? (
                <span>
                  <span className="block">{entry.label}</span>
                  <span className="block text-occ-muted">{entry.hint}</span>
                </span>
              ) : <span>{entry.label}</span>}
              {entry.tag && (
                <span className="shrink-0 rounded-sm border border-occ-line-strong px-1 text-xs font-semibold text-occ-muted">
                  {entry.tag}
                </span>
              )}
            </li>
          ))}
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
        aria-expanded={shownOpen}
        aria-controls={panelId}
        title={shownOpen ? t('legend.hide') : t('legend.show')}
        onClick={toggle}
        className={railToolClass(shownOpen)}
      >
        <span aria-hidden="true" className={RAIL_KEY}>
          <svg viewBox="0 0 10 10" focusable="false" className="h-2.5 w-2.5">
            <path d="M1 2 H9 M1 5 H9 M1 8 H9" style={{ fill: 'none', stroke: 'currentColor', strokeWidth: 1.4 }} />
          </svg>
        </span>
        {t('legend.title')}
      </button>
    </div>
  );
}
