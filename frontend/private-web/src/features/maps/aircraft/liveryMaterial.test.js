// @vitest-environment node
import fs from 'node:fs';
import path from 'node:path';
import { ShaderLib } from 'three';
import { describe, expect, it, vi } from 'vitest';
import { THREE_PARTS } from './aircraft3dChunk';
import { MODELS_BASE_URL, createGltfModels } from './gltfModels';
import { DEFAULT_LIVERY, LIVERIES } from './liveries';
import {
  FIXED_ZONES, LIVERY_ATLAS, LIVERY_BANDS, LIVERY_GLSL, LIVERY_ROWS, LIVERY_ZONES, LOGO_MAX_PX, NAME_PLACE, createLiveryMaterial,
  createLiveryTextures, frameUniforms, injectLivery, letteringUv, liveryColours, liveryFrame, liveryPaletteData, liveryRow,
  liveryZone, nacelleSection, paintLiveryAtlas, sliceModel, tintLogo,
} from './liveryMaterial';
import { linearRgb } from './instancePlan';
import { nacelles } from './silhouette';
import { AIRCRAFT_TYPES } from './types';

// The liveries of the 3D models (PR M5): zones read from a model's own coordinates against its type's dimensions, the
// palette and lettering atlas every type shares, and the GLSL that does the same arithmetic per pixel.

const PUBLIC = path.resolve(process.cwd(), 'public');

// The vendored models, read from public/ as the browser would read them from the app's origin.
async function loadModel(code, level) {
  const fetchResource = async url => {
    const file = path.join(PUBLIC, url.replace(/^\//, ''));
    if (!fs.existsSync(file)) return { ok: false, status: 404 };
    const bytes = fs.readFileSync(file);
    return {
      ok: true,
      status: 200,
      json: async () => JSON.parse(bytes.toString('utf8')),
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
    };
  };
  let resolve;
  const loaded = new Promise(done => {
    resolve = done;
  });
  const models = createGltfModels({ three: THREE_PARTS, baseUrl: MODELS_BASE_URL, fetchResource, onLoad: resolve });
  await models.ready();
  models.get(code, level);
  await loaded;
  return models.get(code, level);
}

// A model's whole geometry (every part, as modelFrame reads it): its positions and triangles.
const positionsOf = model => model.geometry.getAttribute('position').array;
const indexOf = model => model.geometry.getIndex()?.array ?? null;

// Points of a model: those where `keep([x, y, z])` holds.
function pointsOf(positions, keep) {
  const points = [];
  for (let at = 0; at < positions.length; at += 3) {
    const point = [positions[at], positions[at + 1], positions[at + 2]];
    if (keep(point)) points.push(point);
  }
  return points;
}

// A frame by hand: a 40 m fuselage of radius 2 about z = 3, a fin from 5.2 m to 12 m, one nacelle per side at 6 m.
const FRAME = Object.freeze({
  halfLengthM: 20, yMinM: -20, axisZM: 3, radiusM: 2, halfWidthM: 2,
  fin: { rootZM: 3 + 1.08 * 2, topZM: 12, aftYM: -20, rootChordM: 6, markYM: -16, markZM: 8, markWidthM: 3 },
  name: { y0M: -2, lengthM: 14, z0M: 3.6, heightM: 1.2 },
  engines: [{ x: 6, z: 1.5, reachM: 1.2, y0M: 1, y1M: 5 }],
});

describe('liveryZone (pure)', () => {
  it('classifies a fuselage by height over its axis: belly, second cheatline, cheatline, upper body', () => {
    const at = c => [0.5, 0, FRAME.axisZM + c * FRAME.radiusM];
    expect(LIVERY_ZONES[liveryZone(at(-0.9), FRAME)]).toBe('belly');
    expect(LIVERY_ZONES[liveryZone(at(-0.3), FRAME)]).toBe('cheatline2');
    expect(LIVERY_ZONES[liveryZone(at(-0.1), FRAME)]).toBe('cheatline');
    expect(LIVERY_ZONES[liveryZone(at(0.5), FRAME)]).toBe('fuselage');
    expect(LIVERY_ZONES[liveryZone(at(1.0), FRAME)]).toBe('fuselage');
    // The bands' edges as LIVERY_BANDS sets them.
    expect(liveryZone(at(LIVERY_BANDS.belly - 0.001), FRAME)).toBe(3);
    expect(liveryZone(at(LIVERY_BANDS.cheatline2 - 0.001), FRAME)).toBe(1);
    expect(liveryZone(at(LIVERY_BANDS.cheatlineHigh + 0.001), FRAME)).toBe(0);
  });

  it('puts what stands out of the fuselage in the wing grey, the nacelles in the engine colour and the fin at the rear', () => {
    expect(LIVERY_ZONES[liveryZone([10, 0, 2], FRAME)]).toBe('wing');
    expect(LIVERY_ZONES[liveryZone([-10, -18, 5], FRAME)]).toBe('wing');
    // Within reach of the nacelle's axis, on both sides, along its length only.
    expect(LIVERY_ZONES[liveryZone([6.5, 3, 1.2], FRAME)]).toBe('engine');
    expect(LIVERY_ZONES[liveryZone([-6.5, 3, 1.2], FRAME)]).toBe('engine');
    expect(LIVERY_ZONES[liveryZone([6.5, 8, 1.2], FRAME)]).toBe('wing');
    // Above the crown at the rear: the fin, its accent across the lower trailing corner.
    expect(LIVERY_ZONES[liveryZone([0, -15, 11], FRAME)]).toBe('tail');
    expect(LIVERY_ZONES[liveryZone([0, -19.5, 5.5], FRAME)]).toBe('tailAccent');
    // Above the crown but ahead of the rear: no fin (a fairing or an antenna keeps the body's colour).
    expect(LIVERY_ZONES[liveryZone([0, 5, 5.3], FRAME)]).toBe('fuselage');
  });

  it('paints the cockpit\'s panes on the nose, above the axis', () => {
    const t = (LIVERY_BANDS.cockpitT0 + LIVERY_BANDS.cockpitT1) / 2;
    const c = (LIVERY_BANDS.cockpitC0 + LIVERY_BANDS.cockpitC1) / 2;
    const y = FRAME.yMinM + (t + 1) * FRAME.halfLengthM;
    expect(liveryZone([1, y, FRAME.axisZM + c * FRAME.radiusM], FRAME)).toBe(FIXED_ZONES.cockpit);
    expect(liveryZone([1, y, FRAME.axisZM - c * FRAME.radiusM], FRAME)).not.toBe(FIXED_ZONES.cockpit);
  });
});

describe('sliceModel and nacelleSection (pure)', () => {
  // A ring of `n` points of radius `r` about (x0, z0), extruded along y from y0 to y1 as quads of two triangles.
  function tube({ x0 = 0, z0 = 0, r = 1, y0 = -1, y1 = 1, n = 16 } = {}) {
    const positions = [];
    const index = [];
    for (const y of [y0, y1]) {
      for (let k = 0; k < n; k += 1) {
        const a = (2 * Math.PI * k) / n;
        positions.push(x0 + r * Math.cos(a), y, z0 + r * Math.sin(a));
      }
    }
    for (let k = 0; k < n; k += 1) {
      const next = (k + 1) % n;
      index.push(k, next, n + k, next, n + next, n + k);
    }
    return { positions, index };
  }

  it('cuts every triangle that crosses a plane, indexed or not, and nothing outside the mesh', () => {
    const { positions, index } = tube({ r: 2, n: 8 });
    const points = sliceModel(positions, index, 1, 0.25);
    expect(points.length).toBeGreaterThan(8);
    for (const [x, y, z] of points) {
      expect(y).toBeCloseTo(0.25, 9);
      // On the octagon's sides: between its apothem and its radius.
      expect(Math.hypot(x, z)).toBeLessThanOrEqual(2 + 1e-9);
      expect(Math.hypot(x, z)).toBeGreaterThan(2 * Math.cos(Math.PI / 8) - 1e-9);
    }
    const flat = index.flatMap(i => positions.slice(3 * i, 3 * i + 3));
    expect(sliceModel(flat, null, 1, 0.25)).toHaveLength(points.length);
    expect(sliceModel(positions, index, 1, 5)).toEqual([]);
    expect(sliceModel([], null, 1, 0)).toEqual([]);
  });

  it('finds a nacelle by its cross-section, beside a thin wing in the same cut', () => {
    const pod = tube({ x0: 6, z0: 1.4, r: 0.9, y0: 0, y1: 4, n: 24 });
    // A thin, wide slab at z 2.6 (a wing) from x 2 to x 14.
    const wing = { positions: [2, 0, 2.6, 14, 0, 2.6, 14, 4, 2.6, 2, 4, 2.6, 2, 0, 2.7, 14, 0, 2.7, 14, 4, 2.7, 2, 4, 2.7],
      index: [0, 1, 2, 0, 2, 3, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 3, 2, 6, 3, 6, 7] };
    const offset = pod.positions.length / 3;
    const positions = [...pod.positions, ...wing.positions];
    const index = [...pod.index, ...wing.index.map(i => i + offset)];
    const slice = (axis, value) => sliceModel(positions, index, axis, value);
    const section = nacelleSection(slice, { x: 6.3, frontY: 4, backY: 0, diameterM: 1.8 });
    expect(section.x).toBeCloseTo(6, 1);
    expect(section.z).toBeCloseTo(1.4, 1);
    expect(section.width).toBeCloseTo(1.8, 1);
    // No nacelle where silhouette.js puts it: null, and liveryFrame falls back on the dimensions.
    expect(nacelleSection(slice, { x: 20, frontY: 4, backY: 0, diameterM: 1.8 })).toBeNull();
  });
});

describe('liveryFrame and the zones of the vendored models', () => {
  it('reads the A320\'s fuselage, fin and nacelles from its L2 model, close to types.js', async () => {
    const model = await loadModel('A320', 'l2');
    const spec = AIRCRAFT_TYPES.A320;
    const frame = liveryFrame(positionsOf(model), spec, indexOf(model));
    expect(2 * frame.halfLengthM).toBeCloseTo(spec.lengthM, 0);
    expect(2 * frame.radiusM).toBeGreaterThan(0.85 * spec.fuselageDiaM);
    expect(2 * frame.radiusM).toBeLessThan(1.15 * spec.fuselageDiaM);
    expect(frame.axisZM - frame.radiusM).toBeGreaterThan(0);
    expect(frame.fin.topZM).toBeGreaterThan(0.9 * model.entry.dimensionsM.height);
    expect(frame.fin.topZM).toBeLessThanOrEqual(model.entry.dimensionsM.height + 0.05);
    expect(frame.fin.rootChordM).toBeGreaterThan(2);
    expect(frame.engines).toHaveLength(1);
    expect(frame.engines[0].z).toBeLessThan(frame.axisZM);
    expect(Object.isFrozen(frame)).toBe(true);

    const positions = positionsOf(model);
    const zones = points => new Set(points.map(point => LIVERY_ZONES[liveryZone(point, frame)] ?? 'fixed'));
    // The wingtips are wing, the fin's top is tail, the crown ahead of the wing is body and its keel is belly.
    const tips = pointsOf(positions, ([x]) => Math.abs(x) > 0.42 * spec.spanM);
    expect(tips.length).toBeGreaterThan(10);
    expect(zones(tips)).toEqual(new Set(['wing']));
    const finTop = pointsOf(positions, ([x, , z]) => Math.abs(x) < 0.3 && z > frame.fin.topZM - 0.6);
    expect(finTop.length).toBeGreaterThan(3);
    expect(zones(finTop)).toEqual(new Set(['tail']));
    // The constant section has few vertices: its surface is read where planes across it cut it.
    const sections = [0.7, 0.74, 0.78].flatMap(share => sliceModel(positions, indexOf(model), 1, frame.yMinM + share * spec.lengthM));
    const crown = sections.filter(([x, , z]) => Math.abs(x) < 0.4 && z > frame.axisZM + 0.95 * frame.radiusM);
    expect(crown.length).toBeGreaterThan(3);
    expect(zones(crown)).toEqual(new Set(['fuselage']));
    const keel = sections.filter(([x, , z]) => Math.abs(x) < 0.4 && z < frame.axisZM - 0.95 * frame.radiusM);
    expect(keel.length).toBeGreaterThan(3);
    expect(zones(keel)).toEqual(new Set(['belly']));
    // Most of the nacelle's skin (its lowest points along its length) is engine.
    const [engine] = frame.engines;
    const skin = pointsOf(positions, ([x, y, z]) => Math.abs(Math.abs(x) - engine.x) < 0.3 && y > engine.y0M + 0.5
      && y < engine.y1M - 0.5 && z < engine.z - 0.4 * engine.reachM);
    expect(skin.length).toBeGreaterThan(5);
    const engineShare = skin.filter(point => liveryZone(point, frame) === 6).length / skin.length;
    expect(engineShare).toBeGreaterThan(0.9);
  }, 30_000);

  // QA of 2026-11-28: Wingo's lime and Avianca's white marks vanished on an accent of their colour, and a swept leading
  // edge cut the mark's top corner.
  it.each(['A21N', 'B738', 'B789', 'CRJ9', 'AT76'])('sets the %s fin\'s mark above the accent and inside the fin', async icao => {
    const model = await loadModel(icao, 'l2');
    const positions = positionsOf(model);
    const index = indexOf(model);
    const frame = liveryFrame(positions, AIRCRAFT_TYPES[icao], index);
    const { fin } = frame;
    const half = { y: fin.markWidthM / 2, z: (fin.markWidthM * LIVERY_ATLAS.rowHeight) / LIVERY_ATLAS.markWidth / 2 };
    expect(fin.markWidthM).toBeGreaterThan(0.25 * fin.rootChordM);
    expect(fin.markZM - half.z).toBeGreaterThanOrEqual(fin.rootZM + LIVERY_BANDS.accentV * (fin.topZM - fin.rootZM) - 1e-6);
    expect(fin.markZM + half.z).toBeLessThan(fin.topZM);
    for (const z of [fin.markZM - half.z, fin.markZM + half.z]) {
      const ys = sliceModel(positions, index, 2, z)
        .filter(([x, y]) => Math.abs(x) < 0.5 * frame.halfWidthM && y < fin.aftYM + 3 * fin.rootChordM).map(([, y]) => y);
      expect(Math.min(...ys), `${icao} aft edge at ${z.toFixed(2)} m`).toBeLessThan(fin.markYM - half.y);
      expect(Math.max(...ys), `${icao} leading edge at ${z.toFixed(2)} m`).toBeGreaterThan(fin.markYM + half.y);
      for (const y of [fin.markYM - half.y, fin.markYM + half.y]) expect(liveryZone([0.1, y, z], frame)).toBe(4);
    }
  }, 60_000);

  // QA of 2026-11-28: the A330's intakes stand ~3 m ahead of silhouette.js's nacelle and took the wing's grey.
  it('paints the A330\'s nacelle from its intake back, where the model has it', async () => {
    const model = await loadModel('A332', 'l2');
    const positions = positionsOf(model);
    const spec = AIRCRAFT_TYPES.A332;
    const frame = liveryFrame(positions, spec, indexOf(model));
    const [engine] = frame.engines;
    const [nacelle] = nacelles(spec);
    expect(engine.y1M).toBeGreaterThan(nacelle.frontY + 1);
    expect(engine.y1M - engine.y0M).toBeLessThan(2 * (nacelle.frontY - nacelle.backY));
    const intake = pointsOf(positions, ([x, y, z]) => Math.abs(Math.abs(x) - engine.x) < 0.3 && y > engine.y1M - 2.5
      && y < engine.y1M && z < engine.z - 0.4 * engine.reachM);
    expect(intake.length).toBeGreaterThan(3);
    expect(intake.filter(point => liveryZone(point, frame) === 6)).toHaveLength(intake.length);
  }, 30_000);

  // QA of 2026-11-28: the reach of the CRJ900's rear pods painted the fuselage beside them in the engine colour.
  it('paints the CRJ900\'s rear pods in the engine colour and not the fuselage beside them', async () => {
    const model = await loadModel('CRJ9', 'l2');
    const positions = positionsOf(model);
    const frame = liveryFrame(positions, AIRCRAFT_TYPES.CRJ9, indexOf(model));
    const [engine] = frame.engines;
    const near = ([, y, z]) => y > engine.y0M && y < engine.y1M && Math.abs(z - engine.z) < engine.reachM;
    const side = pointsOf(positions, point => near(point) && Math.abs(point[0]) < frame.halfWidthM);
    expect(side.length).toBeGreaterThan(5);
    expect(side.filter(point => liveryZone(point, frame) === 6)).toEqual([]);
    const outer = pointsOf(positions, point => near(point) && Math.abs(point[0]) > engine.x + 0.3
      && Math.hypot(Math.abs(point[0]) - engine.x, point[2] - engine.z) < engine.reachM);
    expect(outer.length).toBeGreaterThan(5);
    expect(outer.filter(point => liveryZone(point, frame) === 6).length / outer.length).toBeGreaterThan(0.9);
  }, 30_000);

  // QA of 2026-11-28: the ATR 72's name stood behind its propeller.
  it('sets the name ahead of a nacelle at its height (ATR 72) and leaves it after the wing root of a jet', async () => {
    const atr = await loadModel('AT76', 'l2');
    const frame = liveryFrame(positionsOf(atr), AIRCRAFT_TYPES.AT76, indexOf(atr));
    const length = 2 * frame.halfLengthM;
    for (const engine of frame.engines) expect(frame.name.y0M).toBeGreaterThan(engine.y1M);
    expect(frame.name.y0M + frame.name.lengthM).toBeLessThanOrEqual(frame.yMinM + NAME_PLACE.end * length + 1e-6);
    expect(frame.name.lengthM).toBeGreaterThan(0.1 * length);
    expect(frame.name.lengthM / frame.name.heightM).toBeCloseTo(LIVERY_ATLAS.nameWidth / LIVERY_ATLAS.rowHeight, 6);
    for (const icao of ['A320', 'CRJ9']) {
      const model = await loadModel(icao, 'l1');
      const jet = liveryFrame(positionsOf(model), AIRCRAFT_TYPES[icao], indexOf(model));
      expect(jet.name.y0M, icao).toBeCloseTo(jet.yMinM + NAME_PLACE.start * 2 * jet.halfLengthM, 6);
    }
  }, 30_000);

  it('finds two nacelles a side on a four-engined type only, and the rear pods of a T-tail jet', () => {
    expect(liveryFrame([], AIRCRAFT_TYPES.A320).engines).toHaveLength(1);
    expect(liveryFrame([], AIRCRAFT_TYPES.CRJ9).engines.length).toBeGreaterThan(0);
    // Without positions the frame comes from the dimensions alone.
    const empty = liveryFrame([], AIRCRAFT_TYPES.B738);
    expect(2 * empty.halfLengthM).toBeCloseTo(AIRCRAFT_TYPES.B738.lengthM, 6);
    expect(empty.fin.topZM).toBeGreaterThan(empty.fin.rootZM);
  });
});

describe('the palette and the GLSL', () => {
  it('holds one row per livery, the default first, eight zones each in linear colour', () => {
    expect(LIVERY_ROWS[0]).toBe(DEFAULT_LIVERY);
    expect(LIVERY_ROWS).toHaveLength(1 + Object.keys(LIVERIES).length);
    expect(liveryRow('DEFAULT')).toBe(0);
    expect(liveryRow(LIVERIES.CMP)).toBe(LIVERY_ROWS.indexOf(LIVERIES.CMP));
    expect(liveryRow('NOPE')).toBe(-1);
    expect(liveryRow(null)).toBe(-1);
    const data = liveryPaletteData();
    expect(data).toHaveLength(LIVERY_ROWS.length * LIVERY_ZONES.length * 4);
    const row = liveryRow('CMP');
    const cheatline = 4 * (row * LIVERY_ZONES.length + LIVERY_ZONES.indexOf('cheatline'));
    expect([...data.slice(cheatline, cheatline + 4)].map(value => +value.toFixed(5)))
      .toEqual([...linearRgb(LIVERIES.CMP.cheatline), 1].map(value => +value.toFixed(5)));
    // A missing cheatline or accent takes its base colour.
    expect(liveryColours(LIVERIES.DAL)[2]).toBe(LIVERIES.DAL.fuselage);
    expect(liveryColours(LIVERIES.DAL)[3]).toBe(LIVERIES.DAL.belly);
    expect(liveryColours(LIVERIES.NKS)[5]).toBe(LIVERIES.NKS.tail);
  });

  it('injects the same bands into three\'s Lambert shader and refuses a shader without its hooks', () => {
    const shader = injectLivery({ vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader });
    expect(shader.vertexShader).toMatch(/attribute float liveryIndex;/);
    expect(shader.vertexShader).toMatch(/if \(liveryPart > 0\.5 && liveryGear < 0\.5\) transformed = vec3\(0\.0\);/);
    expect(shader.fragmentShader).toContain(LIVERY_GLSL);
    expect(shader.fragmentShader).toMatch(/if \(vLiveryIndex > -0\.5\) diffuseColor\.rgb = liveryColour/);
    for (const value of [LIVERY_BANDS.outside, LIVERY_BANDS.finC, LIVERY_BANDS.belly, LIVERY_BANDS.cheatline2,
      LIVERY_BANDS.cheatlineLow, LIVERY_BANDS.cheatlineHigh, LIVERY_BANDS.accentV, LIVERY_BANDS.accentChord]) {
      expect(LIVERY_GLSL).toContain(Number.isInteger(value) ? `${value}.0` : String(value));
    }
    expect(() => injectLivery({ vertexShader: 'void main() {}', fragmentShader: ShaderLib.lambert.fragmentShader })).toThrow(/begin_vertex|common/);

    const uniforms = frameUniforms(FRAME);
    expect(uniforms.liveryBody.value).toEqual([FRAME.yMinM, FRAME.halfLengthM, FRAME.axisZM, FRAME.halfWidthM]);
    expect([...uniforms.liveryEngines.value]).toEqual([6, 1.5, 1.2, 0, 0, 0, 0, 0].map(Math.fround));
    expect([...uniforms.liveryEngineY.value]).toEqual([1, 5, 0, 0]);
  });

  it('makes a Lambert material, both sides, that hands the shader its uniforms; textures without a canvas have no atlas', () => {
    const textures = createLiveryTextures(THREE_PARTS);
    expect(textures.atlas).toBeNull();
    expect(textures.refresh(new Map())).toBe(false);
    expect(textures.palette.image.width).toBe(LIVERY_ZONES.length);
    expect(textures.palette.image.height).toBe(LIVERY_ROWS.length);
    const material = createLiveryMaterial(THREE_PARTS, { frame: FRAME, textures });
    expect(material.isMeshLambertMaterial).toBe(true);
    expect(material.side).toBe(THREE_PARTS.DoubleSide);
    const shader = { uniforms: {}, vertexShader: ShaderLib.lambert.vertexShader, fragmentShader: ShaderLib.lambert.fragmentShader };
    material.onBeforeCompile(shader);
    expect(shader.uniforms.liveryPalette.value).toBe(textures.palette);
    expect(shader.uniforms.liveryHasAtlas.value).toBe(0);
    expect(shader.uniforms.liveryRows.value).toBe(LIVERY_ROWS.length);
    expect(material.customProgramCacheKey()).toBe('occ-livery-v1');
    material.dispose();
    textures.dispose();
  });
});

describe('the lettering', () => {
  it('reads the name from tail to nose on the right side and mirrored on the left, inside its row of the atlas', () => {
    const rows = LIVERY_ROWS.length;
    const row = 3;
    const point = [2, FRAME.name.y0M + 0.25 * FRAME.name.lengthM, FRAME.name.z0M + 0.5 * FRAME.name.heightM];
    const [u, v] = letteringUv(point, 0, FRAME, row, rows);
    expect(u).toBeCloseTo((0.25 * LIVERY_ATLAS.nameWidth) / LIVERY_ATLAS.width, 6);
    expect(v).toBeCloseTo(1 - (row + 0.5) / rows, 6);
    const [uLeft] = letteringUv([-2, point[1], point[2]], 0, FRAME, row, rows);
    expect(uLeft).toBeCloseTo((0.75 * LIVERY_ATLAS.nameWidth) / LIVERY_ATLAS.width, 6);
    // The fin's mark reads from its own cell; outside the cells, and on other zones, nothing.
    const [uMark] = letteringUv([0.2, FRAME.fin.markYM, FRAME.fin.markZM], 4, FRAME, row, rows);
    expect(uMark).toBeCloseTo((LIVERY_ATLAS.nameWidth + 0.5 * LIVERY_ATLAS.markWidth) / LIVERY_ATLAS.width, 6);
    expect(letteringUv([2, FRAME.name.y0M - 1, point[2]], 0, FRAME, row, rows)).toBeNull();
    expect(letteringUv(point, 1, FRAME, row, rows)).toBeNull();
  });

  it('paints each row\'s name and, on the fin, its logo when loaded or else its IATA code', () => {
    const calls = [];
    const context = new Proxy({}, {
      get: (target, name) => (name in target ? target[name] : (...args) => calls.push([name, ...args])),
      set: (target, name, value) => {
        target[name] = value;
        calls.push(['set', name, value]);
        return true;
      },
    });
    const logo = { naturalWidth: 400, naturalHeight: 100 };
    const rows = [DEFAULT_LIVERY, LIVERIES.DAL, LIVERIES.CMP];
    paintLiveryAtlas(context, { rows, logos: new Map([[LIVERIES.DAL.logoTexture, logo]]) });
    const texts = calls.filter(([name]) => name === 'fillText').map(([, text]) => text);
    // The default writes nothing; Delta its name and its logo; Copa its name and its code.
    expect(texts).toEqual(['DELTA', 'COPA', 'CM']);
    const drawn = calls.filter(([name]) => name === 'drawImage');
    expect(drawn).toHaveLength(1);
    const [, image, x, y, w, h] = drawn[0];
    expect(image).toBe(logo);
    expect(x).toBeGreaterThanOrEqual(LIVERY_ATLAS.nameWidth);
    expect(w / h).toBeCloseTo(4, 6);
    expect(y).toBeGreaterThanOrEqual(LIVERY_ATLAS.rowHeight);
    expect(y + h).toBeLessThanOrEqual(2 * LIVERY_ATLAS.rowHeight);
  });

  it('tints a logo in one colour on its own canvas, at most LOGO_MAX_PX, and keeps the image without a canvas', () => {
    const image = { naturalWidth: 2758, naturalHeight: 435 };
    const operations = [];
    const context = {
      clearRect: vi.fn(),
      drawImage: vi.fn((...args) => operations.push(['drawImage', ...args.slice(1)])),
      fillRect: vi.fn(() => operations.push(['fillRect', context.globalCompositeOperation, context.fillStyle])),
      globalCompositeOperation: 'source-over',
      fillStyle: '#000000',
    };
    const createCanvas = vi.fn((width, height) => ({ width, height, getContext: () => context }));
    const tinted = tintLogo(image, '#ffffff', createCanvas);
    expect(createCanvas).toHaveBeenCalledWith(LOGO_MAX_PX, Math.round((435 * LOGO_MAX_PX) / 2758));
    expect(tinted.width).toBe(LOGO_MAX_PX);
    expect(operations).toEqual([['drawImage', 0, 0, tinted.width, tinted.height], ['fillRect', 'source-in', '#ffffff']]);
    expect(context.globalCompositeOperation).toBe('source-over');
    expect(tintLogo(image, '#ffffff', () => null)).toBe(image);
    expect(tintLogo(image, '#ffffff', null)).toBe(image);
    expect(tintLogo({ naturalWidth: 0, naturalHeight: 0 }, '#ffffff', createCanvas).naturalWidth).toBe(0);
  });
});
