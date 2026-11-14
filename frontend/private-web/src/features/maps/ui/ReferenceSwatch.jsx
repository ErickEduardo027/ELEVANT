import { REFERENCE_IMAGE_SHAPES } from '../style/referenceImages';
import { BASEMAP_COLORS } from '../style/mapTheme';

// A swatch of the map legend for the references (PR M8, ui/referenceLegend.js), drawn as style/referenceLayers.js draws
// them, on a patch of the map's sea: two range rings in --occ-line; an extended centreline with its ticks, thin in
// --occ-line-strong, or wider in --occ-text for the runway in use; an airport of the region as a hollow ring and one of
// today's flights as a filled dot; the chart symbols of the navaids (style/referenceImages.js) in --occ-muted; and the
// night, a darker half of the land past its edge.

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
