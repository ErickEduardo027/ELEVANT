import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { aircraftFootprint } from '../aircraft/footprint';
import { AIRCRAFT_TYPES } from '../aircraft/types';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint, haversineM, pointInPolygon, toEnu } from '../airport/geo';
import { layoutStandReferences } from '../airport/layoutIndex';
import { STAND_BOX, standBox } from '../airport/standGeometry';
import { mapMessages } from '../mapMessages';
import { SCENARIO_AGENTS, boardStand, boardVisit, createMapStands, createRampScenario } from '../testing/mapFixtures';
import {
  PROGRESS_INSET, STAND_FEATURE_COLLECTIONS, STAND_FEATURE_KEYS, STAND_FEATURE_LABEL_MODES, boxOfPoints, boxesMeet,
  buildStandFeatures, diffFeatureCollections, diffStandFeatures, featuresIn, parkedAircraftIds, progressSegment,
  standSignalOf, standsDrawnIn,
} from './standFeatures';
import { STAND_LABEL_MODES } from './standLayers';
import { attachStandGeometry, withStandDisplay } from './standModel';

// 14:07 in Punta Cana (UTC−4); the scenario's times are relative to it.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MINUTE = 60 * 1000;
const REFERENCES = layoutStandReferences(MDPC_LAYOUT);
const { marta } = SCENARIO_AGENTS;

// The positions a screen gives its map: the board over the references, with their geometry and, as the screens derive
// it (useStandDisplay), how each reads at `nowMs`.
const positionsOf = (board, { nowMs = NOW, flightsByTurnaround, aircraftByTurnaround } = {}) => withStandDisplay(
  attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), MDPC_LAYOUT),
  { nowMs, flightsByTurnaround, aircraftByTurnaround },
);

function scenario(options = {}) {
  const { board, flightsByTurnaround } = createRampScenario(NOW);
  const positions = positionsOf(board, { flightsByTurnaround });
  return { board, flightsByTurnaround, positions, features: buildStandFeatures(positions, { nowMs: NOW, ...options }) };
}

const propertiesOf = (collection, id) => collection.features.find(item => item.id === id)?.properties;
const latin1 = text => [...text].every(character => character.codePointAt(0) <= 0xff);
const leafTexts = tree => Object.values(tree).flatMap(value => (typeof value === 'string' ? [value] : leafTexts(value)));

describe('buildStandFeatures', () => {
  it('one polygon per drawn stand, keyed by its normalized code, with the state the screen derived', () => {
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
    // A polygon carries only what the polygon layers read: a countdown never touches it.
    expect(propertiesOf(features.polygons, 'A1')).toEqual({ code: 'A1', terminal: 'A', state: 'available', unofficial: true });
    const states = Object.fromEntries(features.polygons.features.map(item => [item.id, item.properties.state]));
    expect(states).toMatchObject({
      A2: 'planned', A3: 'arriving', A4: 'occupied', A5: 'releasing', A6: 'arriving', A10: 'disabled', A7: 'unverified',
      B21: 'releasing', C7: 'available',
    });
    expect(propertiesOf(features.polygons, 'C7')).toMatchObject({ terminal: 'FBO', unofficial: false });
    // The seven states are on the ramp.
    expect(new Set(Object.values(states))).toEqual(new Set(STAND_STATE_KEYS));
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
      footprints: { type: 'FeatureCollection', features: [] },
    });
  });

  it('a stand the screen did not derive reads as its board status says, without visit, signal or countdown', () => {
    const { board } = createRampScenario(NOW);
    const bare = attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, board, board.asOf), MDPC_LAYOUT);
    const features = buildStandFeatures(bare, { nowMs: NOW });
    // The board says «Planificada» for A3 and «Ocupada» for the demo flight on A6, which has landed.
    expect(propertiesOf(features.polygons, 'A3').state).toBe('planned');
    expect(propertiesOf(features.polygons, 'A6').state).toBe('occupied');
    expect(propertiesOf(features.labels, 'A3')).toMatchObject({ signal: null, label2: 'A3\nDM203', label3: 'A3\nDM203' });
    // A state outside the vocabulary is drawn free, as before.
    const [odd] = attachStandGeometry(createMapStands({ A1: { status: 'mystery' } }).slice(0, 1), MDPC_LAYOUT);
    expect(propertiesOf(buildStandFeatures([odd], { nowMs: NOW }).polygons, 'A1').state).toBe('available');
  });

  it('label points: the three label variants, the glyph and the clock of a stand with an aircraft, the signal and its heading', () => {
    const { features, positions } = scenario();
    const label = code => propertiesOf(features.labels, code);
    const heading = code => positions.find(item => item.id === code).geometry.headingTrue;
    expect(label('A1')).toEqual({
      code: 'A1', state: 'available', signal: null, glyph: null, footprint: null, clock: false, heading: heading('A1'), sortKey: 4,
      label1: 'A1', label2: 'A1', label3: 'A1\nMC',
    });
    expect(label('A2')).toMatchObject({
      label1: 'A2', label2: 'A2\nDM201', label3: 'A2\nDM201\nLlega 15:37 · en 90 min · MC', sortKey: 3,
    });
    expect(label('A3')).toMatchObject({
      label2: 'A3\nDM203', label3: 'A3\nDM203\nLlega 14:17 · en 10 min\nSin agente que la cubra', sortKey: -9, signal: 'attention',
      glyph: null,
    });
    expect(label('A4')).toMatchObject({
      label2: 'A4\nDM206', label3: 'A4\nDM206\nSale 15:07 · en 60 min · LP\nOtra aeronave llega a esta posición', sortKey: -18,
      signal: 'urgent', glyph: 'aircraft', clock: false,
    });
    expect(label('A5')).toMatchObject({ label3: 'A5\nDM210\nSale 14:17 · en 10 min · LP', glyph: 'aircraft', clock: true });
    // The demo flight carries «Demo» and, from the map flights, its aircraft type.
    expect(label('A6')).toMatchObject({ label2: 'A6\nZZ9001 · Demo', label3: 'A6\nZZ9001 · B38M · Demo\nLlega 14:10 · en 3 min · MC' });
    expect(label('A10')).toMatchObject({ label2: 'A10\nAnulada por A9', label3: 'A10\nAR\nAnulada por A9', sortKey: 1 });
    expect(label('B21').label3).toBe('B21\nDM214\nSale 14:02 · AR\nPasó su hora de salida');
    // Who covers a stand is on its third line with or without a flight; a stand nobody covers says nothing of it.
    expect(label('B22')).toMatchObject({ label2: 'B22', label3: 'B22\nLP\nSolo fuselaje estrecho' });
    expect(label('BN6').label3).toBe('BN6\nSolo fuselaje estrecho');
    expect(label('A7')).toMatchObject({ label1: 'A7', label2: 'A7', label3: 'A7', sortKey: 5 });
    // A stand with a signal places its label first (MapLibre places the lower key first): urgent, then attention, then
    // the order of the states, so its code is never the one that gives way to a neighbour's.
    const keyed = features.labels.features.map(point => point.properties);
    const keysWith = signal => keyed.filter(item => item.signal === signal).map(item => item.sortKey);
    expect(keysWith('urgent').length).toBeGreaterThan(0);
    expect(keysWith('attention').length).toBeGreaterThan(0);
    expect(Math.max(...keysWith('urgent'))).toBeLessThan(Math.min(...keysWith('attention')));
    expect(Math.max(...keysWith('attention'))).toBeLessThan(Math.min(...keysWith(null)));
    for (const point of features.labels.features) {
      expect(point.geometry).toEqual({ type: 'Point', coordinates: [...positions.find(item => item.id === point.id).geometry.center] });
    }
    // In English, with the same clock.
    const english = buildStandFeatures(positions, { nowMs: NOW, language: 'en' });
    expect(propertiesOf(english.labels, 'A3').label3).toBe('A3\nDM203\nArrives 14:17 · in 10 min\nNo agent covers it');
    expect(propertiesOf(english.labels, 'B21').label3).toBe('B21\nDM214\nDeparts 14:02 · AR\nPast its departure time');
    expect(propertiesOf(english.labels, 'A10').label2).toBe('A10\nCancelled by A9');
    // The console's apron puts its planned stands first; an unknown label mode is refused.
    expect(propertiesOf(buildStandFeatures(positions, { nowMs: NOW, labels: 'dashboard' }).labels, 'A2').sortKey).toBe(0);
    expect(STAND_FEATURE_LABEL_MODES).toEqual(STAND_LABEL_MODES);
    expect(() => buildStandFeatures(positions, { nowMs: NOW, labels: 'wall' })).toThrow(RangeError);
  });

  it('the one signal the map draws on a stand: urgent over attention, whatever their order', () => {
    const urgent = { kind: 'urgent', reason: 'conflict' };
    const attention = { kind: 'attention', reason: 'uncovered' };
    expect(standSignalOf({ signals: [urgent, attention] })).toBe('urgent');
    expect(standSignalOf({ signals: [attention, urgent] })).toBe('urgent');
    expect(standSignalOf({ signals: [attention, { kind: 'attention', reason: 'overdue' }] })).toBe('attention');
    // A plain notice (PR M6) is drawn too, after both.
    expect(standSignalOf({ signals: [{ kind: 'notice' }, null] })).toBe('notice');
    expect(standSignalOf({ signals: [{ kind: 'notice' }, attention] })).toBe('attention');
    expect(standSignalOf({ signals: [{ kind: 'notice' }, urgent] })).toBe('urgent');
    expect(standSignalOf({ signals: [{ kind: 'reminder' }] })).toBeNull();
    // The signals the screen derived, else those of the stand's display; without either, none.
    expect(standSignalOf({ display: { signals: [attention] } })).toBe('attention');
    expect(standSignalOf({ signals: [], display: { signals: [urgent] } })).toBeNull();
    for (const stand of [{ display: { signals: 'urgent' } }, { signals: 'urgent' }, {}, null]) {
      expect(standSignalOf(stand), JSON.stringify(stand)).toBeNull();
    }

    // A4 has an aircraft on it while another flight arrives and, uncovered, it carries both signals: its label point
    // carries only the urgent one, and the reason on its third line is that one's.
    const { board } = createRampScenario(NOW);
    const positions = positionsOf({ ...board, positions: board.positions.map(stand => (stand.code === 'A04' ? { ...stand, coveredBy: [] } : stand)) });
    const a4 = positions.find(item => item.id === 'A4');
    expect(a4.signals.map(signal => signal.kind)).toEqual(['urgent', 'attention']);
    const features = buildStandFeatures(positions, { nowMs: NOW });
    expect(propertiesOf(features.labels, 'A4')).toMatchObject({ signal: 'urgent', label3: expect.stringMatching(/\nOtra aeronave llega a esta posición$/) });
    // Every label point carries the signal standSignalOf gives its stand.
    for (const point of features.labels.features) {
      expect(point.properties.signal, point.id).toBe(standSignalOf(positions.find(item => item.id === point.id)));
    }
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

  it('lead-ins, combined links between drawn stands and the narrow-body box of a stand wider than code C', () => {
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
    // B22 is limited to narrow-body aircraft, but its box is already narrower than code C: no box inside it. BN6 is a
    // code-C stand.
    const b22 = find('B22').geometry;
    expect(haversineM(b22.polygon[0], b22.polygon[1])).toBeLessThan(STAND_BOX.C.widthM);
    expect(byId['narrowInner:B22']).toBeUndefined();
    expect(find('BN6')).toMatchObject({ narrowbodyOnly: true, geometry: expect.objectContaining({ sizeLetter: 'C' }) });
    expect(byId['narrowInner:BN6']).toBeUndefined();
    // A1, 60 m wide, limited to narrow-body aircraft: the code-C box inside it.
    const { board } = createRampScenario(NOW);
    const narrowA1 = positionsOf({ ...board, positions: board.positions.map(stand => (stand.code === 'A01' ? { ...stand, narrowbodyOnly: true } : stand)) });
    const a1 = narrowA1.find(item => item.id === 'A1').geometry;
    expect(haversineM(a1.polygon[0], a1.polygon[1])).toBeGreaterThan(STAND_BOX.C.widthM + 2);
    const inner = buildStandFeatures(narrowA1, { nowMs: NOW }).aux.features.find(line => line.id === 'narrowInner:A1');
    expect(inner.properties).toEqual({ id: 'narrowInner:A1', kind: 'narrowInner', code: 'A1' });
    expect(inner.geometry.coordinates).toEqual(standBox(a1.center, a1.headingTrue, 'C'));
    expect(haversineM(inner.geometry.coordinates[0], inner.geometry.coordinates[1])).toBeCloseTo(STAND_BOX.C.widthM, 1);
  });

  it('one chip per terminal, «A · 3/16», marked when a stand of it reads «Llegando»', () => {
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
    const { board } = createRampScenario(NOW);
    const today = buildStandFeatures(positionsOf(board), { nowMs: NOW });
    expect(today.groups.features[0].properties).toMatchObject({ text: 'A · 4/16', arriving: true });
  });

  it('diffStandFeatures returns only what changed, and null when nothing changed', () => {
    const { board, flightsByTurnaround, features: before } = scenario();
    const build = stands => buildStandFeatures(positionsOf({ ...board, positions: stands }, { flightsByTurnaround }), { nowMs: NOW });
    // A re-read of the same board, in new objects, changes nothing.
    expect(diffStandFeatures(before, build(createRampScenario(NOW).board.positions))).toBeNull();
    expect(diffStandFeatures(before, before)).toBeNull();
    expect(STAND_FEATURE_COLLECTIONS).toEqual(['polygons', 'aux', 'labels', 'groups', 'footprints']);
    expect(STAND_FEATURE_KEYS).toEqual({ polygons: 'code', aux: 'id', labels: 'code', groups: 'terminal', footprints: 'id' });

    // A1 gets a planned flight: its polygon, its lead-in and its label change, and nothing else.
    const planned = build(board.positions.map(stand => (stand.code === 'A01'
      ? boardStand('A01', { coveredBy: [marta], turnarounds: [boardVisit({ nowMs: NOW, flight: 'DM501', arrivalInMin: 120 })] })
      : stand)));
    const diff = diffStandFeatures(before, planned);
    expect(diff.groups).toBeNull();
    // Only the property that changed: MapLibre 6.16 drops the properties that come with removeAllProperties.
    expect(diff.polygons).toEqual({ add: [], remove: [], update: [{ id: 'A1', addOrUpdateProperties: [{ key: 'state', value: 'planned' }] }] });
    expect(diff.aux.update.map(item => item.id)).toEqual(['leadIn:A1']);
    expect(diff.labels.update.map(item => item.id)).toEqual(['A1']);
    expect(diff.labels.update[0].addOrUpdateProperties.map(item => item.key)).toEqual(expect.arrayContaining(['state', 'label2', 'label3']));
    expect(diff.labels.update[0].addOrUpdateProperties.map(item => item.key)).not.toContain('code');
    for (const update of Object.values(diff).filter(Boolean).flatMap(collection => collection.update)) {
      expect(update, update.id).not.toHaveProperty('removeAllProperties');
    }
    // A property that goes is named in removeProperties.
    const withExtra = { ...before.polygons, features: before.polygons.features.map(item => (item.id === 'A1'
      ? { ...item, properties: { ...item.properties, extra: true } } : item)) };
    expect(diffFeatureCollections(withExtra, before.polygons).update).toEqual([{ id: 'A1', removeProperties: ['extra'] }]);

    // OCC places A1 20 m east: its box and label move; the label's texts stay as they were.
    const [longitude, latitude] = destinationPoint(MDPC_LAYOUT.stands.find(stand => stand.code === 'A1').center, 90, 20);
    const placed = build(board.positions.map(stand => (stand.code === 'A01' ? { ...stand, latitude, longitude } : stand)));
    const moved = diffStandFeatures(before, placed);
    expect(moved.polygons.update).toEqual([{
      id: 'A1', newGeometry: expect.objectContaining({ type: 'Polygon' }), addOrUpdateProperties: [{ key: 'unofficial', value: false }],
    }]);
    expect(moved.labels.update).toEqual([{ id: 'A1', newGeometry: { type: 'Point', coordinates: [longitude, latitude] } }]);

    // A stand that is no longer drawn is removed, and comes back as an addition; its terminal's chip changes.
    const fewer = buildStandFeatures(positionsOf(board, { flightsByTurnaround }).filter(item => item.id !== 'B22'), { nowMs: NOW });
    const removal = diffStandFeatures(before, fewer);
    expect(removal.polygons).toEqual({ add: [], remove: ['B22'], update: [] });
    expect(removal.labels.remove).toEqual(['B22']);
    expect(removal.aux.remove).toEqual(['leadIn:B22']);
    expect(removal.groups.update.map(item => item.id)).toEqual(['B']);
    expect(removal.groups.update[0].addOrUpdateProperties).toContainEqual({ key: 'text', value: 'B · 1/16' });
    expect(diffStandFeatures(fewer, before).polygons.add.map(item => item.id)).toEqual(['B22']);
    // Without a previous build every feature is added.
    expect(diffStandFeatures(null, before).polygons).toEqual({ add: before.polygons.features, remove: [], update: [] });
    expect(diffFeatureCollections(undefined, undefined)).toBeNull();
  });

  it('countdown texts change on the minute, never in between, and touch only the labels', () => {
    const stand = boardStand('A05', { coveredBy: [marta], turnarounds: [boardVisit({ nowMs: NOW, flight: 'DM601', arrivalInMin: 40.5 })] });
    // The screen read the stand once; the map counts down on its own minute.
    const positions = positionsOf({ positions: [stand], asOf: new Date(NOW).toISOString() });
    const at = ms => buildStandFeatures(positions, { nowMs: ms });
    const label3 = features => propertiesOf(features.labels, 'A5').label3;
    expect(label3(at(NOW))).toBe('A5\nDM601\nLlega 14:47 · en 41 min · MC');
    for (const offset of [1, 30 * 1000, MINUTE - 1]) expect(diffStandFeatures(at(NOW), at(NOW + offset))).toBeNull();
    expect(label3(at(NOW + MINUTE))).toBe('A5\nDM601\nLlega 14:47 · en 40 min · MC');
    const diff = diffStandFeatures(at(NOW), at(NOW + MINUTE));
    expect(diff).toMatchObject({ polygons: null, aux: null, groups: null });
    expect(diff.labels.update.map(item => item.id)).toEqual(['A5']);
    // Once due, the time stays without a countdown.
    expect(label3(at(NOW + 41 * MINUTE))).toBe('A5\nDM601\nLlega 14:47 · MC');
  });

  it('what is in sight: the stands whose box meets the view, and the features of a collection there', () => {
    const { positions, features } = scenario();
    const a1 = positions.find(item => item.id === 'A1').geometry;
    const box = boxOfPoints(a1.polygon);
    expect(box[0][0]).toBeLessThan(box[1][0]);
    expect(boxOfPoints([[Number.NaN, 1], null])).toBeNull();
    // A view over A1 only: A1 is in sight, and so is any stand whose box reaches into it.
    const view = [[a1.center[0] - 0.00005, a1.center[1] - 0.00005], [a1.center[0] + 0.00005, a1.center[1] + 0.00005]];
    const inSight = standsDrawnIn(positions, view).map(item => item.id);
    expect(inSight).toContain('A1');
    expect(inSight.every(code => boxesMeet(boxOfPoints(positions.find(item => item.id === code).geometry.polygon), view))).toBe(true);
    expect(inSight.length).toBeLessThan(3);
    // Without bounds every drawn stand; a stand without a geometry or retired never.
    expect(standsDrawnIn([...positions, { id: 'Z1', geometry: null }, { ...positions[0], retired: true }]))
      .toHaveLength(positions.filter(item => item.geometry !== null).length);
    expect(featuresIn(features.labels, view).map(item => item.id)).toEqual(['A1']);
    expect(featuresIn(features.aux, null, { kind: 'combinedLink' }).map(item => item.id)).toEqual(['combinedLink:A10']);
    expect(featuresIn(features.polygons, [[-70.6, 19.4], [-70.5, 19.5]])).toEqual([]);
    expect(boxesMeet(null, view)).toBe(false);
  });

  it('never imports the dataset (source text guard)', () => {
    expect(readFileSync('src/features/maps/stands/standFeatures.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});

// The stands fed by the map flights and the aircraft positions (PR M6, design D1 to D3): the scenario's ramp with the
// legs of DM205 on A4 (an A320 with five milestones recorded) and DM211 on A9 (its aircraft standing in the box with no
// arrival recorded), next to the demo flight on A6.
describe('buildStandFeatures with the map flights (PR M6)', () => {
  const ago = minutes => new Date(NOW - minutes * MINUTE).toISOString();
  const recorded = ['BLOCK_ON', 'WALKAROUND_START', 'WALKAROUND_END', 'STAIRS_JETBRIDGE', 'FIRST_CUSTOMS']
    .map((code, index) => ({ code, actualAt: ago(28 - index) }));
  const legsOf = (flight, next, { milestones = [], aircraft = { registration: null, typeIcaoCode: 'A320', model: null, sizeCategory: 'Narrowbody' }, departureInMin = 60 } = {}) => [
    { direction: 'Arrival', flightNumber: flight, phase: 'landed', actualAt: ago(30), actualKind: 'Runway', aircraft, milestones },
    { direction: 'Departure', flightNumber: next, phase: 'scheduled', scheduledAt: new Date(NOW + departureInMin * MINUTE).toISOString(),
      aircraft, milestones },
  ];
  function fed({ nowMs = NOW, standing = true } = {}) {
    const { board, flightsByTurnaround } = createRampScenario(NOW);
    const base = positionsOf(board);
    const a9 = base.find(item => item.id === 'A9').geometry.center;
    const flights = {
      ...flightsByTurnaround,
      'turn-DM205': legsOf('DM205', 'DM206', { milestones: recorded }),
      'turn-DM211': legsOf('DM211', 'DM212', { departureInMin: 120 }),
    };
    const aircraft = standing ? { 'turn-DM211': { position: a9, onGround: true, gsMs: 0, quality: 'live' } } : {};
    const positions = positionsOf(board, { nowMs, flightsByTurnaround: flights, aircraftByTurnaround: aircraft });
    return { positions, features: buildStandFeatures(positions, { nowMs }) };
  }
  const byId = (collection, id) => collection.features.find(item => item.id === id);

  it('footprints: the aircraft to scale, solid on its stand and dashed while it comes, only with a type to draw', () => {
    const { positions, features } = fed();
    const find = code => positions.find(item => item.id === code);
    // A4 and A9 have their A320 on the stand; the demo flight's B38M comes to A6 in 3 minutes.
    expect(features.footprints.features.map(item => [item.id, item.properties.kind, item.properties.state])).toEqual([
      ['footprint:A4', 'solid', 'occupied'], ['footprint:A6', 'planned', 'arriving'], ['footprint:A9', 'solid', 'occupied'],
    ]);
    for (const item of features.footprints.features) {
      const code = item.properties.code;
      expect(item.properties, code).toEqual({ id: item.id, code, kind: item.properties.kind, state: find(code).displayStatus });
      expect(item.geometry, code).toEqual({
        type: 'Polygon', coordinates: [aircraftFootprint(find(code).display.typeSpec, find(code).geometry.center, find(code).geometry.headingTrue)],
      });
    }
    expect(find('A6').display.typeSpec).toBe(AIRCRAFT_TYPES.B38M);
    // The label point says which: a stand with its aircraft drawn solid keeps no glyph from the codes on.
    expect(propertiesOf(features.labels, 'A4')).toMatchObject({ glyph: 'aircraft', footprint: 'solid' });
    expect(propertiesOf(features.labels, 'A6')).toMatchObject({ glyph: null, footprint: 'planned' });
    // A5's aircraft has no map flight, so no type: its glyph stays.
    expect(propertiesOf(features.labels, 'A5')).toMatchObject({ glyph: 'aircraft', footprint: null });
    // Three minutes later the demo aircraft is on A6: its footprint turns solid, nothing else of it moves.
    const later = fed({ nowMs: NOW + 3 * MINUTE }).features;
    const diff = diffFeatureCollections(features.footprints, later.footprints);
    expect(diff).toEqual({ add: [], remove: [], update: [{ id: 'footprint:A6', addOrUpdateProperties: [
      { key: 'kind', value: 'solid' }, { key: 'state', value: 'occupied' },
    ] }] });
    // Without the map flights the screens draw no aircraft to scale.
    expect(scenario().features.footprints.features.map(item => item.id)).toEqual(['footprint:A6']);
    expect(buildStandFeatures(positionsOf(createRampScenario(NOW).board), { nowMs: NOW }).footprints.features).toEqual([]);
  });

  it('the progress bar runs along the rear edge: the whole track and the milestones done, out of 25', () => {
    const { positions, features } = fed();
    const a4 = positions.find(item => item.id === 'A4');
    expect(byId(features.aux, 'progressTrack:A4')).toEqual({
      type: 'Feature', id: 'progressTrack:A4',
      properties: { id: 'progressTrack:A4', kind: 'progressTrack', code: 'A4', done: 5, total: 25 },
      geometry: { type: 'LineString', coordinates: progressSegment(a4.geometry.polygon, a4.geometry.headingTrue, 1) },
    });
    expect(byId(features.aux, 'progressDone:A4').geometry.coordinates)
      .toEqual(progressSegment(a4.geometry.polygon, a4.geometry.headingTrue, 5 / 25));
    // A9 has nothing recorded yet: the track alone. A stand that waits for its aircraft, or whose milestones nobody
    // knows, has no bar.
    expect(byId(features.aux, 'progressTrack:A9').properties).toMatchObject({ done: 0, total: 25 });
    expect(byId(features.aux, 'progressDone:A9')).toBeUndefined();
    const withBar = features.aux.features.filter(item => item.properties.kind === 'progressTrack').map(item => item.properties.code);
    expect(withBar).toEqual(['A4', 'A9']);
    // It never carries a colour or a time of its own: what it draws is the count.
    expect(Object.keys(byId(features.aux, 'progressDone:A4').properties).sort()).toEqual(['code', 'done', 'id', 'kind', 'total']);
  });

  it('progressSegment: inside the box, 4 m from its tail side, reading west to east or south to north', () => {
    const { positions } = fed();
    const a1 = positions.find(item => item.id === 'A1').geometry;
    const [start, end] = progressSegment(a1.polygon, a1.headingTrue, 1);
    const along = point => {
      const [x, y] = toEnu(a1.center, point);
      const radians = (a1.headingTrue * Math.PI) / 180;
      return x * Math.sin(radians) + y * Math.cos(radians);
    };
    // A1's nose points south (174.8°): its tail side is the north one, the bar 4 m inside it, 80 % of its 60 m width.
    expect(along(start) - Math.min(...a1.polygon.map(along))).toBeCloseTo(PROGRESS_INSET.rearM, 0);
    expect(along(end)).toBeCloseTo(along(start), 1);
    expect(Math.abs(haversineM(start, end) - 60 * (1 - 2 * PROGRESS_INSET.sideShare))).toBeLessThan(1.5);
    expect(start[0]).toBeLessThan(end[0]);
    expect(pointInPolygon(start, a1.polygon) && pointInPolygon(end, a1.polygon)).toBe(true);
    // A share runs from the same start; nothing past the ends.
    const [from, stop] = progressSegment(a1.polygon, a1.headingTrue, 0.36);
    expect(from).toEqual(start);
    expect(haversineM(from, stop)).toBeCloseTo(0.36 * haversineM(start, end), 1);
    expect(progressSegment(a1.polygon, a1.headingTrue, 3)).toEqual([start, end]);
    // A stand facing east has its rear edge across north and south: it reads from the south.
    const east = standBox(a1.center, 90, 'C');
    const [south, north] = progressSegment(east, 90, 1);
    expect(south[1]).toBeLessThan(north[1]);
    for (const bad of [[null, 90, 1], [east, null, 1], [east, 90, Number.NaN], [[a1.center], 90, 1]]) {
      expect(progressSegment(...bad)).toBeNull();
    }
  });

  it('a stand with its aircraft standing in it and no arrival recorded says so on its full label, with the notice', () => {
    const { features } = fed();
    const a9 = propertiesOf(features.labels, 'A9');
    expect(a9).toMatchObject({ state: 'occupied', signal: 'notice', sortKey: -3 });
    expect(a9.label3).toBe('A9\nDM212 · A320\nSale 16:07 · en 120 min · AR\nEl avión ya está en la posición. Registra la llegada.');
    // Only the full label: the code and the flight stay as they were.
    expect(a9.label2).toBe('A9\nDM212');
    // Past the stand's own signal, which keeps its place: A4's conflict, which has no notice.
    expect(propertiesOf(features.labels, 'A4')).toMatchObject({ signal: 'urgent' });
    expect(propertiesOf(features.labels, 'A4').label3).not.toMatch(/Registra la llegada/);
    // In English; and gone once the aircraft is not standing there.
    const english = buildStandFeatures(fed().positions, { nowMs: NOW, language: 'en' });
    expect(propertiesOf(english.labels, 'A9').label3).toMatch(/\nThe aircraft is already on the stand\. Record its arrival\.$/);
    expect(propertiesOf(fed({ standing: false }).features.labels, 'A9')).toMatchObject({ signal: null });
  });

  it('parkedAircraftIds: the ELEVANT aircraft standing in the box of the stand that shows it', () => {
    const { positions } = fed();
    const centre = code => positions.find(item => item.id === code).geometry.center;
    const aircraft = (id, turnaroundId, point, extra = {}) => ({
      id, kind: 'aviam', turnaroundId, lon: point[0], lat: point[1], onGround: true, gsMs: 0, ...extra,
    });
    const parked = parkedAircraftIds([
      aircraft('f:a4', 'turn-DM205', centre('A4')),
      aircraft('f:a9', 'turn-DM211', centre('A9'), { gsMs: null }),
      // Moving, in the air, outside its box, at another stand, on a stand still to come, other traffic: not parked.
      aircraft('f:moving', 'turn-DM205', centre('A4'), { gsMs: 3 }),
      aircraft('f:air', 'turn-DM211', centre('A9'), { onGround: false }),
      aircraft('f:out', 'turn-DM205', destinationPoint(centre('A4'), 0, 300)),
      aircraft('f:elsewhere', 'turn-DM205', centre('A9')),
      aircraft('f:a6', 'turn-ZZ9001', centre('A6')),
      { ...aircraft('h:other', 'turn-DM205', centre('A4')), kind: 'other' },
    ], positions);
    expect([...parked].sort()).toEqual(['f:a4', 'f:a9']);
    // A stand that reads an aircraft on it shows it even without its type (its glyph): with the board alone, A4 too.
    expect([...parkedAircraftIds([aircraft('f:a4', 'turn-DM205', centre('A4'))], scenario().positions)]).toEqual(['f:a4']);
    // Nothing without stands, or without aircraft.
    expect(parkedAircraftIds(undefined, positions).size).toBe(0);
    expect(parkedAircraftIds([aircraft('f:a4', 'turn-DM205', centre('A4'))], null).size).toBe(0);
  });
});
