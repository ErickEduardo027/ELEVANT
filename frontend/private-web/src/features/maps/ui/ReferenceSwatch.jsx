import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { REFERENCE_IMAGE_SHAPES } from '../style/referenceImages';
import { mapColorsFor } from '../style/mapColors';
import { basemapColorsFor } from '../style/mapTheme';
import { useOptionalTheme } from '../../shell/useTheme';
import { SATELLITE_OPACITY } from '../../../services/satelliteService';
import { FLIGHT_CATEGORIES, FLIGHT_CATEGORY_COLORS, RADAR_SCALE_NWS, SIGMET_HAZARD_COLORS } from '../style/weatherColors';
import { BARB_IMAGE_SIZE, WEATHER_IMAGE_SHAPES, barbImageId } from '../style/weatherImages';

// A swatch of the map legend for the references (PR M8, ui/referenceLegend.js), drawn as style/referenceLayers.js draws
// them, on a patch of the map's sea: two range rings in --occ-line-strong (they read on the light sea too); an extended centreline with its ticks, thin in
// --occ-line-strong, or wider in --occ-text for the runway in use; an airport of the region as a hollow ring and one of
// today's flights as a filled dot; the chart symbols of the navaids (style/referenceImages.js) in --occ-muted; and the
// night, a darker half of the land past its edge. The weather as traffic/weatherLayers.js draws it: the wind's arrow,
// dimmed when stale, and a mark for each satellite image. The regional weather (lane M7) in the aviation colours the
// owner approved on 2026-11-26 (style/weatherColors.js): the loops, the radar's scale as flat steps, a SIGMET area, the
// dot of each flight category and a wind barb.

const tokenColour = token => `var(${token})`;
const LINE = tokenColour('--occ-line');
const STRONG = tokenColour('--occ-line-strong');
const TEXT = tokenColour('--occ-text');

// A navaid's symbol from its image's operations, in the colour the map paints it.
function NavaidSymbol({ image }) {
  return REFERENCE_IMAGE_SHAPES[image].ops.map(op => (
    <path
      key={op.fill ?? op.stroke}
      d={op.fill ?? op.stroke}
      style={op.fill === undefined
        ? { fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: op.lineWidth, strokeLinejoin: op.join ?? 'miter' }
        : { fill: tokenColour('--occ-muted') }}
    />
  ));
}

// The wind's arrow (style/mapImages.js: wind-arrow, drawn in 24 units) at the size of the swatch, turned as the map turns
// a wind from 100°, in the text colour, or dimmed when its METAR is stale (PR M8).
const [WIND_SHAFT, WIND_HEAD] = MAP_IMAGE_SHAPES['wind-arrow'].ops;
function WindArrow({ stale = false }) {
  const colour = tokenColour(stale ? '--occ-muted' : '--occ-text');
  return (
    <g data-glyph="wind" transform="rotate(280 10 10) translate(10 10) scale(0.8) translate(-12 -12)" style={{ opacity: stale ? 0.75 : 1 }}>
      <path d={WIND_SHAFT.stroke} style={{ fill: 'none', stroke: colour, strokeWidth: WIND_SHAFT.lineWidth }} />
      <path d={WIND_HEAD.fill} style={{ fill: colour }} />
    </g>
  );
}

// A wind barb of 15 kt (style/weatherImages.js), from its station's dot, turned as a wind from 300°, in the text colour.
const BARB_SCALE = 20 / BARB_IMAGE_SIZE;
function WindBarb() {
  const colour = tokenColour('--occ-text');
  return (
    <g data-glyph="barb" transform={`rotate(300 10 10) scale(${BARB_SCALE})`}>
      {WEATHER_IMAGE_SHAPES[barbImageId(15)].ops.map(op => (
        <path key={op.stroke ?? op.fill} d={op.stroke ?? op.fill}
          style={op.stroke === undefined ? { fill: colour } : { fill: 'none', stroke: colour, strokeWidth: op.lineWidth / BARB_SCALE / 2 }} />
      ))}
      <circle cx={BARB_IMAGE_SIZE / 2} cy={BARB_IMAGE_SIZE / 2} r={5} style={{ fill: 'none', stroke: colour, strokeWidth: 1.5 / BARB_SCALE / 2 }} />
    </g>
  );
}

// The cloud of the satellite marks, and a loop's circling arrow over it.
const CLOUD = 'M4 14 C2 14 2 10 5 10 C5 6 10 5 12 8 C14 6 18 8 17 11 C19 11 19 14 17 14 Z';
const LoopArrow = () => (
  <g style={{ fill: 'none', stroke: TEXT, strokeWidth: 1.2 }}>
    <path d="M13 3.5 A3 3 0 1 1 9.6 5" />
    <path d="M9 3 L9.6 5.2 L11.8 4.6" />
  </g>
);
// The radar's scale as five flat steps, from light rain to hail.
const RADAR_STEPS = [1, 4, 6, 9, 12].map(index => RADAR_SCALE_NWS[index][1]);
// The dot of a station in the colour of its flight category, edged dark as the map edges it; a hollow ring without one.
const categoryDot = category => (category === null
  ? <circle cx="10" cy="10" r="4.5" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1.5 }} />
  : <circle cx="10" cy="10" r="5" style={{ fill: FLIGHT_CATEGORY_COLORS[category], stroke: tokenColour('--occ-nav'), strokeWidth: 1 }} />);

// A centreline from the threshold on the right, out to the left, with a tick at each mile and a longer one at the fifth.
function Centreline({ colour, width }) {
  const ticks = [[14.5, 2.2], [11, 2.2], [7.5, 4.2], [4, 2.2]];
  return (
    <g style={{ fill: 'none', stroke: colour, strokeWidth: width }}>
      <path d="M18 10 H2" />
      {ticks.map(([x, half]) => <path key={x} d={`M${x} ${10 - half} V${10 + half}`} />)}
    </g>
  );
}

const DRAWINGS = Object.freeze({
  rings: (
    <g style={{ fill: 'none', stroke: STRONG, strokeWidth: 1 }}>
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="8" />
    </g>
  ),
  centrelines: <Centreline colour={STRONG} width={1} />,
  runwayInUse: <Centreline colour={TEXT} width={1.5} />,
  airports: <circle cx="10" cy="10" r="3" style={{ fill: tokenColour('--occ-nav'), stroke: tokenColour('--occ-faint'), strokeWidth: 1 }} />,
  // The dot of an airport ringed in the text colour, as the map rings the airport of a flight of today.
  counterparts: <circle cx="10" cy="10" r="5" style={{ fill: tokenColour('--occ-faint'), stroke: TEXT, strokeWidth: 2 }} />,
  vor: <NavaidSymbol image="navaid-vor-dme" />,
  ndb: <NavaidSymbol image="navaid-ndb" />,
  night: (
    <>
      <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: 'var(--occ-swatch-land)' }} />
      <path d="M11 0 C9 7 13 13 10.5 20 H18 A2 2 0 0 0 20 18 V2 A2 2 0 0 0 18 0 Z"
        style={{ fill: 'var(--occ-swatch-night)', fillOpacity: 'var(--occ-swatch-night-opacity)' }} />
      <path d="M11 0 C9 7 13 13 10.5 20" style={{ fill: 'none', stroke: LINE, strokeWidth: 1 }} />
    </>
  ),
  // The weather (PR M8): the wind's arrow; the satellite clouds, a soft white patch at the opacity the map draws them;
  // the estimated rain, a patch with its streaks. The map draws GIBS's images in greys, without the hues of their colour
  // scales (traffic/weatherLayers.js: SATELLITE_SATURATION), so these marks without hue only say what they are.
  wind: <WindArrow />,
  windStale: <WindArrow stale />,
  goes: (
    <path d="M4 14 C2 14 2 10 5 10 C5 6 10 5 12 8 C14 6 18 8 17 11 C19 11 19 14 17 14 Z"
      style={{ fill: TEXT, fillOpacity: SATELLITE_OPACITY.goes, stroke: 'none' }} />
  ),
  imerg: (
    <g style={{ opacity: SATELLITE_OPACITY.imerg }}>
      <path d="M4 11 C2 11 2 7.5 5 7.5 C5 4 10 3 12 6 C14 4 18 6 17 8.5 C19 8.5 19 11 17 11 Z" style={{ fill: TEXT }} />
      <path d="M6 13 L4.5 17 M10 13 L8.5 17 M14 13 L12.5 17" style={{ fill: 'none', stroke: TEXT, strokeWidth: 1.2, strokeLinecap: 'round' }} />
    </g>
  ),
  // The regional weather (lane M7).
  loopIr: (
    <>
      <path d={CLOUD} style={{ fill: TEXT, fillOpacity: SATELLITE_OPACITY.goes, stroke: 'none' }} />
      <LoopArrow />
    </>
  ),
  loopGeocolor: (
    <>
      <path d="M0 13 H20 V18 A2 2 0 0 1 18 20 H2 A2 2 0 0 1 0 18 Z" style={{ fill: 'var(--occ-swatch-land)' }} />
      <path d={CLOUD} style={{ fill: TEXT, fillOpacity: 0.85, stroke: 'none' }} />
      <LoopArrow />
    </>
  ),
  radar: (
    <g data-glyph="radar-scale">
      {RADAR_STEPS.map((colour, index) => <rect key={colour} x={1 + index * 3.6} y="5" width="3.6" height="10" style={{ fill: colour }} />)}
    </g>
  ),
  sigmet: (
    <path d="M3 5 L15 3 L17 14 L5 17 Z"
      style={{ fill: SIGMET_HAZARD_COLORS.TS, fillOpacity: 0.12, stroke: SIGMET_HAZARD_COLORS.TS, strokeWidth: 1.5, strokeLinejoin: 'round' }} />
  ),
  ...Object.fromEntries(FLIGHT_CATEGORIES.map(category => [`category${category}`, categoryDot(category)])),
  categoryNone: categoryDot(null),
  barb: <WindBarb />,
});

/** The swatch of a reference legend entry (ui/referenceLegend.js: `swatch`), hidden from assistive technology. */
export default function ReferenceSwatch({ kind }) {
  // The land and the sea of the theme on screen (style/mapTheme.js), as the map paints them under the reference.
  const theme = useOptionalTheme()?.theme;
  const { land, sea } = basemapColorsFor(theme);
  const { night } = mapColorsFor(theme);
  if (!Object.hasOwn(DRAWINGS, kind)) return null;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0"
      data-reference-swatch={kind} style={{ '--occ-swatch-land': land, '--occ-swatch-night': night.color,
        '--occ-swatch-night-opacity': night.opacity }}>
      {kind === 'night' ? null : <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: sea }} />}
      {DRAWINGS[kind]}
    </svg>
  );
}
