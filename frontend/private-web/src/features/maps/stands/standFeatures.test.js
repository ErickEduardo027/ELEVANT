import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM } from '../airport/geo';
import { layoutStandReferences } from '../airport/layoutIndex';
import { STAND_BOX, standBox } from '../airport/standGeometry';
import { mapMessages } from '../mapMessages';
import { SCENARIO_AGENTS, boardStand, boardVisit, createRampScenario } from '../testing/mapFixtures';
import {
  STAND_FEATURE_COLLECTIONS, STAND_FEATURE_KEYS, STAND_FEATURE_LABEL_MODES, buildStandFeatures, diffFeatureCollections,
  diffStandFeatures, standDrawState, toStandFeatures,
} from './standFeatures';
import { STAND_LABEL_MODES } from './standLayers';
import { attachStandGeometry } from './standModel';

// 14:07 in Punta Cana (UTC−4); the scenario's times are relative to it.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MINUTE = 60 * 1000;
const REFERENCES = layoutStandReferences(MDPC_LAYOUT);
const { marta } = SCENARIO_AGENTS;

// Synthetic stands of a positions screen; the codes come padded and in lower case as the database may write them.
const position = overrides => ({
  id: 'A1', terminal: 'A', latitude: 18.5642, longitude: -68.3603, status: 'available', locationSource: 'reference',
  ...overrides,
});

const positionsOf = board => attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), MDPC_LAYOUT);

function scenario(options = {}) {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  const positions = positionsOf(board);
  return { board, flightsByTurnaround, positions, features: buildStandFeatures(positions, { nowMs: NOW, flightsByTurnaround, ...options }) };
}

const propertiesOf = (collection, id) => collection.features.find(item => item.id === id)?.properties;
const latin1 = text => [...text].every(character => character.codePointAt(0) <= 0xff);
const leafTexts = tree => Object.values(tree).flatMap(value => (typeof value === 'string' ? [value] : leafTexts(value)));

describe('toStandFeatures', () => {
  it('builds one point per located stand keyed by the normalized code and drops stands without coordinates', () => {
    const data = toStandFeatures([
      position({ id: 'A01', status: 'occupied', locationSource: 'occ' }),
      position({ id: 'b21', terminal: 'B', latitude: 18.5631, longitude: -68.3692, status: 'planned' }),
      position({ id: 'BN6', terminal: 'FBO', latitude: null, longitude: null }),
      position({ id: 'B22', latitude: Number.NaN }),
      position({ code: 'FBO3', id: undefined, terminal: undefined, terminalCode: 'FBO', latitude: 18.5701, longitude: -68.3521 }),
      position({ id: 'A1', status: 'planned', latitude: 18.5, longitude: -68.3 }),
      position({ id: 'A9', retired: true }),
      null,
    ]);

    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toEqual([
      {
        type: 'Feature',
        properties: { code: 'A1', terminal: 'A', status: 'occupied', unofficial: false },
        geometry: { type: 'Point', coordinates: [-68.3603, 18.5642] },
      },
      {
        type: 'Feature',
        properties: { code: 'B21', terminal: 'B', status: 'planned', unofficial: true },
        geometry: { type: 'Point', coordinates: [-68.3692, 18.5631] },
      },
      {
        type: 'Feature',
        properties: { code: 'FBO3', terminal: 'FBO', status: 'available', unofficial: true },
        geometry: { type: 'Point', coordinates: [-68.3521, 18.5701] },
      },
    ]);
    // Each code once, so the promoted ids of the source are unique; nothing comes back for nothing.
    expect(toStandFeatures([]).features).toEqual([]);
    expect(toStandFeatures(undefined).features).toEqual([]);
  });

  it('marks stands without an OCC location as unofficial', () => {
    const data = toStandFeatures([
      position({ id: 'A2', locationSource: 'occ' }),
      position({ id: 'A3', locationSource: 'reference' }),
      // The planning view of the positions map carries no location source: its stands sit at the reference.
      position({ id: 'A4', locationSource: undefined }),
    ]);
    expect(data.features.map(feature => [feature.properties.code, feature.properties.unofficial])).toEqual([
      ['A2', false], ['A3', true], ['A4', true],
    ]);
  });

  it('draws every state of the vocabulary as it is and anything else as free', () => {
    for (const state of STAND_STATE_KEYS) expect(standDrawState(state)).toBe(state);
    for (const other of [undefined, null, '', 'Occupied', 'blocked']) expect(standDrawState(other)).toBe('available');
    expect(toStandFeatures([position({ status: 'blocked' })]).features[0].properties.status).toBe('available');
  });
});

describe('buildStandFeatures', () => {
  it('one polygon per drawn stand, keyed by its normalized code, with its state, signal and glyph', () => {
    const { positions, features } = scenario();
    const drawn = positions.filter(item => item.geometry !== null);
    expect(features.polygons.features.map(item => item.id)).toEqual(drawn.map(item => item.id));
    // The 41 stands of the catalogue and C7, which OCC placed.
    expect(features.polygons.features).toHaveLength(42);
    for (const polygon of features.polygons.features) {
      expect(polygon.properties.code, polygon.id).toBe(polygon.id);
      expect(polygon.geometry.type, polygon.id).toBe('Polygon');
      expect(polygon.geometry.coordinates[0], polygon.id).toEqual(drawn.find(item => item.id === polygon.id).geometry.polygon);
    }
    const a1 = propertiesOf(features.polygons, 'A1');
    expect(a1).toEqual({ code: 'A1', terminal: 'A', state: 'available', unofficial: true, signal: null, glyph: null, clock: false });
    expect(propertiesOf(features.polygons, 'A2')).toMatchObject({ state: 'planned', signal: null, glyph: null });
    expect(propertiesOf(features.polygons, 'A3')).toMatchObject({ state: 'arriving', signal: 'attention', glyph: null });
    expect(propertiesOf(features.polygons, 'A4')).toMatchObject({ state: 'occupied', signal: 'urgent', glyph: 'aircraft', clock: false });
    expect(propertiesOf(features.polygons, 'A5')).toMatchObject({ state: 'releasing', signal: null, glyph: 'aircraft', clock: true });
    // The demo flight landed but is not parked yet: arriving, by the server's instants.
    expect(propertiesOf(features.polygons, 'A6')).toMatchObject({ state: 'arriving', glyph: null });
    expect(propertiesOf(features.polygons, 'A10')).toMatchObject({ state: 'disabled', signal: null });
    expect(propertiesOf(features.polygons, 'A7')).toMatchObject({ state: 'unverified', unofficial: true });
    expect(propertiesOf(features.polygons, 'B21')).toMatchObject({ state: 'releasing', signal: 'attention' });
    expect(propertiesOf(features.polygons, 'C7')).toMatchObject({ state: 'available', terminal: 'FBO', unofficial: false });
    // The seven states are on the ramp.
    expect(new Set(features.polygons.features.map(item => item.properties.state))).toEqual(new Set(STAND_STATE_KEYS));
    // A stand without a geometry, a retired stand and a code seen twice are not drawn.
    const extra = buildStandFeatures([
      ...positions, { ...positions[0] }, { id: 'Z1', geometry: null }, { ...positions[0], id: 'Q1', retired: true }, null,
    ], { nowMs: NOW });
    expect(extra.polygons.features).toHaveLength(42);
    expect(buildStandFeatures([], { nowMs: NOW })).toEqual({
      polygons: { type: 'FeatureCollection', features: [] },
      aux: { type: 'FeatureCollection', features: [] },
      labels: { type: 'FeatureCollection', features: [] },
      groups: { type: 'FeatureCollection', features: [] },
    });
  });

  it('label variants: code; code and flight; three lines with the times and the covering agent\'s initials', () => {
    const { features, positions, flightsByTurnaround } = scenario();
    const label = code => propertiesOf(features.labels, code);
    expect(label('A1')).toEqual({
      code: 'A1', state: 'available', signal: null, sortKey: 4, label1: 'A1', label2: 'A1', label3: 'A1',
    });
    expect(label('A2')).toMatchObject({
      label1: 'A2', label2: 'A2\nDM201', label3: 'A2\nDM201\nLlega 15:37 · en 90 min · MC', sortKey: 3,
    });
    expect(label('A3')).toMatchObject({
      label2: 'A3\nDM203', label3: 'A3\nDM203\nLlega 14:17 · en 10 min\nSin agente que la cubra', sortKey: 1, signal: 'attention',
    });
    expect(label('A4')).toMatchObject({
      label2: 'A4\nDM206', label3: 'A4\nDM206\nSale 15:07 · en 60 min · LP\nOtra aeronave llega a esta posición', sortKey: 2,
    });
    expect(label('A5').label3).toBe('A5\nDM210\nSale 14:17 · en 10 min · LP');
    // The demo flight carries «Demo» and, from the map flights, its aircraft type.
    expect(label('A6')).toMatchObject({ label2: 'A6\nZZ9001 · Demo', label3: 'A6\nZZ9001 · B38M · Demo\nLlega 14:10 · en 3 min · MC' });
    expect(label('A10')).toMatchObject({ label2: 'A10\nAnulada por A9', label3: 'A10\nAnulada por A9', sortKey: 1 });
    expect(label('B21').label3).toBe('B21\nDM214\nSale 14:02 · AR\nPasó su hora de salida');
    expect(label('B22')).toMatchObject({ label2: 'B22', label3: 'B22\nSolo fuselaje estrecho' });
    expect(label('A7')).toMatchObject({ label1: 'A7', label2: 'A7', label3: 'A7', sortKey: 5 });
    for (const point of features.labels.features) {
      expect(point.geometry).toEqual({ type: 'Point', coordinates: [...positions.find(item => item.id === point.id).geometry.center] });
    }
    // In English, with the same clock.
    const english = buildStandFeatures(positions, { nowMs: NOW, flightsByTurnaround, language: 'en' });
    expect(propertiesOf(english.labels, 'A3').label3).toBe('A3\nDM203\nArrives 14:17 · in 10 min\nNo agent covers it');
    expect(propertiesOf(english.labels, 'B21').label3).toBe('B21\nDM214\nDeparts 14:02 · AR\nPast its departure time');
    expect(propertiesOf(english.labels, 'A10').label2).toBe('A10\nCancelled by A9');
    // The console's apron puts its planned stands first; an unknown label mode is refused.
    expect(propertiesOf(buildStandFeatures(positions, { nowMs: NOW, labels: 'dashboard' }).labels, 'A2').sortKey).toBe(0);
    expect(STAND_FEATURE_LABEL_MODES).toEqual(STAND_LABEL_MODES);
    expect(() => buildStandFeatures(positions, { nowMs: NOW, labels: 'wall' })).toThrow(RangeError);
  });

  it('map texts use only Latin-1 characters', () => {
    // The visual suite serves the glyph range 0-255 only, and the map draws these texts.
    for (const language of ['es', 'en']) {
      const { features } = scenario({ language });
      const texts = [
        ...features.labels.features.flatMap(point => [point.properties.label1, point.properties.label2, point.properties.label3]),
        ...features.groups.features.map(group => group.properties.text),
      ];
      expect(texts.length).toBeGreaterThan(80);
      for (const text of texts) expect(latin1(text), JSON.stringify(text)).toBe(true);
      for (const text of leafTexts(mapMessages[language].stand)) expect(latin1(text), `${language}: ${text}`).toBe(true);
    }
  });

  it('lead-ins, combined links between drawn stands and the narrowbody inner box at code-C width', () => {
    const { features, positions } = scenario();
    const byId = Object.fromEntries(features.aux.features.map(line => [line.id, line]));
    const find = code => positions.find(item => item.id === code);
    expect(byId['leadIn:A3']).toEqual({
      type: 'Feature',
      id: 'leadIn:A3',
      properties: { id: 'leadIn:A3', kind: 'leadIn', code: 'A3', state: 'arriving' },
      geometry: { type: 'LineString', coordinates: find('A3').geometry.leadIn },
    });
    const withLeadIn = positions.filter(item => item.geometry?.leadIn?.length >= 2).map(item => `leadIn:${item.id}`);
    expect(features.aux.features.filter(line => line.properties.kind === 'leadIn').map(line => line.id)).toEqual(withLeadIn);
    for (const line of features.aux.features) expect(line.properties.id, line.id).toBe(line.id);
    // A10 is cancelled by A9: one link from its centre to the centre of A9.
    expect(features.aux.features.filter(line => line.properties.kind === 'combinedLink').map(line => line.id)).toEqual(['combinedLink:A10']);
    expect(byId['combinedLink:A10']).toMatchObject({
      properties: { kind: 'combinedLink', code: 'A10', target: 'A9' },
      geometry: { type: 'LineString', coordinates: [[...find('A10').geometry.center], [...find('A9').geometry.center]] },
    });
    // Only between two drawn stands.
    const withoutA9 = buildStandFeatures(positions.filter(item => item.id !== 'A9'), { nowMs: NOW });
    expect(withoutA9.aux.features.some(line => line.properties.kind === 'combinedLink')).toBe(false);
    // B22, a D box limited to narrow-body aircraft, shows the code-C box inside it; BN6 is a code-C stand already.
    const b22 = find('B22').geometry;
    expect(b22.sizeLetter).toBe('D');
    const inner = byId['narrowInner:B22'];
    expect(inner.properties).toEqual({ id: 'narrowInner:B22', kind: 'narrowInner', code: 'B22' });
    expect(inner.geometry.coordinates).toEqual(standBox(b22.center, b22.headingTrue, 'C'));
    expect(haversineM(inner.geometry.coordinates[0], inner.geometry.coordinates[1])).toBeCloseTo(STAND_BOX.C.widthM, 1);
    expect(find('BN6')).toMatchObject({ narrowbodyOnly: true, geometry: expect.objectContaining({ sizeLetter: 'C' }) });
    expect(byId['narrowInner:BN6']).toBeUndefined();
  });

  it('one chip per terminal, «A · 3/16», marked when a flight is arriving', () => {
    const { features, positions } = scenario();
    expect(features.groups.features.map(group => group.properties)).toEqual([
      { terminal: 'A', text: 'A · 3/16', busy: 3, total: 16, arriving: true },
      { terminal: 'B', text: 'B · 1/17', busy: 1, total: 17, arriving: false },
      { terminal: 'FBO', text: 'FBO · 0/9', busy: 0, total: 9, arriving: false },
    ]);
    // At the centre of the box around the terminal's stands.
    const corners = positions.filter(item => item.terminal === 'A' && item.geometry).flatMap(item => item.geometry.polygon);
    const [lngs, lats] = [corners.map(point => point[0]), corners.map(point => point[1])];
    expect(features.groups.features[0]).toMatchObject({
      id: 'A',
      geometry: { type: 'Point', coordinates: [(Math.min(...lngs) + Math.max(...lngs)) / 2, (Math.min(...lats) + Math.max(...lats)) / 2] },
    });
    // With today's reads alone the demo aircraft counts as parked from its landing.
    const today = buildStandFeatures(positions, { nowMs: NOW });
    expect(today.groups.features[0].properties).toMatchObject({ text: 'A · 4/16', arriving: true });
  });

  it('diffStandFeatures returns only what changed, and null when nothing changed', () => {
    const { board, flightsByTurnaround, features: before } = scenario();
    const build = stands => buildStandFeatures(positionsOf({ ...board, positions: stands }), { nowMs: NOW, flightsByTurnaround });
    // A re-read of the same board, in new objects, changes nothing.
    expect(diffStandFeatures(before, build(createRampScenario(NOW).board.positions))).toBeNull();
    expect(diffStandFeatures(before, before)).toBeNull();
    expect(STAND_FEATURE_COLLECTIONS).toEqual(['polygons', 'aux', 'labels', 'groups']);
    expect(STAND_FEATURE_KEYS).toEqual({ polygons: 'code', aux: 'id', labels: 'code', groups: 'terminal' });

    // A1 gets a planned flight: its polygon, its lead-in and its label change, and nothing else.
    const planned = build(board.positions.map(stand => (stand.code === 'A01'
      ? boardStand('A01', { coveredBy: [marta], turnarounds: [boardVisit({ nowMs: NOW, flight: 'DM501', arrivalInMin: 120 })] })
      : stand)));
    const diff = diffStandFeatures(before, planned);
    expect(diff.groups).toBeNull();
    expect(diff.polygons).toEqual({
      add: [],
      remove: [],
      update: [{ id: 'A1', removeAllProperties: true, addOrUpdateProperties: expect.arrayContaining([{ key: 'state', value: 'planned' }]) }],
    });
    expect(diff.polygons.update[0].addOrUpdateProperties).toHaveLength(Object.keys(propertiesOf(planned.polygons, 'A1')).length);
    expect(diff.aux.update.map(item => item.id)).toEqual(['leadIn:A1']);
    expect(diff.labels.update.map(item => item.id)).toEqual(['A1']);

    // OCC places A1 20 m east: its box and label move; the label's texts stay as they were.
    const [longitude, latitude] = destinationPoint(MDPC_LAYOUT.stands.find(stand => stand.code === 'A1').center, 90, 20);
    const placed = build(board.positions.map(stand => (stand.code === 'A01' ? { ...stand, latitude, longitude } : stand)));
    const moved = diffStandFeatures(before, placed);
    expect(moved.polygons.update).toEqual([expect.objectContaining({ id: 'A1', newGeometry: expect.objectContaining({ type: 'Polygon' }) })]);
    expect(moved.polygons.update[0].addOrUpdateProperties).toContainEqual({ key: 'unofficial', value: false });
    expect(moved.labels.update).toEqual([{ id: 'A1', newGeometry: { type: 'Point', coordinates: [longitude, latitude] } }]);

    // A stand that is no longer drawn is removed, and comes back as an addition; its terminal's chip changes.
    const fewer = buildStandFeatures(positionsOf(board).filter(item => item.id !== 'B22'), { nowMs: NOW, flightsByTurnaround });
    const removal = diffStandFeatures(before, fewer);
    expect(removal.polygons).toEqual({ add: [], remove: ['B22'], update: [] });
    expect(removal.labels.remove).toEqual(['B22']);
    expect(removal.aux.remove.sort()).toEqual(['leadIn:B22', 'narrowInner:B22']);
    expect(removal.groups.update.map(item => item.id)).toEqual(['B']);
    expect(removal.groups.update[0].addOrUpdateProperties).toContainEqual({ key: 'text', value: 'B · 1/16' });
    expect(diffStandFeatures(fewer, before).polygons.add.map(item => item.id)).toEqual(['B22']);
    // Without a previous build every feature is added.
    expect(diffStandFeatures(null, before).polygons).toEqual({ add: before.polygons.features, remove: [], update: [] });
    expect(diffFeatureCollections(undefined, undefined)).toBeNull();
  });

  it('countdown texts change on the minute, never in between', () => {
    const stand = boardStand('A05', { coveredBy: [marta], turnarounds: [boardVisit({ nowMs: NOW, flight: 'DM601', arrivalInMin: 40.5 })] });
    const positions = positionsOf({ positions: [stand], asOf: new Date(NOW).toISOString() });
    const at = ms => buildStandFeatures(positions, { nowMs: ms });
    const label3 = features => propertiesOf(features.labels, 'A5').label3;
    expect(label3(at(NOW))).toBe('A5\nDM601\nLlega 14:47 · en 41 min · MC');
    for (const offset of [1, 30 * 1000, MINUTE - 1]) expect(diffStandFeatures(at(NOW), at(NOW + offset))).toBeNull();
    expect(label3(at(NOW + MINUTE))).toBe('A5\nDM601\nLlega 14:47 · en 40 min · MC');
    const diff = diffStandFeatures(at(NOW), at(NOW + MINUTE));
    expect(diff).toMatchObject({ polygons: null, aux: null, groups: null });
    expect(diff.labels.update.map(item => item.id)).toEqual(['A5']);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/standFeatures.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
