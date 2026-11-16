// The images of the reference overlays (PR M8, style/referenceLayers.js), drawn on demand by style/mapImages.js like
// every other icon: the chart symbols of the two navaids of Punta Cana, PNA (VOR-DME) and PCA (NDB). Both are SDF
// images, painted in the colour of their layer with a dark halo; their shapes differ (a hexagon inside the square of a
// DME, a ring of dots), so neither reads by its colour alone. Sizes are CSS pixels and every shape keeps 3 px clear of
// the image border, as mapImages.js asks of its icons. Pure data: ui/ReferenceSwatch.jsx draws the legend from it.

const round = value => Math.round(value * 100) / 100;

/** A filled dot of radius `r` around (x, y), as path data. */
function dot(x, y, r) {
  return `M${round(x + r)} ${round(y)} A${r} ${r} 0 1 1 ${round(x - r)} ${round(y)} A${r} ${r} 0 1 1 ${round(x + r)} ${round(y)} Z`;
}

/** A regular hexagon of radius `radius` around (cx, cy), flat at its top and bottom, as path data. */
function hexagon(cx, cy, radius) {
  const points = Array.from({ length: 6 }, (_, index) => {
    const angle = (60 * index * Math.PI) / 180;
    return [round(cx + radius * Math.cos(angle)), round(cy + radius * Math.sin(angle))];
  });
  return `M${points.map(([x, y]) => `${x} ${y}`).join(' L')} Z`;
}

const CENTRE = 10;
// The dots of the NDB: ten around a ring 5.6 px out, and one in the middle.
const NDB_RING_DOTS = 10;
const NDB_RING_RADIUS = 5.6;
const NDB_DOT_RADIUS = 0.9;
const ndbRing = Array.from({ length: NDB_RING_DOTS }, (_, index) => {
  const angle = ((360 / NDB_RING_DOTS) * index * Math.PI) / 180;
  return dot(CENTRE + NDB_RING_RADIUS * Math.sin(angle), CENTRE - NDB_RING_RADIUS * Math.cos(angle), NDB_DOT_RADIUS);
}).join(' ');

/** The image of each type of navaid the map draws (`VOR-DME` and `NDB`, as region.context.json names them). */
export const NAVAID_IMAGES = Object.freeze({ 'VOR-DME': 'navaid-vor-dme', NDB: 'navaid-ndb' });

/**
 * What each image draws (the shape format of style/mapImages.js: `width` × `height` CSS px and fill or stroke
 * operations): the VOR-DME as a hexagon inside a square with a dot in the middle, the NDB as a dot inside a ring of dots.
 */
export const REFERENCE_IMAGE_SHAPES = Object.freeze({
  'navaid-vor-dme': Object.freeze({
    width: 20,
    height: 20,
    ops: Object.freeze([
      Object.freeze({ stroke: 'M3.75 3.75 H16.25 V16.25 H3.75 Z', lineWidth: 1.5 }),
      Object.freeze({ stroke: hexagon(CENTRE, CENTRE, 4.5), lineWidth: 1.2, join: 'round' }),
      Object.freeze({ fill: dot(CENTRE, CENTRE, 1.2) }),
    ]),
  }),
  'navaid-ndb': Object.freeze({
    width: 20,
    height: 20,
    ops: Object.freeze([
      Object.freeze({ fill: ndbRing }),
      Object.freeze({ fill: dot(CENTRE, CENTRE, 1.6) }),
    ]),
  }),
});
