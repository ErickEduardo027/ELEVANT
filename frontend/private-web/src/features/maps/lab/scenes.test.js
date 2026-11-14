import { describe, expect, it } from 'vitest';
import { importClosure } from '../../../styles/occSourceScan';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { haversineM } from '../airport/geo';
import { MAX_TRANSLATION_M } from '../airport/standGeometry';
import { VIEW_NAMES, presetTargets, targetFor } from '../core/cameraPresets';
import { PLACING_SNAP_M } from '../stands/placing';
import { buildStandFeatures } from '../stands/standFeatures';
import { attachStandGeometry, withStandDisplay } from '../stands/standModel';
import { STAND_REFERENCE } from '../stands/standReference';
import { SCENARIO_AGENTS } from '../testing/mapFixtures';
import { legendEntries } from '../ui/legendEntries';
import {
  BASEMAP_MODES, PLACING_OFFSET_M, PLACING_STAND, SCENES, SCENE_INSTANT, SCENE_KINDS, findScene, labInstant, labStands,
  readLabQuery,
} from './scenes';

// The lab's stands as the map lab shows them: read at the scene's instant (useStandDisplay).
const shown = () => withStandDisplay(labStands(), { nowMs: SCENE_INSTANT });
const byId = (stands, code) => stands.find(stand => stand.id === code);
const legendOf = stands => legendEntries({ stands }).states;

describe('map lab scenes', () => {
  it('every scene id is unique, names a known view and kind and reads at a fixed instant', () => {
    const ids = SCENES.map(scene => scene.id);
    expect(ids).toEqual([
      'ramp-states', 'ramp-selected', 'ramp-combined-selected', 'ramp-placing-ghost', 'airfield', 'approach', 'region',
      'unavailable-fallback', 'basemap-degraded', 'layout-qa',
    ]);
    expect(new Set(ids).size).toBe(ids.length);
    for (const scene of SCENES) {
      expect(VIEW_NAMES, scene.id).toContain(scene.view);
      expect(SCENE_KINDS, scene.id).toContain(scene.kind);
      expect(BASEMAP_MODES, scene.id).toContain(scene.basemap);
      expect(typeof scene.webgl, scene.id).toBe('boolean');
      // Sentence case with a capital, and a full sentence below it.
      expect(scene.title, scene.id).toMatch(/^\p{Lu}/u);
      expect(scene.title, scene.id).not.toMatch(/^\p{Lu}{2,}/u);
      expect(scene.description, scene.id).toMatch(/^\p{Lu}.*\.$/u);
      expect(scene.at, scene.id).toBe(scene.kind === 'map' ? SCENE_INSTANT : null);
      expect(Object.isFrozen(scene), scene.id).toBe(true);
    }
    // 11:00 in Punta Cana, the frozen clock of the visual suite.
    expect(new Date(SCENE_INSTANT).toISOString()).toBe('2026-11-13T15:00:00.000Z');
    expect(findScene('ramp-selected').selection).toEqual({ kind: 'stand', id: 'A5' });
    expect(findScene('ramp-combined-selected').selection).toEqual({ kind: 'stand', id: 'A10' });
    expect(SCENES.filter(scene => scene.selection !== null).map(scene => scene.id))
      .toEqual(['ramp-selected', 'ramp-combined-selected', 'ramp-placing-ghost']);
    // One scene places a stand; every other places nothing.
    expect(SCENES.filter(scene => scene.placing !== null).map(scene => scene.id)).toEqual(['ramp-placing-ghost']);
    expect(findScene('unavailable-fallback').webgl).toBe(false);
    expect(SCENES.filter(scene => !scene.webgl).map(scene => scene.id)).toEqual(['unavailable-fallback']);
    expect(findScene('basemap-degraded').basemap).toBe('cut');
    expect(findScene('ramp-points')).toBeNull();
    expect(findScene('nope')).toBeNull();
  });

  it('ramp-states has all seven states, a combined pair, covered and uncovered stands, all synthetic', () => {
    const stands = shown();
    // The 41 reference stands in catalogue order, at their reference location (no coordinate of their own).
    expect(stands.map(stand => stand.id)).toEqual(STAND_REFERENCE.map(stand => stand.code));
    for (const stand of stands) {
      const reference = STAND_REFERENCE.find(item => item.code === stand.id);
      expect([stand.longitude, stand.latitude], stand.id).toEqual([reference.longitude, reference.latitude]);
      expect(stand.locationSource, stand.id).toBe('reference');
    }
    // Every map scene draws these same stands, frozen.
    for (const scene of SCENES.filter(item => item.kind === 'map')) {
      expect(scene.stands, scene.id).toEqual(labStands());
      expect(Object.isFrozen(scene.stands[0]), scene.id).toBe(true);
    }
    // The seven states, read at the scene's instant.
    const state = code => byId(stands, code).displayStatus;
    expect(new Set(stands.map(stand => stand.displayStatus))).toEqual(new Set(STAND_STATE_KEYS));
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A10', 'B21', 'B25', 'BN13'].map(state)).toEqual([
      'available', 'planned', 'arriving', 'occupied', 'releasing', 'arriving', 'disabled', 'releasing', 'arriving', 'unverified',
    ]);
    expect(legendOf(stands)).toEqual(STAND_STATE_KEYS);
    // A combined pair: A10 cancelled by A9, linked on the map.
    expect(byId(stands, 'A10').display.cancelledBy).toBe('A9');
    const features = buildStandFeatures(attachStandGeometry(stands, MDPC_LAYOUT), { nowMs: SCENE_INSTANT });
    expect(features.aux.features.filter(line => line.properties.kind === 'combinedLink').map(line => line.id)).toEqual(['combinedLink:A10']);
    // A8 limited to narrow-body aircraft, with its code-C box inside it.
    expect(features.aux.features.filter(line => line.properties.kind === 'narrowInner').map(line => line.id)).toEqual(['narrowInner:A8']);
    // Covered and uncovered stands: A3 and B35 have a flight due within the hour and nobody covering them.
    const signals = Object.fromEntries(stands.filter(stand => stand.signals.length > 0)
      .map(stand => [stand.id, stand.signals.map(signal => `${signal.kind}:${signal.reason}`)]));
    expect(signals).toEqual({
      A3: ['attention:uncovered'], A4: ['urgent:conflict'], B21: ['attention:overdue'], B35: ['attention:uncovered'],
    });
    expect(byId(stands, 'A1').coveredBy).toEqual([SCENARIO_AGENTS.marta]);
    expect(byId(stands, 'AN1').coveredBy).toEqual([]);
    // The demo flight is labelled «Demo».
    expect(features.labels.features.find(label => label.id === 'A6').properties.label2).toBe('A6\nZZ9001 · Demo');
    // Synthetic: invented flights, registrations, airline and agents.
    const visits = stands.flatMap(stand => stand.turnarounds);
    expect(visits.length).toBeGreaterThan(15);
    for (const visit of visits) {
      expect(visit.arrivalFlightNumber, visit.turnaroundId).toMatch(/^(?:DM2\d\d|ZZ9001)$/);
      expect(visit.aircraftRegistration, visit.turnaroundId).toMatch(/^HI\d{4}$/);
      expect(visit.airlineName).toBe('Aerolínea de prueba');
    }
    const agents = new Set(Object.values(SCENARIO_AGENTS));
    expect(stands.flatMap(stand => stand.coveredBy ?? []).every(name => agents.has(name))).toBe(true);
  });

  it('the layout-qa scene is development-only data with a known view', () => {
    const review = findScene('layout-qa');
    expect(review).toEqual({
      id: 'layout-qa',
      kind: 'layout-qa',
      title: 'Revisión del plano de MDPC',
      description: expect.stringMatching(/^El plano generado .*\.$/u),
      view: 'airfield',
      // It draws the airport layout itself, not stands with states.
      stands: [],
      at: null,
      selection: null,
      basemap: 'on',
      webgl: true,
      placing: null,
    });
    expect(Object.isFrozen(review) && Object.isFrozen(review.stands)).toBe(true);
    expect(SCENES.filter(scene => scene.kind !== 'map').map(scene => scene.id)).toEqual(['layout-qa']);
    expect(readLabQuery('scene=layout-qa&basemap=none')).toMatchObject({ scene: review, basemap: 'none' });
    // Only the lab's route reaches the lab: every other route of the app, followed through all its imports, never
    // does, and app/map-lab/page.jsx imports the lab inside its development branch (scripts/verify-map-chunks.mjs).
    const reached = importClosure(['app'], { stops: ['app/map-lab/page.jsx', 'app/map-lab/MapLabLoader.jsx'] });
    expect(reached).toContain('app/map-lab/page.jsx');
    expect(reached.filter(file => file.startsWith('src/features/maps/lab/'))).toEqual([]);
    // Nor the fixtures the lab builds its board with.
    expect(reached).not.toContain('src/features/maps/testing/mapFixtures.js');
  });

  it('ramp-combined-selected selects the cancelled stand of the combined pair, and ramp-placing-ghost places a free stand', () => {
    const stands = shown();
    // A10 reads «Inhabilitada», cancelled by A9, and its agent covers other stands: the same-agent marks show.
    const cancelled = byId(stands, findScene('ramp-combined-selected').selection.id);
    expect(cancelled).toMatchObject({ id: 'A10', displayStatus: 'disabled', coveredBy: [SCENARIO_AGENTS.ana] });
    expect(cancelled.display.cancelledBy).toBe('A9');
    expect(stands.filter(stand => stand.id !== 'A10' && (stand.coveredBy ?? []).includes(SCENARIO_AGENTS.ana)).length)
      .toBeGreaterThan(2);

    // The placing scene: a free stand nobody covers, selected while it is placed, with a pending location south of its
    // reference point, past the snap and close enough for the layout's box to move rigidly there.
    const placing = findScene('ramp-placing-ghost');
    expect(placing.placing).toEqual({ code: PLACING_STAND, sizeHint: null, pending: expect.objectContaining({ snapped: false }) });
    expect(placing.selection).toEqual({ kind: 'stand', id: PLACING_STAND });
    expect(byId(stands, PLACING_STAND)).toMatchObject({ displayStatus: 'available', coveredBy: [] });
    const reference = STAND_REFERENCE.find(stand => stand.code === PLACING_STAND);
    const { latitude, longitude } = placing.placing.pending;
    const offset = haversineM([reference.longitude, reference.latitude], [longitude, latitude]);
    expect(offset).toBeCloseTo(PLACING_OFFSET_M, 0);
    expect(offset).toBeGreaterThan(PLACING_SNAP_M);
    expect(offset).toBeLessThan(MAX_TRANSLATION_M);
    expect(latitude).toBeLessThan(reference.latitude);
    expect(Object.isFrozen(placing.placing.pending)).toBe(true);
  });

  it('each terminal view frames its own stands and a part of the legend of its own', () => {
    const stands = shown();
    const ofTerminal = terminal => stands.filter(stand => stand.terminal === terminal);
    expect(legendOf(ofTerminal('A'))).toEqual(['available', 'planned', 'arriving', 'occupied', 'releasing', 'disabled']);
    expect(legendOf(ofTerminal('B'))).toEqual(['available', 'planned', 'arriving', 'occupied', 'releasing']);
    expect(legendOf(ofTerminal('FBO'))).toEqual(['available', 'planned', 'occupied', 'unverified']);
    // The terminal views the map frames from the airport layout.
    const targets = presetTargets({ stands, layout: MDPC_LAYOUT });
    for (const terminal of ['A', 'B', 'FBO']) {
      const framed = legendEntries({ stands: attachStandGeometry(ofTerminal(terminal), MDPC_LAYOUT), bounds: targetFor(targets, 'ramp', terminal).bounds });
      expect(framed.states, terminal).toEqual(legendOf(ofTerminal(terminal)));
      // Every stand sits at its reference location: the legend says «No oficial».
      expect(framed.tags, terminal).toEqual(['unofficial']);
    }
  });

  it('reads the scene, the base map and the frozen clock from the URL', () => {
    const noon = Date.UTC(2026, 10, 13, 15);
    expect(readLabQuery('scene=ramp-states&t=2026-11-13T15:00:00Z')).toEqual({
      sceneId: 'ramp-states', scene: findScene('ramp-states'), basemap: 'on', frozenAt: noon,
    });
    expect(readLabQuery(new URLSearchParams('scene=airfield&basemap=none')).basemap).toBe('none');
    expect(readLabQuery('scene=basemap-degraded').basemap).toBe('cut');
    expect(readLabQuery('scene=basemap-degraded&basemap=none').basemap).toBe('none');
    expect(readLabQuery('scene=airfield&basemap=off').basemap).toBe('on');
    expect(readLabQuery('scene=nope')).toEqual({ sceneId: 'nope', scene: null, basemap: 'on', frozenAt: null });
    expect(readLabQuery('')).toEqual({ sceneId: null, scene: null, basemap: 'on', frozenAt: null });

    expect(labInstant('2026-11-13T11:00:00-04:00')).toBe(noon);
    expect(labInstant('2026-11-13T15:00Z')).toBe(noon);
    expect(labInstant('2026-11-13T15:00:00.250Z')).toBe(noon + 250);
    for (const text of ['2026-11-13', '2026-11-13T15:00:00', '2026-11-13T25:00:00Z', 'mañana', '', null, 1763046000000]) {
      expect(labInstant(text), String(text)).toBeNull();
    }
  });
});
