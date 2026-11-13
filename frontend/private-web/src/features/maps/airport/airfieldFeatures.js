import { destinationPoint, initialBearing, pointToPolylineM, roundCoord } from './geo';

// The airfield of an airport layout (PR M3) as one GeoJSON FeatureCollection, the data of the airfield overlay
// (style/airfieldLayers.js): the map draws the pavement, the runway markings and the holding points of MDPC from its own
// dataset, so the stands, the taxi graph and the pavement always agree. Pure: it reads only the layout.
//
// Every feature carries `kind` and `id`, and what its kind needs:
// - `runway`: the pavement as a polygon (the OSM outline) and its axis as a line from threshold to threshold (the
//   OurAirports ends), with `ref` (the designator pair, «08/26»), `lengthM` and `widthM`. The line keeps a narrow runway
//   visible when the map is zoomed out, and carries the pavement out to the thresholds where the OSM outline stops a
//   few metres short of them (3.6 to 14.1 m at MDPC), so the threshold bars sit on the runway and not beside it;
// - `runwayCentreline`, `thresholdBar` and `designator` (a point with `ref`, «08», and `rotate`, the heading its digits
//   face): the markings the generator placed;
// - `taxiway` and `taxilane`: the OSM line with its `ref` (its name, «A»), `null` when it has none;
// - `apron` and `terminal`: the polygon with its OSM `name`, `null` when it has none;
// - `holdBar`: a short bar across its taxiway at each holding point, with `ref` (the taxiway) and `runway`.

/** How long a holding bar is: about 30 m, a little wider than the 23 m taxiway it crosses. */
export const HOLD_BAR_LENGTH_M = 30;

/** Every kind of feature the airfield collection has, in drawing order from the bottom. */
export const AIRFIELD_FEATURE_KINDS = Object.freeze([
  'apron', 'terminal', 'taxiway', 'taxilane', 'runway', 'runwayCentreline', 'thresholdBar', 'holdBar', 'designator',
]);

const MARKING_KINDS = Object.freeze({
  centreline: 'runwayCentreline',
  thresholdBar: 'thresholdBar',
  designator: 'designator',
});

const feature = (properties, geometry) => ({ type: 'Feature', properties, geometry });
const line = coordinates => ({ type: 'LineString', coordinates: coordinates.map(point => [...point]) });
const polygon = ring => ({ type: 'Polygon', coordinates: [ring.map(point => [...point])] });
const textOrNull = value => (typeof value === 'string' && value.trim() !== '' ? value : null);

/**
 * The bearing of the taxiway a holding point sits on, at that point: the segment of the nearest taxiway line, one of
 * those named like the holding point's taxiway when it has a name. `null` when no line is near.
 */
export function taxiwayBearingAt(point, taxiways, ref = null) {
  const named = ref === null ? [] : taxiways.filter(taxiway => taxiway.ref === ref);
  let best = null;
  for (const taxiway of named.length > 0 ? named : taxiways) {
    const path = taxiway?.line ?? [];
    if (path.length < 2) continue;
    const hit = pointToPolylineM(point, path);
    if (hit && (best === null || hit.distanceM < best.hit.distanceM)) best = { hit, path };
  }
  if (best === null) return null;
  const { hit: { index }, path } = best;
  return initialBearing(path[index], path[index + 1]);
}

/** The bar of a holding point: HOLD_BAR_LENGTH_M across its taxiway, centred on the point, or `null` without one. */
export function holdBarLine(point, taxiways, ref = null) {
  const bearing = taxiwayBearingAt(point, taxiways, ref);
  if (bearing === null) return null;
  const half = HOLD_BAR_LENGTH_M / 2;
  return [destinationPoint(point, bearing - 90, half), destinationPoint(point, bearing + 90, half)].map(end => roundCoord(end));
}

const isPoint = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

// The axis of a runway: from threshold to threshold, or along its OSM centreline when the ends have none.
function runwayAxis(runway) {
  const thresholds = (runway.ends ?? []).map(end => end?.threshold);
  if (thresholds.length === 2 && thresholds.every(isPoint)) return thresholds;
  const centreline = runway.centerline ?? [];
  return centreline.length >= 2 ? [centreline[0], centreline[centreline.length - 1]] : null;
}

function runwayFeatures(runway) {
  const properties = {
    kind: 'runway', id: runway.id, ref: runway.id, lengthM: runway.lengthM, widthM: runway.widthM,
  };
  const axis = runwayAxis(runway);
  return [
    ...(Array.isArray(runway.polygon) && runway.polygon.length >= 4 ? [feature(properties, polygon(runway.polygon))] : []),
    ...(axis === null ? [] : [feature({ ...properties }, line(axis))]),
  ];
}

function markingFeature(marking) {
  const kind = MARKING_KINDS[marking?.type];
  if (!kind) return null;
  if (kind === 'designator') {
    return feature(
      { kind, id: `${marking.runway}-${marking.ident}-designator`, ref: marking.ident, rotate: marking.rotation },
      { type: 'Point', coordinates: [...marking.p] },
    );
  }
  const id = kind === 'thresholdBar' ? `${marking.runway}-${marking.ident}-threshold` : `${marking.runway}-centreline`;
  return feature({ kind, id, ref: kind === 'thresholdBar' ? marking.ident : marking.runway }, line(marking.line));
}

/** The airfield of `layout` as a FeatureCollection; an empty one without a layout. */
export function airfieldFeatures(layout) {
  if (!layout) return { type: 'FeatureCollection', features: [] };
  const taxiways = layout.taxiways ?? [];
  const features = [
    ...(layout.aprons ?? []).map(apron => feature(
      { kind: 'apron', id: apron.id, name: textOrNull(apron.name) }, polygon(apron.polygon),
    )),
    ...(layout.terminals ?? []).map(terminal => feature(
      { kind: 'terminal', id: terminal.id, name: textOrNull(terminal.name) }, polygon(terminal.polygon),
    )),
    ...taxiways.map(taxiway => feature(
      { kind: taxiway.kind === 'taxilane' ? 'taxilane' : 'taxiway', id: taxiway.id, ref: textOrNull(taxiway.ref) },
      line(taxiway.line),
    )),
    ...(layout.runways ?? []).flatMap(runwayFeatures),
    ...(layout.markings ?? []).map(markingFeature).filter(Boolean),
  ];
  for (const hold of layout.holdingPoints ?? []) {
    const bar = holdBarLine(hold.p, taxiways, textOrNull(hold.taxiwayRef));
    if (bar === null) continue;
    features.push(feature(
      { kind: 'holdBar', id: hold.id, ref: textOrNull(hold.taxiwayRef), runway: hold.runway ?? null }, line(bar),
    ));
  }
  return { type: 'FeatureCollection', features };
}
