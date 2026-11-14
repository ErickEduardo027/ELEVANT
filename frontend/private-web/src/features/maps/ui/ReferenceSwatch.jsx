import { MAP_IMAGE_SHAPES } from '../style/mapImages';
import { REFERENCE_IMAGE_SHAPES } from '../style/referenceImages';
import { BASEMAP_COLORS } from '../style/mapTheme';
import { SATELLITE_OPACITY } from '../../../services/satelliteService';

// A swatch of the map legend for the references (PR M8, ui/referenceLegend.js), drawn as style/referenceLayers.js draws
// them, on a patch of the map's sea: two range rings in --occ-line; an extended centreline with its ticks, thin in
// --occ-line-strong, or wider in --occ-text for the runway in use; an airport of the region as a hollow ring and one of
// today's flights as a filled dot; the chart symbols of the navaids (style/referenceImages.js) in --occ-muted; and the
// night, a darker half of the land past its edge. The weather as traffic/weatherLayers.js draws it: the wind's arrow,
// dimmed when stale, and a mark for each satellite image.

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
    <g style={{ fill: 'none', stroke: LINE, strokeWidth: 1 }}>
      <circle cx="10" cy="10" r="4" />
      <circle cx="10" cy="10" r="8" />
    </g>
  ),
  centrelines: <Centreline colour={STRONG} width={1} />,
  runwayInUse: <Centreline colour={TEXT} width={1.5} />,
  airports: <circle cx="10" cy="10" r="3" style={{ fill: tokenColour('--occ-nav'), stroke: tokenColour('--occ-faint'), strokeWidth: 1 }} />,
  counterparts: <circle cx="10" cy="10" r="3.5" style={{ fill: TEXT, stroke: TEXT, strokeWidth: 1 }} />,
  vor: <NavaidSymbol image="navaid-vor-dme" />,
  ndb: <NavaidSymbol image="navaid-ndb" />,
  night: (
    <>
      <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: BASEMAP_COLORS.land }} />
      <path d="M11 0 C9 7 13 13 10.5 20 H18 A2 2 0 0 0 20 18 V2 A2 2 0 0 0 18 0 Z" style={{ fill: tokenColour('--occ-nav'), fillOpacity: 0.45 }} />
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
});

/** The swatch of a reference legend entry (ui/referenceLegend.js: `swatch`), hidden from assistive technology. */
export default function ReferenceSwatch({ kind }) {
  if (!Object.hasOwn(DRAWINGS, kind)) return null;
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" className="shrink-0"
      data-reference-swatch={kind}>
      {kind === 'night' ? null : <rect x="0" y="0" width="20" height="20" rx="2" style={{ fill: BASEMAP_COLORS.sea }} />}
      {DRAWINGS[kind]}
    </svg>
  );
}
