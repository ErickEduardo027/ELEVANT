import OccStandSwatch from '../../occ-ui/OccStandSwatch';
import { CATEGORY_OUTLINES, silhouettePath } from '../aircraft/silhouette';

// A swatch of the map legend for the traffic, drawn as the map draws it (traffic/trafficLayers.js): the narrow-body
// silhouette solid for an arriving ELEVANT flight and hollow for a departing one, smaller and muted for other traffic
// (smaller still on the ground), with the dashed ring of an estimated position, dimmed when stale; the trail fading
// toward its tail and the estimated one dashed. The «Demo» plate is occ-ui's texture swatch.

const tokenColour = token => `var(${token})`;
const outline = inset => silhouettePath(CATEGORY_OUTLINES.narrow, { size: 20, inset });
const PATHS = Object.freeze({ large: outline(0.75), medium: outline(2.5), small: outline(3.5), tiny: outline(5) });

function Silhouette({ path, fill = '--occ-text', hollow = false, opacity = 1 }) {
  return (
    <path
      d={path}
      style={hollow
        ? { fill: 'none', stroke: tokenColour(fill), strokeWidth: 1.1, strokeLinejoin: 'round', opacity }
        : { fill: tokenColour(fill), stroke: tokenColour('--occ-nav'), strokeWidth: 1, strokeLinejoin: 'round', paintOrder: 'stroke', opacity }}
    />
  );
}

const DRAWINGS = Object.freeze({
  aviamArrival: <Silhouette path={PATHS.large} />,
  aviamDeparture: <Silhouette path={PATHS.large} hollow />,
  other: <Silhouette path={PATHS.small} fill="--occ-faint" />,
  otherGround: <Silhouette path={PATHS.tiny} fill="--occ-faint" />,
  estimated: (
    <>
      <circle cx="10" cy="10" r="8.9" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1.2, strokeDasharray: '2.2 1.6' }} />
      <Silhouette path={PATHS.tiny} />
    </>
  ),
  stale: <Silhouette path={PATHS.medium} opacity={0.5} />,
  // Three steps of the same line, fainter toward the tail: the map fades it with a gradient.
  trail: (
    <g style={{ fill: 'none', stroke: tokenColour('--occ-text'), strokeWidth: 2, strokeLinecap: 'round' }}>
      <path d="M2 16 L7 12" style={{ opacity: 0.2 }} />
      <path d="M7 12 L12.5 8.5" style={{ opacity: 0.5 }} />
      <path d="M12.5 8.5 L18 5" style={{ opacity: 0.9 }} />
    </g>
  ),
  trailEstimated: (
    <path d="M2 16 L18 5" style={{ fill: 'none', stroke: tokenColour('--occ-muted'), strokeWidth: 1.5, strokeDasharray: '3 3' }} />
  ),
});

/**
 * The swatch of a traffic legend entry (ui/trafficLegend.js: `swatch`), hidden from assistive technology, in a box as
 * wide as the plate's so the words of every traffic entry start in one column.
 */
export default function TrafficSwatch({ kind }) {
  if (kind !== 'demo' && !DRAWINGS[kind]) return null;
  return (
    <span className="flex w-6 shrink-0 justify-center">
      {kind === 'demo' ? <OccStandSwatch tag="demo" /> : (
        <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true" focusable="false" data-traffic-swatch={kind}>
          {DRAWINGS[kind]}
        </svg>
      )}
    </span>
  );
}
