import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { CIVIL_TWILIGHT_DEG, dayPhase } from '../traffic/solar';
import { buildDetailedAircraft, nextBlinkInMs } from './aircraftDetail';
import { buildAircraftGeometry, triangleCount } from './aircraftGeometry';
import { createGltfModels } from './gltfModels';
import { SHADOW, linearRgb, mercatorFrame, poseMatrix } from './instancePlan';
import { LIVERY_ROWS, createLiveryMaterial, createLiveryTextures, liveryFont, tintLogo } from './liveryMaterial';
import { buildModelAirframe, instancedModelGeometry, modelFrame, writeLiveryInstances } from './modelAircraft';
import { detailLevel, instancedLevel, metresPerPixel, wantsL1 } from './modelLevels';

// The 3D aircraft as one MapLibre custom layer (design G1, G3 and G4): three draws the instance plan
// (aircraft/instancePlan.js) on the map's own canvas and WebGL context, in the depth buffer the terminals' extrusions
// share, so a building hides an aircraft behind it.
//
// - Frame: the scene is the local frame of the ARP (x east, y north, z up, in metres); the projection is the map's
//   mainMatrix times the frame's matrix, so no camera moves and the models stand where the 2D layers draw them.
// - One InstancedMesh per type present, each with its own model (aircraft/aircraftGeometry.js) and one white Lambert
//   material shared by all, tinted per instance: a handful of draw calls and no model files (Decision G-1).
// - The matrices are copied only when the plan's revision changes; a type that leaves the plan keeps its mesh for
//   five minutes, in case it comes back, and then gives it and its model up.
// - Light: a hemisphere light and a directional light from the sun by day; by night a dim cool ambient and a fixed
//   light from high up, so the models still read; the civil twilight blends the two.
// - Models (PR M5, aircraft/modelLevels.js): a type whose aircraft are drawn large enough on screen and that has a 3D
//   model (aircraft/gltfModels.js, read on demand from public/models/aircraft/) draws its L1 model instead of its
//   procedural one, still one InstancedMesh, in each AVIAM aircraft's airline livery (aircraft/liveryMaterial.js; other
//   traffic keeps its plain colour) with the app's gear folded per instance; its shadows stay in its procedural model,
//   in a second mesh, so a shadow never costs a model's triangles. The detailed aircraft draws its type's L2 model with
//   the app's gear and lights. Until a model loads, and for a type without one, the procedural model stays.
// - Picking: a ray from the inverse projection through the meshes; a hit names the aircraft, a shadow names nothing.
// - Context loss: MapLibre 6.16 removes its custom layers when it loses the context (its style's destroy() calls
//   onRemove, then the map fires `webglcontextlost`), and the engine adds the layer again once the style is back, so
//   onAdd builds the scene again on the map's context. A worker restart fires the same two events but drops the layer
//   without onRemove: the layer then stops drawing on `webglcontextlost` and builds a new renderer on the map's context
//   on `webglcontextrestored`; its geometries and materials are plain objects the new renderer uploads again. Added
//   again on another context or map, it moves its renderer there.
// - Failure: when three cannot build its renderer on the map's context (in onAdd or on a restored context), the layer
//   warns once, draws and picks nothing and reports itself failed (stats().failed and onFailedChange), so that the map
//   shows its 2D aircraft again (design G4: if 3D fails, 2D); the next onAdd or restored context tries again.
//
// `three` is a parameter (aircraft/aircraft3dChunk.js: THREE_PARTS), so this module imports neither three nor
// maplibre-gl. It names three's renderer, so only the 3D chunk may import it (scripts/verify-map-chunks.mjs).

/** The id of the layer in the map's style. */
export const AIRCRAFT_3D_LAYER_ID = 'occ-aircraft-3d';

/** How long a type's mesh outlives its last aircraft before it is disposed with its model. */
export const UNUSED_MESH_MS = 300_000;

/**
 * The size floor of the traffic's models (PR M7): at a far zoom an aircraft of the traffic is drawn at least
 * `minModelPx` CSS pixels long, as its 2D symbol is never a speck, and at most MAX_MODEL_SCALE times its size; an
 * aircraft on its stand keeps the stand's scale (instancePlan.js: floorLengths). The floor follows the zoom of every
 * frame, so a zoom never makes a model jump at its end.
 */
export const MAX_MODEL_SCALE = 4;
// The equator in metres over the 512 px of a MapLibre world at zoom 0.
const METRES_PER_PIXEL_Z0 = 40_075_016.686 / 512;
// A floor that moved less than this share is not written again.
const FLOOR_STEP = 0.01;

/** How far the sun moves, in degrees, before the lights are set again. */
export const SUN_STEP_DEG = 0.25;

// The colours and strengths of the light (three's physical units: a Lambert surface facing a light of intensity π
// at full albedo is fully lit). By day: a white sky over a grey ground and a white sun. By night: a dim slate sky and
// a slate light from high up in the south-south-east, behind the cameras of the airfield and ramp views (bearing −17°),
// so the faces they see are lit. Both are the palette's cool greys, never its cyan: the models keep their greys, and
// the chosen aircraft its cyan, day and night.
const DAY_LIGHT = Object.freeze({ sky: '--occ-primary-hover', ground: '--occ-line-strong', hemisphere: 1.1,
  sun: '--occ-primary-hover', directional: 2.1 });
const NIGHT_LIGHT = Object.freeze({ sky: '--occ-line', ground: '--occ-nav', hemisphere: 1.4,
  overhead: '--occ-muted', directional: 1.9, azimuthDeg: 163, elevationDeg: 65 });
// A sun on the horizon still lights from a little above it, never from below the ground.
const LOWEST_SUN_DEG = 3;
const DROP_LINE_TOKEN = '--occ-line-strong';
// Every colour the layer reads from its palette, checked when the layer is made.
const PALETTE_TOKENS = Object.freeze([DAY_LIGHT.sky, DAY_LIGHT.ground, DAY_LIGHT.sun, NIGHT_LIGHT.sky, NIGHT_LIGHT.ground,
  NIGHT_LIGHT.overhead, DROP_LINE_TOKEN]);
const MIN_LINE_VERTICES = 64;
const EMPTY_PLAN = new Map();
const NO_IDS = Object.freeze([]);

// The detailed aircraft (CN-30): its propellers turn at this speed while it moves or its beacon is on, and its ground
// shadow is a dark veil of its instanced model.
const PROPELLER_RPM = 1200;
const DETAIL_SHADOW = Object.freeze({ colour: '#0b0f14', opacity: 0.42 });

// A canvas for the detailed aircraft's textures where the page has a document; none in Node.
const documentCanvas = (width, height) => {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
};

// A licensed logo of a livery (aircraft/liveries.js: logoTexture), from the application's own origin only.
const loadSameOriginImage = url => new Promise((resolve, reject) => {
  if (typeof Image !== 'function' || typeof url !== 'string' || !url.startsWith('/') || url.startsWith('//')) {
    reject(new Error('A livery logo is a path of the application.'));
    return;
  }
  const image = new Image();
  image.decoding = 'async';
  image.onload = () => resolve(image);
  image.onerror = () => reject(new Error(`The livery logo ${url} did not load.`));
  image.src = url;
});

const toRadians = degrees => (degrees * Math.PI) / 180;
const finite = value => typeof value === 'number' && Number.isFinite(value);
const isSun = sun => finite(sun?.azimuthDeg) && finite(sun?.elevationDeg);
const nextPowerOfTwo = value => 2 ** Math.ceil(Math.log2(Math.max(1, value)));
const mix = (from, to, share) => from.map((value, index) => value + (to[index] - value) * share);

/** The unit vector toward a direction of the sky (azimuth from north, clockwise), in east, north and up. */
function skyDirection({ azimuthDeg, elevationDeg }) {
  const azimuth = toRadians(azimuthDeg);
  const elevation = toRadians(elevationDeg);
  return [Math.sin(azimuth) * Math.cos(elevation), Math.cos(azimuth) * Math.cos(elevation), Math.sin(elevation)];
}

function normalized(vector) {
  const length = Math.hypot(...vector);
  return length > 0 ? vector.map(value => value / length) : [0, 0, 1];
}

function paletteColour(palette, token) {
  if (!Object.hasOwn(palette ?? {}, token)) throw new RangeError(`The palette has no ${token}`);
  return linearRgb(palette[token]);
}

const frozenLighting = ({ phase, hemisphere, directional }) => Object.freeze({
  phase,
  hemisphere: Object.freeze({ skyColor: Object.freeze([...hemisphere.skyColor]),
    groundColor: Object.freeze([...hemisphere.groundColor]), intensity: hemisphere.intensity }),
  directional: Object.freeze({ direction: Object.freeze([...directional.direction]),
    color: Object.freeze([...directional.color]), intensity: directional.intensity }),
});

/**
 * The light of the scene for a sun `{ azimuthDeg, elevationDeg }` (traffic/solar.js: sunPosition at the ARP):
 * `{ phase, hemisphere: { skyColor, groundColor, intensity }, directional: { direction, color, intensity } }`, colours
 * as linear `[r, g, b]` from `palette` (the OCC palette) and `direction` the unit vector toward the light in east,
 * north and up. By day (phase `'day'`) the directional light comes from the sun, `(sin A cos e, cos A cos e, sin e)`,
 * and never from below LOWEST_SUN_DEG; at night a dim cool ambient and a fixed light from high up; in the civil
 * twilight (`'twilight'`, 0° to −6°) the two blend with the sun's height. Without a sun, the night's light.
 */
export function sceneLighting(sun, palette = OCC_PALETTE) {
  const night = {
    phase: 'night',
    hemisphere: {
      skyColor: paletteColour(palette, NIGHT_LIGHT.sky),
      groundColor: paletteColour(palette, NIGHT_LIGHT.ground),
      intensity: NIGHT_LIGHT.hemisphere,
    },
    directional: {
      direction: skyDirection(NIGHT_LIGHT),
      color: paletteColour(palette, NIGHT_LIGHT.overhead),
      intensity: NIGHT_LIGHT.directional,
    },
  };
  if (!isSun(sun)) return frozenLighting(night);
  const phase = dayPhase(sun.elevationDeg);
  if (phase === 'night') return frozenLighting(night);
  const day = {
    phase: 'day',
    hemisphere: {
      skyColor: paletteColour(palette, DAY_LIGHT.sky),
      groundColor: paletteColour(palette, DAY_LIGHT.ground),
      intensity: DAY_LIGHT.hemisphere,
    },
    directional: {
      direction: skyDirection({ azimuthDeg: sun.azimuthDeg, elevationDeg: Math.max(sun.elevationDeg, LOWEST_SUN_DEG) }),
      color: paletteColour(palette, DAY_LIGHT.sun),
      intensity: DAY_LIGHT.directional,
    },
  };
  if (phase === 'day') return frozenLighting(day);
  // 0 at the end of the civil twilight, 1 with the sun on the horizon.
  const share = (sun.elevationDeg - CIVIL_TWILIGHT_DEG) / -CIVIL_TWILIGHT_DEG;
  return frozenLighting({
    phase: 'twilight',
    hemisphere: {
      skyColor: mix(night.hemisphere.skyColor, day.hemisphere.skyColor, share),
      groundColor: mix(night.hemisphere.groundColor, day.hemisphere.groundColor, share),
      intensity: night.hemisphere.intensity + (day.hemisphere.intensity - night.hemisphere.intensity) * share,
    },
    directional: {
      direction: normalized(mix(night.directional.direction, day.directional.direction, share)),
      color: mix(night.directional.color, day.directional.color, share),
      intensity: night.directional.intensity + (day.directional.intensity - night.directional.intensity) * share,
    },
  });
}

// Whether two directions of the sun (unit vectors, or null when there is none) are within SUN_STEP_DEG.
function sameSun(a, b) {
  if (a === null || b === null) return a === b;
  const cosine = a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  return cosine >= Math.cos(toRadians(SUN_STEP_DEG));
}

/**
 * The 3D aircraft layer (design G1): a MapLibre CustomLayerInterface `{ id, type: 'custom', renderingMode: '3d',
 * onAdd, render, onRemove, pick, setQuality, stats }`.
 * - `three`: the parts of three (aircraft/aircraft3dChunk.js: THREE_PARTS); `originLngLat`: the ARP;
 * - `getInstances()` → `{ revision, plan }`, the plan of instancePlan.js: its matrices are copied when `revision`
 *   changes (compared with Object.is), never otherwise;
 * - `getSun()` → `{ azimuthDeg, elevationDeg }` at the ARP, or null; `palette`: the OCC palette;
 * - `minModelPx` (PR M7): the size floor of the traffic's models in CSS pixels (MAX_MODEL_SCALE), 0 for none;
 * - `onFailedChange(failed)` hears every change of `stats().failed`, after the lifecycle call that made it, so that a
 *   map that hides its 2D aircraft under the 3D ones shows them again while the layer has failed;
 * - `createRenderer({ canvas, context })`, `buildGeometry(three, spec)`, `createModels(onLoad)` (aircraft/gltfModels.js:
 *   createGltfModels, or null for none) and `now()` (milliseconds, monotonic) are for tests.
 *
 * `pick({ x, y })` (CSS pixels from the canvas's top-left corner) answers `{ kind: 'aircraft', id }` with the plan's id
 * of the aircraft under the pointer, or `null` when the ray meets no aircraft (a shadow is no aircraft), before the
 * first frame, while the context is lost and while the layer has failed: the map then picks in 2D.
 * `setQuality({ shadows, dropLines })` lets the frame loop's governor lighten the scene without switching it off.
 * `stats()` → `{ meshes, instances, triangles, drawCalls, lost, failed }`: the meshes held, the instances and triangles
 * drawn, the draw calls of the scene, whether the context is lost and whether the layer has failed. It has failed while
 * it is on a map whose context works and three could not build its renderer on that context, so it draws nothing; it
 * has not failed before onAdd, after onRemove or while the context is lost, when nothing draws, 2D included.
 */
export function createAircraft3dLayer({
  three, originLngLat, getInstances, palette = OCC_PALETTE, getSun = () => null, onFailedChange, minModelPx = 0,
  createRenderer = ({ canvas, context }) => new three.WebGLRenderer({ canvas, context, antialias: true }),
  buildGeometry = buildAircraftGeometry, now = () => performance.now(), buildDetail = buildDetailedAircraft,
  createCanvas = documentCanvas, loadImage = loadSameOriginImage,
  createModels = onLoad => (typeof three?.GLTFLoader === 'function' ? createGltfModels({ three, onLoad }) : null),
} = {}) {
  if (three == null) throw new TypeError('The 3D aircraft layer needs the parts of three');
  if (typeof getInstances !== 'function') throw new TypeError('The 3D aircraft layer needs getInstances()');
  const frameMatrix = new three.Matrix4().fromArray(mercatorFrame(originLngLat).matrix);
  const originCos = Math.cos((originLngLat[1] * Math.PI) / 180);
  PALETTE_TOKENS.forEach(token => paletteColour(palette, token));
  const dropLineColour = paletteColour(palette, DROP_LINE_TOKEN);

  const projection = new three.Matrix4();
  const raycaster = new three.Raycaster();
  const near = new three.Vector3();
  const far = new three.Vector3();
  const quality = { shadows: true, dropLines: true };
  // key → { geometry, triangles, mesh, capacity, aircraftCount, instances, ids, idleSince }
  const meshes = new Map();

  let scene = null;
  let camera = null;
  let material = null;
  let hemisphere = null;
  let sunLight = null;
  let lines = null;
  let lineMaterial = null;
  let map = null;
  let context = null;
  let renderer = null;
  let listening = null;
  let removed = true;
  let lost = false;
  let rebuild = false;
  let drawn = false;
  let copied = false;
  let revision;
  let appliedSun;
  let warned = false;
  let failed = false;
  // The floor in metres the matrices were last written with (0: none).
  let floorM = 0;
  // CN-30: the detailed aircraft, in a scene of its own drawn in the local frame of its own position (so it stands
  // exactly at any distance from the ARP): `{ key, model, shadow, idleSince }`, its lights, its camera and the timer of
  // the next blink of its lights.
  let detailScene = null;
  let detailCamera = null;
  let detailHemisphere = null;
  let detailSun = null;
  let detailHeld = null;
  let detailDrawn = null;
  let blinkTimer = null;
  let night = true;
  const logos = new Map();
  // PR M5: the types' 3D models, read on demand, and the textures every livery material shares (made on first use).
  const models = createModels(() => {
    copied = false;
    if (!removed) map?.triggerRepaint();
  });
  let liveryTextures = null;

  function sharedLiveryTextures() {
    if (liveryTextures === null) {
      liveryTextures = createLiveryTextures(three, { createCanvas, font: liveryFont() });
      // A layer added again keeps the logos it already read: its new atlas is painted with them at once.
      if ([...logos.values()].some(Boolean)) liveryTextures.refresh(logos);
      for (const livery of LIVERY_ROWS) requestLogo(livery);
    }
    return liveryTextures;
  }

  // A livery's logo (its logoTexture, a path of the application), read once and tinted in its fin's text colour
  // (aircraft/liveryMaterial.js: tintLogo); the atlas and the detailed model's fin are painted again when it loads.
  function requestLogo(livery) {
    const url = livery?.logoTexture;
    if (typeof url !== 'string' || url === '' || logos.has(url)) return;
    logos.set(url, null);
    loadImage(url).then(loaded => {
      const image = tintLogo(loaded, livery.tailText, createCanvas);
      logos.set(url, image);
      const atlas = liveryTextures?.refresh(logos) === true;
      // Only the detailed aircraft whose livery has this logo repaints its fin: every livery's logo loads here.
      const fin = detailHeld?.logoTexture === url && detailHeld.model.refreshLogo(image) === true;
      if ((atlas || fin) && !removed) map?.triggerRepaint();
    }, () => {});
  }

  const mapScale = () => metresPerPixel(map?.getZoom?.(), originLngLat[1]);

  // The L1 model a type's instances draw now (aircraft/modelLevels.js), or null for its procedural model: asked for
  // only once its aircraft are drawn large enough, and used once it has loaded.
  function instancedModel(key, spec, current) {
    if (models === null || typeof key !== 'string' || key.startsWith('@')) return null;
    const scale = mapScale();
    if (!wantsL1({ lengthM: spec.lengthM, metresPerPixel: scale, current })) return null;
    const model = models.get(key, 'l1');
    const level = instancedLevel({ lengthM: spec.lengthM, metresPerPixel: scale, hasModel: model !== null, current });
    return level === 'l1' ? model : null;
  }

  const levelOf = (key, spec, current) => (instancedModel(key, spec, current) === null ? 'procedural' : 'l1');

  // Whether a type on the map should change its level (the zoom crossed the threshold, or its model loaded).
  function levelsChanged() {
    for (const [key, held] of meshes) {
      if (held.instances > 0 && levelOf(key, held.spec, held.level) !== held.level) return true;
    }
    return false;
  }

  // What a type's mesh draws: its geometry and, for a model, its own livery material.
  function heldOf(key, spec) {
    const model = instancedModel(key, spec, 'procedural');
    if (model !== null) {
      const geometry = instancedModelGeometry(three, model, spec, key);
      return { geometry, triangles: triangleCount(geometry), level: 'l1',
        material: createLiveryMaterial(three, { frame: modelFrame(model, spec), textures: sharedLiveryTextures() }) };
    }
    const geometry = buildGeometry(three, spec);
    return { geometry, triangles: triangleCount(geometry), level: 'procedural', material: null };
  }

  function buildScene() {
    scene = new three.Scene();
    camera = new three.Camera();
    material = new three.MeshLambertMaterial({ color: 0xffffff });
    hemisphere = new three.HemisphereLight();
    // three's lights point along +y by default; up is +z here.
    hemisphere.position.set(0, 0, 1);
    sunLight = new three.DirectionalLight();
    lineMaterial = new three.LineBasicMaterial({ color: new three.Color().setRGB(...dropLineColour) });
    lines = new three.LineSegments(lineGeometry(MIN_LINE_VERTICES), lineMaterial);
    lines.frustumCulled = false;
    lines.matrixAutoUpdate = false;
    lines.visible = quality.dropLines;
    scene.add(hemisphere, sunLight, lines);
    detailScene = new three.Scene();
    detailCamera = new three.Camera();
    detailHemisphere = new three.HemisphereLight();
    detailHemisphere.position.set(0, 0, 1);
    detailSun = new three.DirectionalLight();
    detailScene.add(detailHemisphere, detailSun);
    copied = false;
    appliedSun = undefined;
  }

  function lineGeometry(vertices) {
    const geometry = new three.BufferGeometry();
    const position = new three.Float32BufferAttribute(new Float32Array(3 * vertices), 3);
    position.setUsage(three.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setDrawRange(0, 0);
    return geometry;
  }

  function instancedMesh(key, geometry, capacity, own = null) {
    const mesh = new three.InstancedMesh(geometry, own ?? material, capacity);
    mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
    mesh.instanceColor = new three.InstancedBufferAttribute(new Float32Array(3 * capacity), 3);
    mesh.instanceColor.setUsage(three.DynamicDrawUsage);
    mesh.count = 0;
    // The projection is the map's, not a camera's: three's frustum test would cull on a wrong box.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = key;
    mesh.userData.key = key;
    scene.add(mesh);
    return mesh;
  }

  // Shadows come after the aircraft in a procedural mesh, so drawing only the first `aircraftCount` instances drops
  // them. A type at L1 draws its aircraft from its model and their shadows from its procedural model, in a mesh of
  // their own (`held.shadow`): a flat dark veil needs no model of 15 000 triangles.
  function applyCount(held) {
    const l1 = held.level === 'l1';
    held.mesh.count = l1 || !quality.shadows ? held.aircraftCount : held.instances;
    held.mesh.boundingSphere = null;
    held.mesh.boundingBox = null;
    if (held.shadow?.mesh) {
      held.shadow.mesh.count = quality.shadows ? held.aircraftCount : 0;
      held.shadow.mesh.boundingSphere = null;
      held.shadow.mesh.boundingBox = null;
    }
  }

  function disposeHeld(held) {
    scene?.remove(held.mesh);
    held.mesh.dispose();
    held.geometry.dispose();
    held.material?.dispose();
    if (held.shadow != null) {
      if (held.shadow.mesh !== null) {
        scene?.remove(held.shadow.mesh);
        held.shadow.mesh.dispose();
      }
      held.shadow.geometry.dispose();
    }
  }

  // The instances `from` to `to` of a plan's array (a typed array's own view, else a copy).
  const slice = (array, from, to) => (ArrayBuffer.isView(array) ? array.subarray(from, to) : array.slice(from, to));

  // The shadows of a type at L1: the plan's second half, in the procedural model and the plain material.
  function writeShadows(key, held, entry) {
    const n = entry.aircraftCount;
    if (held.shadow === null) {
      const geometry = buildGeometry(three, held.spec);
      held.shadow = { geometry, triangles: triangleCount(geometry), mesh: null, capacity: 0 };
    }
    const shadow = held.shadow;
    if (shadow.mesh === null || shadow.capacity < n) {
      if (shadow.mesh !== null) {
        scene.remove(shadow.mesh);
        shadow.mesh.dispose();
      }
      shadow.capacity = nextPowerOfTwo(n);
      shadow.mesh = instancedMesh(key, shadow.geometry, shadow.capacity);
      shadow.mesh.name = `${key}:shadow`;
      shadow.mesh.userData.shadow = true;
    }
    shadow.mesh.instanceMatrix.array.set(slice(entry.matrices, 16 * n, 32 * n));
    shadow.mesh.instanceColor.array.set(slice(entry.colors, 3 * n, 6 * n));
    shadow.mesh.instanceMatrix.needsUpdate = true;
    shadow.mesh.instanceColor.needsUpdate = true;
  }

  function writeLines(segments) {
    const floats = segments.reduce((total, part) => total + part.length, 0);
    const vertices = floats / 3;
    if (vertices > lines.geometry.getAttribute('position').count) {
      lines.geometry.dispose();
      lines.geometry = lineGeometry(nextPowerOfTwo(vertices));
    }
    const position = lines.geometry.getAttribute('position');
    let offset = 0;
    for (const part of segments) {
      position.array.set(part, offset);
      offset += part.length;
    }
    position.needsUpdate = true;
    lines.geometry.setDrawRange(0, vertices);
  }

  // Copies the plan into the meshes when its revision changed; answers whether it did.
  function syncInstances(time, answer) {
    const nextRevision = answer?.revision;
    if (copied && Object.is(nextRevision, revision)) return false;
    copied = true;
    revision = nextRevision;
    const plan = answer?.plan instanceof Map ? answer.plan : EMPTY_PLAN;
    const segments = [];
    for (const [key, entry] of plan) {
      let held = meshes.get(key);
      // PR M5: a type whose level changed draws from a new mesh.
      if (held !== undefined && levelOf(key, entry.spec, held.level) !== held.level) {
        disposeHeld(held);
        meshes.delete(key);
        held = undefined;
      }
      if (held === undefined) {
        held = { ...heldOf(key, entry.spec), spec: entry.spec, mesh: null, capacity: 0, aircraftCount: 0, instances: 0,
          ids: NO_IDS, idleSince: null, shadow: null };
        meshes.set(key, held);
      }
      const l1 = held.level === 'l1';
      // At L1 the model's mesh holds the aircraft only; their shadows go to the procedural one (writeShadows).
      const need = l1 ? entry.aircraftCount : entry.count;
      if (held.mesh === null || held.capacity < need) {
        if (held.mesh !== null) {
          scene.remove(held.mesh);
          held.mesh.dispose();
        }
        held.capacity = nextPowerOfTwo(need);
        held.mesh = instancedMesh(key, held.geometry, held.capacity, held.material);
      }
      held.base = entry.matrices;
      held.floors = entry.floorLengths ?? null;
      held.mesh.instanceMatrix.array.set(l1 ? slice(entry.matrices, 0, 16 * need) : entry.matrices);
      held.mesh.instanceColor.array.set(l1 ? slice(entry.colors, 0, 3 * need) : entry.colors);
      held.mesh.instanceMatrix.needsUpdate = true;
      held.mesh.instanceColor.needsUpdate = true;
      if (l1) {
        writeLiveryInstances(three, held.geometry, { capacity: held.capacity, count: need,
          liveries: entry.liveries ?? null, gear: entry.gear ?? null });
        writeShadows(key, held, entry);
      }
      held.aircraftCount = entry.aircraftCount;
      held.instances = entry.count;
      held.ids = entry.ids;
      held.idleSince = null;
      applyCount(held);
      if (floorM > 0) scaleHeld(held, floorM);
      if (entry.dropLines?.length > 0) segments.push(entry.dropLines);
    }
    for (const [key, held] of meshes) {
      if (plan.has(key) || held.idleSince !== null) continue;
      held.aircraftCount = 0;
      held.instances = 0;
      held.ids = NO_IDS;
      held.idleSince = time;
      applyCount(held);
    }
    writeLines(segments);
    return true;
  }

  // The matrices of a mesh with the traffic's models no shorter than `floor` metres (MAX_MODEL_SCALE at most): the 3 × 3
  // part of each one with a floor length is scaled about its own origin; the rest stay as planned.
  // At L1 the aircraft and their shadows are in two meshes (writeShadows).
  function scaleHeld(held, floor) {
    if (held.level !== 'l1') {
      scaleMesh(held, held.mesh, 0, held.instances, floor);
      return;
    }
    scaleMesh(held, held.mesh, 0, held.aircraftCount, floor);
    if (held.shadow?.mesh) scaleMesh(held, held.shadow.mesh, held.aircraftCount, held.aircraftCount, floor);
  }

  // The plan's instances `start` to `start + count` of a type, written into `mesh` from its first instance.
  function scaleMesh({ base, floors }, mesh, start, count, floor) {
    if (!base || !floors) return;
    const target = mesh.instanceMatrix.array;
    for (let index = 0; index < count; index += 1) {
      const source = start + index;
      const length = floors[source];
      const factor = length > 0 ? Math.min(MAX_MODEL_SCALE, Math.max(1, floor / length)) : 1;
      for (let element = 0; element < 16; element += 1) {
        const scaled = element < 12 && element % 4 !== 3;
        const value = base[16 * source + element];
        target[16 * index + element] = scaled ? value * factor : value;
      }
    }
    mesh.instanceMatrix.needsUpdate = true;
    mesh.boundingSphere = null;
    mesh.boundingBox = null;
  }

  // The floor of the zoom on screen: every mesh again when it moved more than FLOOR_STEP.
  function syncFloor() {
    if (!(minModelPx > 0) || typeof map?.getZoom !== 'function') return;
    const zoom = map.getZoom();
    if (!finite(zoom)) return;
    const next = minModelPx * (METRES_PER_PIXEL_Z0 * originCos) / 2 ** zoom;
    if (floorM > 0 && Math.abs(next - floorM) <= FLOOR_STEP * floorM) return;
    floorM = next;
    for (const held of meshes.values()) scaleHeld(held, floorM);
  }

  function retireIdle(time) {
    for (const [key, held] of meshes) {
      if (held.idleSince !== null && time - held.idleSince >= UNUSED_MESH_MS) {
        disposeHeld(held);
        meshes.delete(key);
      }
    }
    if (detailHeld?.idleSince != null && time - detailHeld.idleSince >= UNUSED_MESH_MS) disposeDetail();
  }

  function disposeDetail() {
    if (detailHeld === null) return;
    detailHeld.model.dispose();
    detailHeld.shadow.removeFromParent();
    detailHeld.shadow.geometry.dispose();
    detailHeld.shadow.material.dispose();
    detailHeld = null;
  }

  // The detailed aircraft's model for `detail` (built once per type, livery and registration), with its logo once it
  // loads.
  function detailModel(detail, time) {
    // PR M5: its type's L2 model once it has loaded, else the procedural one.
    const loaded = models !== null && typeof detail.code === 'string' ? models.get(detail.code, 'l2') : null;
    const level = detailLevel({ hasModel: loaded !== null });
    if (detailHeld !== null && detailHeld.key === detail.key && detailHeld.level === level) return detailHeld;
    disposeDetail();
    const airframe = loaded === null ? null : buildModelAirframe(three, loaded, { spec: detail.spec,
      livery: detail.livery, textures: sharedLiveryTextures() });
    const model = buildDetail(three, detail.spec, {
      code: detail.code, livery: detail.livery, registration: detail.registration, createCanvas, night,
      logo: logos.get(detail.livery.logoTexture) ?? null, airframe,
    });
    model.object.matrixAutoUpdate = false;
    const shadow = new three.Mesh(buildGeometry(three, detail.spec), new three.MeshBasicMaterial({
      color: DETAIL_SHADOW.colour, transparent: true, opacity: DETAIL_SHADOW.opacity, depthWrite: false,
    }));
    shadow.matrixAutoUpdate = false;
    shadow.frustumCulled = false;
    detailScene.add(model.object, shadow);
    detailHeld = { key: detail.key, level, model, shadow, idleSince: null, builtAt: time,
      logoTexture: detail.livery.logoTexture ?? null };
    requestLogo(detail.livery);
    return detailHeld;
  }

  // Poses and draws the detailed aircraft of the plan, if any, in its own frame; schedules the next blink.
  function renderDetail(detail, mainMatrix, target, time) {
    detailDrawn = null;
    if (detail == null || detailScene === null) {
      if (detailHeld !== null) {
        detailHeld.model.object.visible = false;
        detailHeld.shadow.visible = false;
        detailHeld.idleSince ??= time;
      }
      return;
    }
    const held = detailModel(detail, time);
    held.idleSince = null;
    const frame = mercatorFrame([detail.lon, detail.lat]);
    detailCamera.projectionMatrix.fromArray(mainMatrix).multiply(new three.Matrix4().fromArray(frame.matrix));
    detailCamera.projectionMatrixInverse.copy(detailCamera.projectionMatrix).invert();
    // The floor of the zoom (minModelPx) applies to it as to the traffic: never a speck at a far zoom.
    const length = detail.spec.lengthM;
    const scale = floorM > 0 && !detail.onStand ? Math.min(MAX_MODEL_SCALE, Math.max(1, floorM / length)) : 1;
    held.model.object.matrix.fromArray(poseMatrix({
      z: detail.heightM, headingDeg: detail.headingDeg, pitchDeg: detail.pitchDeg, bankDeg: detail.bankDeg,
      pivotY: held.model.pivot.y, pivotZ: held.model.pivot.z, scale,
    }));
    held.model.object.matrixWorldNeedsUpdate = true;
    held.model.object.visible = true;
    held.shadow.matrix.fromArray(poseMatrix({ z: SHADOW.heightM, headingDeg: detail.headingDeg, scale,
      flatten: SHADOW.flatten }));
    held.shadow.matrixWorldNeedsUpdate = true;
    held.shadow.visible = quality.shadows;
    const moving = detail.gsMs > 0.5 || detail.lights?.beacon === true;
    held.model.setState({ gearDown: detail.gearDown, lights: detail.lights ?? {}, timeMs: time, night,
      propellerRpm: moving ? PROPELLER_RPM : 0 });
    renderer.render(detailScene, detailCamera);
    detailDrawn = held;
    const wait = nextBlinkInMs(time, detail.lights ?? {});
    if (Number.isFinite(wait) && blinkTimer === null) {
      blinkTimer = setTimeout(() => {
        blinkTimer = null;
        if (!removed) map?.triggerRepaint();
      }, wait);
    }
    if (target === null) return;
  }

  function syncLighting() {
    const sun = getSun();
    const direction = isSun(sun) ? skyDirection(sun) : null;
    if (appliedSun !== undefined && sameSun(appliedSun, direction)) return;
    appliedSun = direction;
    const lighting = sceneLighting(sun, palette);
    hemisphere.color.setRGB(...lighting.hemisphere.skyColor);
    hemisphere.groundColor.setRGB(...lighting.hemisphere.groundColor);
    hemisphere.intensity = lighting.hemisphere.intensity;
    sunLight.color.setRGB(...lighting.directional.color);
    sunLight.intensity = lighting.directional.intensity;
    // A directional light shines from its position toward its target, which stays at the origin.
    sunLight.position.set(...lighting.directional.direction);
    // The detailed aircraft's scene has the same light; its halos glow brighter by night.
    detailHemisphere.color.copy(hemisphere.color);
    detailHemisphere.groundColor.copy(hemisphere.groundColor);
    detailHemisphere.intensity = hemisphere.intensity;
    detailSun.color.copy(sunLight.color);
    detailSun.intensity = sunLight.intensity;
    detailSun.position.copy(sunLight.position);
    night = lighting.phase !== 'day';
  }

  function replaceRenderer(nextContext) {
    const previous = renderer;
    renderer = null;
    if (previous !== null) {
      try {
        previous.dispose();
      } catch {
        // A renderer of a lost context may fail to free what the GPU has already dropped.
      }
    }
    context = nextContext;
    try {
      renderer = createRenderer({ canvas: map.getCanvas(), context: nextContext });
      renderer.autoClear = false;
    } catch (error) {
      renderer = null;
      if (!warned) {
        warned = true;
        console.warn('The 3D aircraft could not be drawn; the map keeps its 2D aircraft.', error);
      }
    }
    rebuild = renderer === null;
  }

  // On a map whose context works but without a renderer, the layer draws and picks nothing. It reports every change of
  // that state, last in each lifecycle call, so that the map shows its 2D aircraft again while the layer has failed.
  function reportFailed() {
    const next = !removed && !lost && renderer === null;
    if (next === failed) return;
    failed = next;
    onFailedChange?.(failed);
  }

  function onContextLost() {
    lost = true;
    rebuild = true;
    reportFailed();
  }

  function onContextRestored() {
    lost = false;
    if (removed || map === null) return;
    if (rebuild) replaceRenderer(context);
    map.triggerRepaint();
    reportFailed();
  }

  function listenTo(nextMap) {
    if (listening === nextMap) return;
    stopListening();
    nextMap.on('webglcontextlost', onContextLost);
    nextMap.on('webglcontextrestored', onContextRestored);
    listening = nextMap;
  }

  function stopListening() {
    if (listening === null) return;
    listening.off('webglcontextlost', onContextLost);
    listening.off('webglcontextrestored', onContextRestored);
    listening = null;
  }

  return {
    id: AIRCRAFT_3D_LAYER_ID,
    type: 'custom',
    renderingMode: '3d',

    onAdd(nextMap, nextContext) {
      if (scene === null) buildScene();
      const moved = nextMap !== map;
      listenTo(nextMap);
      map = nextMap;
      removed = false;
      // MapLibre adds a layer only with a working painter: a context it adds the layer on again is a working one.
      lost = false;
      if (renderer === null || rebuild || moved || nextContext !== context) replaceRenderer(nextContext);
      reportFailed();
    },

    render(frameContext, options) {
      if (removed || lost || renderer === null) return;
      const mainMatrix = options?.defaultProjectionData?.mainMatrix;
      if (mainMatrix == null) return;
      projection.fromArray(mainMatrix).multiply(frameMatrix);
      camera.projectionMatrix.copy(projection);
      camera.projectionMatrixInverse.copy(projection).invert();
      const time = now();
      const answer = getInstances();
      if (levelsChanged()) copied = false;
      syncInstances(time, answer);
      syncFloor();
      retireIdle(time);
      syncLighting();
      // state.reset() sets the viewport to the canvas: the drawing buffer's is set after it.
      const target = frameContext ?? context;
      renderer.resetState();
      renderer.setViewport(0, 0, target.drawingBufferWidth, target.drawingBufferHeight);
      renderer.render(scene, camera);
      renderDetail(answer?.detail ?? null, mainMatrix, target, time);
      drawn = true;
    },

    onRemove() {
      removed = true;
      drawn = false;
      stopListening();
      for (const held of meshes.values()) disposeHeld(held);
      meshes.clear();
      disposeDetail();
      detailDrawn = null;
      if (blinkTimer !== null) {
        clearTimeout(blinkTimer);
        blinkTimer = null;
      }
      detailScene?.clear();
      detailScene = null;
      detailCamera = null;
      detailHemisphere = null;
      detailSun = null;
      liveryTextures?.dispose();
      liveryTextures = null;
      if (scene !== null) {
        lines.geometry.dispose();
        lineMaterial.dispose();
        material.dispose();
        scene.clear();
      }
      scene = null;
      camera = null;
      material = null;
      hemisphere = null;
      sunLight = null;
      lines = null;
      lineMaterial = null;
      if (renderer !== null) {
        try {
          renderer.dispose();
        } catch {
          // Nothing is left to free on a lost context.
        }
      }
      renderer = null;
      map = null;
      context = null;
      rebuild = false;
      reportFailed();
    },

    pick(point) {
      if (removed || lost || renderer === null || !drawn || map === null) return null;
      const x = Array.isArray(point) ? point[0] : point?.x;
      const y = Array.isArray(point) ? point[1] : point?.y;
      const canvas = map.getCanvas();
      const width = canvas?.clientWidth;
      const height = canvas?.clientHeight;
      if (!finite(x) || !finite(y) || !(width > 0) || !(height > 0)) return null;
      const ndcX = (2 * x) / width - 1;
      const ndcY = 1 - (2 * y) / height;
      near.set(ndcX, ndcY, -1).applyMatrix4(camera.projectionMatrixInverse);
      far.set(ndcX, ndcY, 1).applyMatrix4(camera.projectionMatrixInverse).sub(near);
      if (![near.x, near.y, near.z, far.x, far.y, far.z].every(Number.isFinite) || far.lengthSq() === 0) return null;
      // The detailed aircraft first, in its own frame (its lights and halos are no aircraft).
      if (detailDrawn !== null && detailCamera !== null) {
        const detailNear = new three.Vector3(ndcX, ndcY, -1).applyMatrix4(detailCamera.projectionMatrixInverse);
        const detailFar = new three.Vector3(ndcX, ndcY, 1).applyMatrix4(detailCamera.projectionMatrixInverse).sub(detailNear);
        if ([detailNear.x, detailNear.y, detailNear.z, detailFar.x, detailFar.y, detailFar.z].every(Number.isFinite)
          && detailFar.lengthSq() > 0) {
          raycaster.set(detailNear, detailFar.normalize());
          const hit = raycaster.intersectObject(detailDrawn.model.object, true)
            .find(item => item.object.visible && item.object.name !== 'light' && item.object.name !== 'halo');
          const id = getInstances()?.detail?.id;
          if (hit && id != null) return { kind: 'aircraft', id };
        }
      }
      raycaster.set(near, far.normalize());
      const targets = [...meshes.values()].filter(held => held.mesh.count > 0).map(held => held.mesh);
      for (const hit of raycaster.intersectObjects(targets, false)) {
        const id = meshes.get(hit.object.userData.key)?.ids[hit.instanceId];
        if (id != null) return { kind: 'aircraft', id };
      }
      return null;
    },

    setQuality({ shadows, dropLines } = {}) {
      if (typeof shadows === 'boolean') quality.shadows = shadows;
      if (typeof dropLines === 'boolean') quality.dropLines = dropLines;
      for (const held of meshes.values()) applyCount(held);
      if (lines !== null) lines.visible = quality.dropLines;
      if (!removed) map?.triggerRepaint();
      return { ...quality };
    },

    stats() {
      let instances = 0;
      let triangles = 0;
      let drawCalls = 0;
      let modelled = 0;
      for (const held of meshes.values()) {
        if (held.level === 'l1' && held.mesh.count > 0) modelled += 1;
        instances += held.mesh.count;
        triangles += held.mesh.count * held.triangles;
        if (held.mesh.count > 0) drawCalls += 1;
        // A type at L1: its shadows, in its procedural model.
        const shadows = held.shadow?.mesh?.count ?? 0;
        if (shadows > 0) {
          instances += shadows;
          triangles += shadows * held.shadow.triangles;
          drawCalls += 1;
        }
      }
      if (lines !== null && lines.visible && lines.geometry.drawRange.count > 0) drawCalls += 1;
      // The detailed aircraft (CN-30): what of it is on screen.
      let detail = null;
      if (detailDrawn !== null) {
        let detailTriangles = 0;
        let detailCalls = 0;
        detailDrawn.model.object.traverseVisible(node => {
          if (!node.isMesh) return;
          const index = node.geometry.getIndex();
          detailTriangles += (index === null ? node.geometry.getAttribute('position').count : index.count) / 3;
          detailCalls += 1;
        });
        if (detailDrawn.shadow.visible) detailCalls += 1;
        triangles += detailTriangles;
        drawCalls += detailCalls;
        detail = { key: detailDrawn.key, triangles: detailTriangles, drawCalls: detailCalls,
          textured: detailDrawn.model.textured, ...(detailDrawn.level === 'l2' ? { level: 'l2' } : {}) };
      }
      // `models`: how many types draw their L1 model (PR M5), when any does.
      return { meshes: meshes.size, instances, triangles, drawCalls, lost, failed,
        ...(modelled > 0 ? { models: modelled } : {}), ...(detail === null ? {} : { detail }) };
    },
  };
}
