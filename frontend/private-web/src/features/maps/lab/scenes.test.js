import { describe, expect, it } from 'vitest';
import { importClosure } from '../../../styles/occSourceScan';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { VIEW_NAMES, presetTargets, targetFor } from '../core/cameraPresets';
import { STAND_REFERENCE } from '../stands/standReference';
import { legendEntries } from '../ui/legendEntries';
import { BASEMAP_MODES, SCENES, SCENE_KINDS, findScene, labInstant, labStands, readLabQuery } from './scenes';

const statusOf = (stands, code) => stands.find(stand => stand.id === code)?.status;
const legendOf = stands => legendEntries({ stands }).states;

describe('map lab scenes', () => {
  it('every scene id is unique, names a known view and kind and uses only the seven stand states', () => {
    const ids = SCENES.map(scene => scene.id);
    expect(ids).toEqual([
      'ramp-points', 'ramp-selected', 'airfield', 'approach', 'region', 'unavailable-fallback', 'basemap-degraded',
      'layout-qa',
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
      expect(scene.stands.every(stand => STAND_STATE_KEYS.includes(stand.status)), scene.id).toBe(true);
      expect(Object.isFrozen(scene) && Object.isFrozen(scene.stands[0]), scene.id).toBe(true);
    }
    expect(findScene('ramp-selected').selection).toEqual({ kind: 'stand', id: 'A5' });
    expect(SCENES.filter(scene => scene.selection !== null).map(scene => scene.id)).toEqual(['ramp-selected']);
    expect(findScene('unavailable-fallback').webgl).toBe(false);
    expect(SCENES.filter(scene => !scene.webgl).map(scene => scene.id)).toEqual(['unavailable-fallback']);
    expect(findScene('basemap-degraded').basemap).toBe('cut');
    expect(findScene('region').view).toBe('region');
    expect(findScene('nope')).toBeNull();
  });

  it('scene stands are the 41 reference stands with deterministic states', () => {
    const stands = labStands();
    expect(stands).toHaveLength(41);
    expect(stands.map(stand => stand.id)).toEqual(STAND_REFERENCE.map(stand => stand.code));
    expect(stands.map(stand => stand.id)).not.toContain('B33');
    expect(stands[0]).toEqual({
      id: 'A1', terminal: 'A', latitude: STAND_REFERENCE[0].latitude, longitude: STAND_REFERENCE[0].longitude,
      status: 'occupied', locationSource: 'reference',
    });
    // The same states on every call, by the place of the stand inside its terminal.
    expect(labStands()).toEqual(stands);
    expect(['A1', 'A2', 'A3', 'A4', 'A5', 'A6', 'A9', 'AN1'].map(code => statusOf(stands, code)))
      .toEqual(['occupied', 'available', 'planned', 'arriving', 'occupied', 'releasing', 'occupied', 'arriving']);
    expect(['B20', 'B21', 'B22', 'B23', 'B26', 'B32', 'B34'].map(code => statusOf(stands, code)))
      .toEqual(['available', 'occupied', 'disabled', 'planned', 'available', 'available', 'occupied']);
    expect(['BN6', 'BN7', 'BN8', 'BN13'].map(code => statusOf(stands, code)))
      .toEqual(['available', 'unverified', 'available', 'unverified']);
    // Every state is on the ramp, and every map scene draws these same stands.
    expect(legendOf(stands)).toEqual(STAND_STATE_KEYS);
    for (const scene of SCENES.filter(item => item.kind === 'map')) expect(scene.stands, scene.id).toEqual(stands);
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
      selection: null,
      basemap: 'on',
      webgl: true,
    });
    expect(Object.isFrozen(review) && Object.isFrozen(review.stands)).toBe(true);
    expect(SCENES.filter(scene => scene.kind !== 'map').map(scene => scene.id)).toEqual(['layout-qa']);
    expect(readLabQuery('scene=layout-qa&basemap=none')).toMatchObject({ scene: review, basemap: 'none' });
    // Only the lab's route reaches the lab: every other route of the app, followed through all its imports, never
    // does, and app/map-lab/page.jsx imports the lab inside its development branch (scripts/verify-map-chunks.mjs).
    const reached = importClosure(['app'], { stops: ['app/map-lab/page.jsx', 'app/map-lab/MapLabLoader.jsx'] });
    expect(reached).toContain('app/map-lab/page.jsx');
    expect(reached.filter(file => file.startsWith('src/features/maps/lab/'))).toEqual([]);
  });

  it('each terminal view frames its own stands and a part of the legend of its own', () => {
    const stands = labStands();
    const ofTerminal = terminal => stands.filter(stand => stand.terminal === terminal);
    expect(legendOf(ofTerminal('A'))).toEqual(['available', 'planned', 'arriving', 'occupied', 'releasing']);
    expect(legendOf(ofTerminal('B'))).toEqual(['available', 'planned', 'occupied', 'disabled']);
    expect(legendOf(ofTerminal('FBO'))).toEqual(['available', 'unverified']);
    // The terminal views the map frames from the airport layout, and those of the stand points without one.
    for (const targets of [presetTargets({ stands, layout: MDPC_LAYOUT }), presetTargets({ stands })]) {
      for (const terminal of ['A', 'B', 'FBO']) {
        const framed = legendEntries({ stands, bounds: targetFor(targets, 'ramp', terminal).bounds });
        expect(framed.states, terminal).toEqual(legendOf(ofTerminal(terminal)));
        // Every stand sits at its reference location: the legend says «No oficial».
        expect(framed.tags, terminal).toEqual(['unofficial']);
      }
    }
  });

  it('reads the scene, the base map and the frozen clock from the URL', () => {
    const noon = Date.UTC(2026, 10, 13, 15);
    expect(readLabQuery('scene=ramp-points&t=2026-11-13T15:00:00Z')).toEqual({
      sceneId: 'ramp-points', scene: findScene('ramp-points'), basemap: 'on', frozenAt: noon,
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
