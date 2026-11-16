import { describe, expect, it } from 'vitest';
import {
  AIRFIELD_FEATURE_KINDS, HOLD_BAR_LENGTH_M, airfieldFeatures, holdBarLine, taxiwayBearingAt,
} from './airfieldFeatures';
import { MDPC_LAYOUT } from './airportLayout';
import { destinationPoint, haversineM, initialBearing, pointToPolylineM } from './geo';

const collection = airfieldFeatures(MDPC_LAYOUT);
const ofKind = kind => collection.features.filter(item => item.properties.kind === kind);
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);
// A bar crosses its line at a right angle whichever way either of them is drawn.
const crossingAngle = (a, b) => Math.min(angleBetween(a, b), angleBetween(a, b + 180));
const isCoordinate = point => Array.isArray(point) && point.length === 2 && point.every(Number.isFinite);

describe('airfield features', () => {
  it('builds both runways with designators, threshold bars and centreline, the named and unnamed taxiways, aprons, terminals and hold bars from the dataset', () => {
    expect(collection.type).toBe('FeatureCollection');
    expect(new Set(collection.features.map(item => item.properties.kind))).toEqual(
      new Set(AIRFIELD_FEATURE_KINDS.filter(kind => kind !== 'taxilane')),
    );
    for (const item of collection.features) {
      expect(item.type).toBe('Feature');
      expect(typeof item.properties.id, item.properties.kind).toBe('string');
      const { type, coordinates } = item.geometry;
      const points = type === 'Point' ? [coordinates] : type === 'LineString' ? coordinates : coordinates[0];
      expect(points.every(isCoordinate), item.properties.id).toBe(true);
    }

    // Each runway is its pavement (the dataset polygon) and its axis from threshold to threshold, both with its size.
    const runways = ofKind('runway');
    expect(runways.map(item => item.geometry.type)).toEqual(['Polygon', 'LineString', 'Polygon', 'LineString']);
    for (const runway of MDPC_LAYOUT.runways) {
      const [pavement, axis] = runways.filter(item => item.properties.id === runway.id);
      expect(pavement.properties).toEqual({
        kind: 'runway', id: runway.id, ref: runway.id, lengthM: runway.lengthM, widthM: runway.widthM,
      });
      expect(pavement.geometry.coordinates).toEqual([runway.polygon]);
      expect(axis.properties).toEqual(pavement.properties);
      expect(axis.geometry.coordinates).toEqual(runway.ends.map(end => end.threshold));
      // The OSM outline stops short of the thresholds: the axis carries the pavement out to them, so each threshold
      // bar lies across an end of the drawn runway, centred on it.
      for (const bar of ofKind('thresholdBar').filter(item => runway.ends.some(end => end.ident === item.properties.ref))) {
        const [a, b] = bar.geometry.coordinates;
        const middle = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
        const nearestEnd = Math.min(...axis.geometry.coordinates.map(end => haversineM(end, middle)));
        expect(nearestEnd, bar.properties.id).toBeLessThan(0.5);
        expect(haversineM(a, b), bar.properties.id).toBeLessThan(runway.widthM);
      }
    }
    expect(runways.find(item => item.properties.id === '08/26').properties).toMatchObject({ lengthM: 3100.1, widthM: 45.1 });
    // Without thresholds the axis follows the ends of the OSM centreline.
    const bare = { ...MDPC_LAYOUT.runways[0], ends: [] };
    expect(airfieldFeatures({ runways: [bare] }).features.at(-1).geometry.coordinates)
      .toEqual([bare.centerline[0], bare.centerline.at(-1)]);

    // The designators face the heading of their runway end; one threshold bar per end and one centreline per runway.
    expect(ofKind('designator').map(item => [item.properties.ref, item.properties.rotate])).toEqual([
      ['08', 73.8], ['26', 253.8], ['09', 84.9], ['27', 264.9],
    ]);
    const designator08 = MDPC_LAYOUT.markings.find(marking => marking.type === 'designator' && marking.ident === '08');
    expect(ofKind('designator')[0].geometry).toEqual({ type: 'Point', coordinates: designator08.p });
    expect(ofKind('thresholdBar').map(item => item.properties.ref)).toEqual(['08', '26', '09', '27']);
    expect(ofKind('thresholdBar').every(item => item.geometry.coordinates.length === 2)).toBe(true);
    expect(ofKind('runwayCentreline').map(item => item.properties)).toEqual([
      { kind: 'runwayCentreline', id: '08/26-centreline', ref: '08/26' },
      { kind: 'runwayCentreline', id: '09/27-centreline', ref: '09/27' },
    ]);

    // The 52 OSM taxiways of the network: 14 named, the rest without a name.
    const taxiways = ofKind('taxiway');
    expect(taxiways).toHaveLength(MDPC_LAYOUT.taxiways.length);
    expect(taxiways).toHaveLength(52);
    expect(taxiways.map(item => item.properties.ref).filter(Boolean).sort()).toEqual([
      'A', 'B', 'D', 'E', 'E1', 'E2', 'F', 'G', 'H', 'J', 'K', 'P', 'R1', 'R2',
    ]);
    expect(taxiways.filter(item => item.properties.ref === null)).toHaveLength(38);
    const taxiwayA = MDPC_LAYOUT.taxiways.find(taxiway => taxiway.ref === 'A');
    expect(taxiways.find(item => item.properties.ref === 'A')).toEqual({
      type: 'Feature', properties: { kind: 'taxiway', id: taxiwayA.id, ref: 'A' }, geometry: { type: 'LineString', coordinates: taxiwayA.line },
    });

    // Aprons and terminal buildings with their names, null where OSM has none.
    expect(ofKind('apron')).toHaveLength(8);
    expect(ofKind('apron').every(item => item.properties.name === null && item.geometry.type === 'Polygon')).toBe(true);
    expect(ofKind('terminal').map(item => item.properties.name)).toEqual(MDPC_LAYOUT.terminals.map(terminal => terminal.name));
    expect(ofKind('terminal').map(item => item.properties.name)).toContain('Terminal B (Arrival & Departure)');

    // One bar per holding point, with its taxiway and runway.
    expect(ofKind('holdBar').map(item => item.properties.id)).toEqual(MDPC_LAYOUT.holdingPoints.map(hold => hold.id));
    expect(ofKind('holdBar')).toHaveLength(13);
    expect(ofKind('holdBar')[0].properties).toEqual({ kind: 'holdBar', id: 'hp-A-08-26', ref: 'A', runway: '08/26' });
    expect(ofKind('holdBar').find(item => item.properties.id === 'hp-w812822709-08-26').properties.ref).toBeNull();

    // The same layout gives the same collection; without a layout there is nothing to draw.
    expect(airfieldFeatures(MDPC_LAYOUT)).toEqual(collection);
    expect(airfieldFeatures(null)).toEqual({ type: 'FeatureCollection', features: [] });
  });

  it('keeps taxilanes apart from taxiways and drops markings and holds it cannot place (synthetic layout)', () => {
    const synthetic = {
      runways: [],
      taxiways: [
        { id: 'tw-1', ref: 'Z', kind: 'taxiway', line: [[-68.36, 18.56], [-68.36, 18.561]] },
        { id: 'tw-2', ref: '  ', kind: 'taxilane', line: [[-68.361, 18.56], [-68.362, 18.56]] },
      ],
      markings: [{ type: 'mystery', line: [] }],
      holdingPoints: [{ id: 'hp-far', taxiwayRef: null, runway: '01/19', p: [-68.36, 18.5605] }],
      aprons: [],
      terminals: [],
    };
    const features = airfieldFeatures(synthetic).features;
    expect(features.map(item => [item.properties.kind, item.properties.ref ?? null])).toEqual([
      ['taxiway', 'Z'], ['taxilane', null], ['holdBar', null],
    ]);
    // Without a taxiway line to cross, a holding point has no bar.
    expect(airfieldFeatures({ ...synthetic, taxiways: [] }).features).toEqual([]);
  });

  it('a hold bar crosses its taxiway at a right angle', () => {
    for (const hold of MDPC_LAYOUT.holdingPoints) {
      const bar = ofKind('holdBar').find(item => item.properties.id === hold.id).geometry.coordinates;
      // About 30 m long and centred on the holding point.
      expect(haversineM(bar[0], bar[1]), hold.id).toBeCloseTo(HOLD_BAR_LENGTH_M, 0);
      expect(haversineM(bar[0], hold.p) - haversineM(bar[1], hold.p), hold.id).toBeLessThan(0.5);
      // The holding point lies on a taxiway line, and the bar crosses that line square.
      const nearest = MDPC_LAYOUT.taxiways
        .map(taxiway => ({ taxiway, hit: pointToPolylineM(hold.p, taxiway.line) }))
        .sort((a, b) => a.hit.distanceM - b.hit.distanceM)[0];
      expect(nearest.hit.distanceM, hold.id).toBeLessThan(1);
      if (hold.taxiwayRef) expect(nearest.taxiway.ref, hold.id).toBe(hold.taxiwayRef);
      const { line } = nearest.taxiway;
      const along = initialBearing(line[nearest.hit.index], line[nearest.hit.index + 1]);
      expect(crossingAngle(initialBearing(bar[0], bar[1]), along + 90), hold.id).toBeLessThan(1);
    }

    // On a taxiway running north, the bar runs west to east, 15 m to each side.
    const centre = [-68.36, 18.565];
    const north = [{ id: 'tw-n', ref: 'N', line: [destinationPoint(centre, 180, 200), destinationPoint(centre, 0, 200)] }];
    expect(taxiwayBearingAt(centre, north, 'N')).toBeCloseTo(0, 3);
    const [west, east] = holdBarLine(centre, north, 'N');
    expect(initialBearing(centre, west)).toBeCloseTo(270, 1);
    expect(initialBearing(centre, east)).toBeCloseTo(90, 1);
    expect(haversineM(centre, west)).toBeCloseTo(15, 0);
    // A name the lines do not carry falls back to the nearest line; no line at all gives no bar.
    expect(taxiwayBearingAt(centre, north, 'Q')).toBeCloseTo(0, 3);
    expect(holdBarLine(centre, [])).toBeNull();
    expect(holdBarLine(centre, [{ id: 'tw-dot', line: [centre] }])).toBeNull();
  });
});
