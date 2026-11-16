// The boxes of an airport layout (PR M3), kept apart from airportLayout.js, which imports the dataset itself: the camera
// presets (core/cameraPresets.js) receive the layout as a parameter and import only these, so core/mapSelection.js and
// the services that import it never bundle the dataset. Pure. Bounds are `[[west, south], [east, north]]`, as MapLibre
// takes them.

const isFiniteNumber = value => typeof value === 'number' && Number.isFinite(value);

/** The stands of a layout that are not retired. */
export function activeStands(layout) {
  return (layout?.stands ?? []).filter(stand => stand?.retired !== true);
}

/** The layout box (`meta.bbox`, `[west, south, east, north]`) as bounds, or `null` when the layout has none. */
export function layoutBounds(layout) {
  const bbox = layout?.meta?.bbox;
  if (!Array.isArray(bbox) || bbox.length !== 4 || !bbox.every(isFiniteNumber)) return null;
  const [west, south, east, north] = bbox;
  return [[west, south], [east, north]];
}

/** The bounds of the active stand polygons (of one terminal when given), or `null` when there is none. */
export function standPolygonBounds(layout, { terminal } = {}) {
  const points = activeStands(layout)
    .filter(stand => terminal == null || stand.terminal === terminal)
    .flatMap(stand => stand.polygon ?? [])
    .filter(point => Array.isArray(point) && isFiniteNumber(point[0]) && isFiniteNumber(point[1]));
  if (points.length === 0) return null;
  const lngs = points.map(([lng]) => lng);
  const lats = points.map(([, lat]) => lat);
  return [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]];
}
