import { Box3, Vector3 } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { THREE_PARTS } from './aircraft3dChunk';
import {
  BLINK, FUSELAGE_TEXTURE, PROPELLER_BLADES, TAIL_TEXTURE, WINGTIPS, beaconOn, buildDetailedAircraft, mainWheelsOf,
  nextBlinkInMs, paintFuselage, paintTail, strobeOn,
} from './aircraftDetail';
import { DEFAULT_LIVERY, LIVERIES } from './liveries';
import { AIRCRAFT_TYPES } from './types';

// The detailed 3D aircraft (CN-30) with the real three in Node: no canvas here, so the models wear their livery's plain
// colours; the painting is checked on a recording 2D context.
const AIRLINERS = Object.entries(AIRCRAFT_TYPES).filter(([, spec]) => !['helicopter', 'pistonSingle'].includes(spec.family));
// Each type's model is built once for the checks that only read it.
const built = new Map();
const build = (code, options = null) => {
  const make = () => buildDetailedAircraft(THREE_PARTS, AIRCRAFT_TYPES[code], { code, livery: LIVERIES.CMP, ...options });
  if (options !== null) return make();
  if (!built.has(code)) built.set(code, make());
  return built.get(code);
};

// The box of a model without its lights and their halos.
function airframeBox(model) {
  model.object.updateMatrixWorld(true);
  const box = new Box3();
  model.object.traverse(node => {
    if (node.isMesh && node.name !== 'light' && node.name !== 'halo') box.expandByObject(node);
  });
  return box;
}

const meshNamed = (model, name) => {
  let found = null;
  model.object.traverse(node => {
    if (node.isMesh && node.name === name) found = node;
  });
  return found;
};

describe('the detailed 3D aircraft (CN-30)', () => {
  it.each(AIRLINERS)('%s stands on its wheels at its length, span and height', code => {
    const spec = AIRCRAFT_TYPES[code];
    const model = build(code);
    const size = airframeBox(model).getSize(new Vector3());
    const box = airframeBox(model);
    // Within 3 % of the length and span, 2 % of the height; the wheels on the ground.
    expect(size.y / spec.lengthM, 'length').toBeGreaterThan(0.97);
    expect(size.y / spec.lengthM, 'length').toBeLessThan(1.03);
    expect(size.x / spec.spanM, 'span').toBeGreaterThan(0.97);
    expect(size.x / spec.spanM, 'span').toBeLessThan(1.03);
    expect(box.max.z / spec.heightM, 'height').toBeGreaterThan(0.98);
    expect(box.max.z / spec.heightM, 'height').toBeLessThan(1.02);
    expect(box.min.z).toBeGreaterThan(-0.01);
    expect(box.min.z).toBeLessThan(0.01);
    // A dozen draw calls and a modest number of triangles, for one aircraft.
    expect(model.triangles).toBeLessThan(30_000);
    expect(model.drawCalls).toBeLessThan(32);
  });

  it('hangs as many engines as the type has: four on a 747 and an A380, propellers on the turboprops', () => {
    for (const [code, spec] of AIRLINERS) expect(build(code).engines, code).toBe(spec.engines);
    expect(build('B744').engines).toBe(4);
    expect(build('A388').engines).toBe(4);
    const atr = build('AT76');
    expect(atr.propellers).toHaveLength(2);
    expect(PROPELLER_BLADES.AT76).toBe(6);
    expect(build('A320').propellers).toHaveLength(0);
  });

  it('carries the wingtip and the wheels of its family', () => {
    expect(WINGTIPS.A320).toBe('sharklet');
    expect(WINGTIPS.B38M).toBe('split');
    expect(WINGTIPS.B789).toBe('raked');
    expect(mainWheelsOf('A320', AIRCRAFT_TYPES.A320)).toBe(2);
    expect(mainWheelsOf('B789', AIRCRAFT_TYPES.B789)).toBe(4);
    expect(mainWheelsOf('B77W', AIRCRAFT_TYPES.B77W)).toBe(6);
    // A winglet rises above the wing: the sharklet of an A320 reaches higher than the wing of an A220 without one.
    const tipTop = code => {
      const box = new Box3().setFromObject(meshNamed(build(code), 'wing'));
      return box.max.z / AIRCRAFT_TYPES[code].spanM;
    };
    expect(tipTop('A320')).toBeGreaterThan(tipTop('BCS3') + 0.04);
  });

  it('shows or hides its gear, blinks its beacons and strobes and turns its propellers', () => {
    const model = build('AT76', {});
    model.setState({ gearDown: false, lights: { beacon: true, strobes: true }, timeMs: 0, propellerRpm: 1200 });
    expect(model.gear.visible).toBe(false);
    expect(model.lights.beacons[0].mesh.visible).toBe(true);
    expect(model.lights.beacons[1].mesh.visible).toBe(false);
    expect(model.lights.strobes.every(({ mesh }) => mesh.visible)).toBe(true);
    model.setState({ gearDown: true, lights: { beacon: true, strobes: true }, timeMs: 100, propellerRpm: 1200 });
    expect(model.gear.visible).toBe(true);
    expect(model.lights.strobes.every(({ mesh }) => !mesh.visible)).toBe(true);
    expect(model.propellers[0].mesh.rotation.y).toBeCloseTo((2 * Math.PI * 1200 * 0.1) / 60 % (2 * Math.PI), 6);
    // The navigation lights stay on; their halos glow by night only.
    model.setState({ lights: { beacon: false, strobes: false }, timeMs: 0, night: true });
    expect(model.lights.nav.every(({ mesh, glow }) => mesh.visible && glow.visible)).toBe(true);
    expect(model.lights.beacons.every(({ mesh }) => !mesh.visible)).toBe(true);
    model.setState({ lights: {}, timeMs: 0, night: false });
    expect(model.lights.nav.every(({ glow }) => !glow.visible)).toBe(true);
    model.dispose();
  });

  it('blinks on the published rhythm and says when it next changes', () => {
    expect(beaconOn(0)).toBe(true);
    expect(beaconOn(BLINK.beaconOnMs + 1)).toBe(false);
    expect(beaconOn(BLINK.beaconPeriodMs / 2, 0.5)).toBe(true);
    expect(strobeOn(10)).toBe(true);
    expect(strobeOn(100)).toBe(false);
    expect(strobeOn(170)).toBe(true);
    expect(nextBlinkInMs(0, {})).toBe(Infinity);
    expect(nextBlinkInMs(0, { beacon: true })).toBe(BLINK.beaconOnMs);
    expect(nextBlinkInMs(100, { strobes: true })).toBe(60);
  });

  it('paints its livery: body and belly, windows, the name ahead of the wing, the registration and the code on the fin', () => {
    const calls = [];
    const context = new Proxy({}, {
      get: (target, key) => (key in target ? target[key] : (...args) => calls.push([key, ...args])),
      set: (target, key, value) => {
        calls.push([`set:${String(key)}`, value]);
        target[key] = value;
        return true;
      },
    });
    paintFuselage(context, { ...FUSELAGE_TEXTURE, livery: LIVERIES.AAL, registration: 'ZZ-AAL2', spec: AIRCRAFT_TYPES.A321 });
    const texts = calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    // Both sides: the name twice, the registration twice.
    expect(texts.filter(text => text === 'AMERICAN')).toHaveLength(2);
    expect(texts.filter(text => text === 'ZZ-AAL2')).toHaveLength(2);
    const fills = calls.filter(([name]) => name === 'set:fillStyle').map(([, colour]) => colour);
    expect(fills).toEqual(expect.arrayContaining([LIVERIES.AAL.fuselage, LIVERIES.AAL.belly, LIVERIES.AAL.text]));
    // Dozens of cabin windows on each side.
    expect(calls.filter(([name]) => name === 'fill').length).toBeGreaterThan(60);

    calls.length = 0;
    const shape = { leading: v => 1 - 0.3 * v, trailing: v => 0.1 + 0.2 * v, chordRangeM: 9, heightM: 7 };
    paintTail(context, { ...TAIL_TEXTURE, livery: LIVERIES.CMP, shape });
    expect(calls.filter(([name]) => name === 'fillText').map(([, text]) => text)).toEqual(['CM', 'CM']);
    // A licensed logo replaces the code, on both sides.
    calls.length = 0;
    paintTail(context, { ...TAIL_TEXTURE, livery: LIVERIES.CMP, shape, logo: { width: 10, height: 10 } });
    expect(calls.filter(([name]) => name === 'drawImage')).toHaveLength(2);
    expect(calls.filter(([name]) => name === 'fillText')).toHaveLength(0);
  });

  it('wears canvas textures when it has canvases, and the plain livery colours otherwise', () => {
    const plain = build('A320', { livery: DEFAULT_LIVERY });
    expect(plain.textured).toBe(false);
    const context = new Proxy({}, { get: (target, key) => (key in target ? target[key] : () => {}),
      set: (target, key, value) => { target[key] = value; return true; } });
    const createCanvas = vi.fn((width, height) => ({ width, height, getContext: () => context }));
    const painted = build('B738', { createCanvas, registration: 'ZZ-CMP1' });
    expect(painted.textured).toBe(true);
    expect(createCanvas).toHaveBeenCalledWith(FUSELAGE_TEXTURE.width, FUSELAGE_TEXTURE.height);
    expect(createCanvas).toHaveBeenCalledWith(TAIL_TEXTURE.width, TAIL_TEXTURE.height);
    expect(meshNamed(painted, 'fuselage').material.map).toBeTruthy();
    expect(meshNamed(painted, 'fin').material.map).toBeTruthy();
    expect(meshNamed(painted, 'fuselage').geometry.getAttribute('uv')).toBeTruthy();
    painted.dispose();
  });

  it('pitches over its main wheels and banks about its fuselage', () => {
    const model = build('A320');
    expect(model.pivot.y).toBeLessThan(0);
    expect(model.pivot.y).toBeGreaterThan(-0.2 * AIRCRAFT_TYPES.A320.lengthM);
    expect(model.pivot.z).toBeGreaterThan(AIRCRAFT_TYPES.A320.fuselageDiaM * 0.5);
  });
});
