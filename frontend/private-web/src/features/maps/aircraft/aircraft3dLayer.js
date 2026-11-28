import { OCC_PALETTE } from '../../occ-ui/occPalette';
import { CIVIL_TWILIGHT_DEG, dayPhase } from '../traffic/solar';
import { buildDetailedAircraft, nextBlinkInMs } from './aircraftDetail';
import { buildAircraftGeometry, triangleCount, withLiveryZones } from './aircraftGeometry';
import { contactDisc, contactShadowMatrix, contactShadowSize, contactShadowStrength } from './contactShadow';
import { LIVERY_ZONES } from './liveries';
import { SHADOW, linearRgb, mercatorFrame, poseMatrix } from './instancePlan';

// The 3D aircraft as one MapLibre custom layer (design G1, G3 and G4): three draws the instance plan
// (aircraft/instancePlan.js) on the map's own canvas and WebGL context, in the depth buffer the terminals' extrusions
// share, so a building hides an aircraft behind it.
//
// - Frame: the scene is the local frame of the ARP (x east, y north, z up, in metres); the projection is the map's
//   mainMatrix times the frame's matrix, so no camera moves and the models stand where the 2D layers draw them.
// - One InstancedMesh per type present, each with its own model (aircraft/aircraftGeometry.js) and one white Lambert
//   material shared by all, tinted per instance: a handful of draw calls and no model files (Decision G-1). M9: the
//   tint is per zone of the livery (aircraft/liveries.js: LIVERY_ZONES), the fuselage in three's instanceColor and the
//   belly, fin, engines and wings in instance attributes of their own, chosen by the model's `liveryZone`
//   (patchLiveryShader), so an aircraft wears its airline's colours in the same single draw call.
// - The matrices are copied only when the plan's revision changes; a type that leaves the plan keeps its mesh for
//   five minutes, in case it comes back, and then gives it and its model up.
// - Light: a hemisphere light and a directional light from the sun by day; by night a dim cool ambient and a fixed
//   light from high up, so the models still read; the civil twilight blends the two.
// - Contact shadows (M4, 2026-11-28): a soft ellipse on the ground under each aircraft (contactShadow.js), one
//   InstancedMesh for all, drawn first without depth writes and blended as ground × (1 − darkness × strength), so it
//   only darkens what is under it; the detailed aircraft has its own. The governor's shadows switch takes them away.
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

// The zones besides the fuselage, each an instance attribute of the model: `instanceBelly`, `instanceTail`…
const EXTRA_ZONES = Object.freeze(LIVERY_ZONES.filter(zone => zone !== 'fuselage'));
const zoneAttribute = zone => `instance${zone[0].toUpperCase()}${zone.slice(1)}`;

/** The instance attributes of the zones of a livery besides the fuselage (three's instanceColor), in LIVERY_ZONES order. */
export const LIVERY_ZONE_ATTRIBUTES = Object.freeze(EXTRA_ZONES.map(zoneAttribute));

// The vertex colour of a zone: liveryZone < 0.5 the fuselage, < 1.5 the belly, … the last zone otherwise.
const ZONE_COLOURS = ['instanceColor.rgb', ...LIVERY_ZONE_ATTRIBUTES];
const ZONE_CHOICE = ZONE_COLOURS.slice(0, -1).map((name, index) => `liveryZone < ${index + 0.5} ? ${name} : `).join('')
  + ZONE_COLOURS.at(-1);
const LIVERY_PARS_VERTEX = ['#include <color_pars_vertex>', 'attribute float liveryZone;',
  ...LIVERY_ZONE_ATTRIBUTES.map(name => `attribute vec3 ${name};`)].join('\n');
const LIVERY_COLOR_VERTEX = ['#include <color_vertex>', '#ifdef USE_INSTANCING_COLOR', `  vColor.rgb = ${ZONE_CHOICE};`,
  '#endif'].join('\n');

/**
 * The instanced models' material reads the livery (M9): `shader` (three's onBeforeCompile argument) gets the
 * `liveryZone` vertex attribute and the instance attributes of LIVERY_ZONE_ATTRIBUTES, and its vertex colour is the
 * instance colour of the vertex's zone (0 the fuselage, instanceColor). A shader without three's colour chunks throws,
 * so an upgrade of three that renames them fails the tests, not the map. Answers the shader.
 */
export function patchLiveryShader(shader) {
  const source = shader?.vertexShader;
  if (typeof source !== 'string' || !source.includes('#include <color_pars_vertex>')
    || !source.includes('#include <color_vertex>')) {
    throw new Error('The 3D aircraft shader has no colour chunks to paint the livery with');
  }
  shader.vertexShader = source.replace('#include <color_pars_vertex>', LIVERY_PARS_VERTEX)
    .replace('#include <color_vertex>', LIVERY_COLOR_VERTEX);
  return shader;
}

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
const NO_FLOATS = new Float32Array(0);
const CONTACT_MESH_NAME = 'contact-shadows';
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
 * - `createRenderer({ canvas, context })`, `buildGeometry(three, spec)` and `now()` (milliseconds, monotonic) are
 *   for tests.
 *
 * `pick({ x, y })` (CSS pixels from the canvas's top-left corner) answers `{ kind: 'aircraft', id }` with the plan's id
 * of the aircraft under the pointer, or `null` when the ray meets no aircraft (a shadow is no aircraft), before the
 * first frame, while the context is lost and while the layer has failed: the map then picks in 2D.
 * `setQuality({ shadows, dropLines })` lets the frame loop's governor lighten the scene without switching it off.
 * `stats()` → `{ meshes, instances, contacts, triangles, drawCalls, lost, failed }`: the meshes held, the instances and
 * triangles drawn, the contact shadows drawn (M4), the draw calls of the scene, whether the context is lost and whether
 * the layer has failed. It has failed while
 * it is on a map whose context works and three could not build its renderer on that context, so it draws nothing; it
 * has not failed before onAdd, after onRemove or while the context is lost, when nothing draws, 2D included.
 */
export function createAircraft3dLayer({
  three, originLngLat, getInstances, palette = OCC_PALETTE, getSun = () => null, onFailedChange, minModelPx = 0,
  createRenderer = ({ canvas, context }) => new three.WebGLRenderer({ canvas, context, antialias: true }),
  buildGeometry = buildAircraftGeometry, now = () => performance.now(), buildDetail = buildDetailedAircraft,
  createCanvas = documentCanvas, loadImage = loadSameOriginImage,
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
  // M4: the contact shadows of the traffic, in a group of their own (so the scene's direct meshes stay the types'):
  // their disc, material and mesh, the matrices as planned, the floor lengths and how many there are.
  let contactGroup = null;
  let contactGeometry = null;
  let contactMaterial = null;
  let contactMesh = null;
  let contactCapacity = 0;
  let contactCount = 0;
  let contactBase = NO_FLOATS;
  let contactFloors = NO_FLOATS;

  function buildScene() {
    scene = new three.Scene();
    camera = new three.Camera();
    material = new three.MeshLambertMaterial({ color: 0xffffff });
    material.onBeforeCompile = patchLiveryShader;
    material.customProgramCacheKey = () => 'occ-aircraft-livery-zones';
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
    contactGroup = new three.Group();
    contactGroup.matrixAutoUpdate = false;
    scene.add(contactGroup);
    contactGeometry = discGeometry();
    contactMaterial = contactShadowMaterial();
    contactMesh = null;
    contactCapacity = 0;
    contactCount = 0;
    copied = false;
    appliedSun = undefined;
  }

  // The unit disc of the contact shadows (contactShadow.js), its darkness in its vertex colours.
  function discGeometry() {
    const disc = contactDisc();
    const geometry = new three.BufferGeometry();
    geometry.setAttribute('position', new three.Float32BufferAttribute(disc.positions, 3));
    geometry.setAttribute('color', new three.Float32BufferAttribute(disc.colors, 3));
    geometry.setIndex(Array.from(disc.indices));
    return geometry;
  }

  // Ground × (1 − colour): three's subtractive blend, premultiplied, only darkens; no depth written, so the models and
  // their silhouettes drawn after it cover it.
  function contactShadowMaterial() {
    return new three.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, blending: three.SubtractiveBlending,
      premultipliedAlpha: true, depthWrite: false });
  }

  // Copies the contact shadows of the plan (each entry's `contacts` with a strength above 0) into the one mesh.
  function syncContacts(plan) {
    let count = 0;
    for (const entry of plan.values()) {
      for (let index = 0; index < entry.aircraftCount; index += 1) if (entry.contactStrengths?.[index] > 0) count += 1;
    }
    if (count > contactCapacity) {
      if (contactMesh !== null) {
        contactGroup.remove(contactMesh);
        contactMesh.dispose();
      }
      contactCapacity = nextPowerOfTwo(count);
      contactMesh = new three.InstancedMesh(contactGeometry, contactMaterial, contactCapacity);
      contactMesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
      contactMesh.instanceColor = new three.InstancedBufferAttribute(new Float32Array(3 * contactCapacity), 3);
      contactMesh.instanceColor.setUsage(three.DynamicDrawUsage);
      contactMesh.frustumCulled = false;
      contactMesh.matrixAutoUpdate = false;
      contactMesh.renderOrder = -1;
      contactMesh.name = CONTACT_MESH_NAME;
      contactGroup.add(contactMesh);
    }
    contactBase = new Float32Array(16 * count);
    contactFloors = new Float32Array(count);
    let at = 0;
    for (const entry of plan.values()) {
      for (let index = 0; index < entry.aircraftCount; index += 1) {
        const strength = entry.contactStrengths?.[index];
        if (!(strength > 0)) continue;
        contactBase.set(entry.contacts.subarray(16 * index, 16 * index + 16), 16 * at);
        contactFloors[at] = entry.floorLengths?.[index] ?? 0;
        contactMesh.instanceColor.array.fill(strength, 3 * at, 3 * at + 3);
        at += 1;
      }
    }
    contactCount = count;
    if (contactMesh !== null) contactMesh.instanceColor.needsUpdate = true;
    writeContacts();
  }

  // The contact shadows' matrices with the floor of the zoom, as the models' (scaleHeld).
  function writeContacts() {
    if (contactMesh === null) return;
    const target = contactMesh.instanceMatrix.array;
    for (let index = 0; index < contactCount; index += 1) {
      const length = contactFloors[index];
      const factor = floorM > 0 && length > 0 ? Math.min(MAX_MODEL_SCALE, Math.max(1, floorM / length)) : 1;
      const offset = 16 * index;
      for (let element = 0; element < 16; element += 1) {
        const scaled = element < 12 && element % 4 !== 3;
        target[offset + element] = scaled ? contactBase[offset + element] * factor : contactBase[offset + element];
      }
    }
    contactMesh.instanceMatrix.needsUpdate = true;
    applyContactCount();
  }

  function applyContactCount() {
    if (contactMesh === null) return;
    contactMesh.count = quality.shadows ? contactCount : 0;
    contactMesh.boundingSphere = null;
    contactMesh.boundingBox = null;
  }

  function lineGeometry(vertices) {
    const geometry = new three.BufferGeometry();
    const position = new three.Float32BufferAttribute(new Float32Array(3 * vertices), 3);
    position.setUsage(three.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    geometry.setDrawRange(0, 0);
    return geometry;
  }

  function instancedMesh(key, geometry, capacity) {
    const mesh = new three.InstancedMesh(geometry, material, capacity);
    mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
    mesh.instanceColor = new three.InstancedBufferAttribute(new Float32Array(3 * capacity), 3);
    mesh.instanceColor.setUsage(three.DynamicDrawUsage);
    // The livery's other zones (M9), on the model's geometry, sized as the mesh.
    for (const name of LIVERY_ZONE_ATTRIBUTES) {
      const attribute = new three.InstancedBufferAttribute(new Float32Array(3 * capacity), 3);
      attribute.setUsage(three.DynamicDrawUsage);
      geometry.setAttribute(name, attribute);
    }
    mesh.count = 0;
    // The projection is the map's, not a camera's: three's frustum test would cull on a wrong box.
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.name = key;
    mesh.userData.key = key;
    scene.add(mesh);
    return mesh;
  }

  // Shadows come after the aircraft in each mesh, so drawing only the first `aircraftCount` instances drops them.
  function applyCount(held) {
    held.mesh.count = quality.shadows ? held.instances : held.aircraftCount;
    held.mesh.boundingSphere = null;
    held.mesh.boundingBox = null;
  }

  function disposeHeld(held) {
    scene?.remove(held.mesh);
    held.mesh.dispose();
    held.geometry.dispose();
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
      if (held === undefined) {
        const geometry = withLiveryZones(three, buildGeometry(three, entry.spec));
        held = { geometry, triangles: triangleCount(geometry), mesh: null, capacity: 0, aircraftCount: 0, instances: 0,
          ids: NO_IDS, idleSince: null };
        meshes.set(key, held);
      }
      if (held.mesh === null || held.capacity < entry.count) {
        if (held.mesh !== null) {
          scene.remove(held.mesh);
          held.mesh.dispose();
        }
        held.capacity = nextPowerOfTwo(entry.count);
        held.mesh = instancedMesh(key, held.geometry, held.capacity);
      }
      held.base = entry.matrices;
      held.floors = entry.floorLengths ?? null;
      held.mesh.instanceMatrix.array.set(entry.matrices);
      held.mesh.instanceColor.array.set(entry.colors);
      EXTRA_ZONES.forEach((zone, index) => {
        const attribute = held.geometry.getAttribute(LIVERY_ZONE_ATTRIBUTES[index]);
        // A plan without zones (one of before M9) paints every zone in the instance colour.
        attribute.array.set(entry.zoneColors?.[zone] ?? entry.colors);
        attribute.needsUpdate = true;
      });
      held.mesh.instanceMatrix.needsUpdate = true;
      held.mesh.instanceColor.needsUpdate = true;
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
    syncContacts(plan);
    return true;
  }

  // The matrices of a mesh with the traffic's models no shorter than `floor` metres (MAX_MODEL_SCALE at most): the 3 × 3
  // part of each one with a floor length is scaled about its own origin; the rest stay as planned.
  function scaleHeld(held, floor) {
    const { base, floors } = held;
    if (!base || !floors) return;
    const target = held.mesh.instanceMatrix.array;
    for (let index = 0; index < held.instances; index += 1) {
      const length = floors[index];
      const offset = 16 * index;
      const factor = length > 0 ? Math.min(MAX_MODEL_SCALE, Math.max(1, floor / length)) : 1;
      for (let element = 0; element < 16; element += 1) {
        const scaled = element < 12 && element % 4 !== 3;
        target[offset + element] = scaled ? base[offset + element] * factor : base[offset + element];
      }
    }
    held.mesh.instanceMatrix.needsUpdate = true;
    held.mesh.boundingSphere = null;
    held.mesh.boundingBox = null;
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
    writeContacts();
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
    // Its contact shadow shares the traffic's disc: only its material is its own.
    detailHeld.contact.removeFromParent();
    detailHeld.contact.material.dispose();
    detailHeld = null;
  }

  // The detailed aircraft's model for `detail` (built once per type, livery and registration), with its logo once it
  // loads.
  function detailModel(detail, time) {
    if (detailHeld !== null && detailHeld.key === detail.key) return detailHeld;
    disposeDetail();
    const model = buildDetail(three, detail.spec, {
      code: detail.code, livery: detail.livery, registration: detail.registration, createCanvas, night,
      logo: logos.get(detail.livery.logoTexture) ?? null,
    });
    model.object.matrixAutoUpdate = false;
    const shadow = new three.Mesh(buildGeometry(three, detail.spec), new three.MeshBasicMaterial({
      color: DETAIL_SHADOW.colour, transparent: true, opacity: DETAIL_SHADOW.opacity, depthWrite: false,
    }));
    shadow.matrixAutoUpdate = false;
    shadow.frustumCulled = false;
    const contact = new three.Mesh(contactGeometry, contactShadowMaterial());
    contact.matrixAutoUpdate = false;
    contact.frustumCulled = false;
    contact.renderOrder = -1;
    contact.name = CONTACT_MESH_NAME;
    detailScene.add(contact, model.object, shadow);
    detailHeld = { key: detail.key, model, shadow, contact, idleSince: null, builtAt: time };
    const url = detail.livery.logoTexture;
    if (typeof url === 'string' && url !== '' && !logos.has(url)) {
      logos.set(url, null);
      loadImage(url).then(image => {
        logos.set(url, image);
        if (detailHeld?.model.refreshLogo(image)) map?.triggerRepaint();
      }, () => {});
    }
    return detailHeld;
  }

  // Poses and draws the detailed aircraft of the plan, if any, in its own frame; schedules the next blink.
  function renderDetail(detail, mainMatrix, target, time) {
    detailDrawn = null;
    if (detail == null || detailScene === null) {
      if (detailHeld !== null) {
        detailHeld.model.object.visible = false;
        detailHeld.shadow.visible = false;
        detailHeld.contact.visible = false;
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
    // M4: its contact shadow, scaled as the model and fading as it climbs.
    const strength = contactShadowStrength(detail.heightM);
    const size = contactShadowSize(detail.spec, detail.heightM);
    held.contact.matrix.fromArray(contactShadowMatrix({ headingDeg: detail.headingDeg, alongM: size.alongM * scale,
      acrossM: size.acrossM * scale }));
    held.contact.matrixWorldNeedsUpdate = true;
    held.contact.material.color.setScalar(strength);
    held.contact.visible = quality.shadows && strength > 0;
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
      contactMesh?.dispose();
      contactGeometry?.dispose();
      contactMaterial?.dispose();
      contactGroup = null;
      contactGeometry = null;
      contactMaterial = null;
      contactMesh = null;
      contactCapacity = 0;
      contactCount = 0;
      contactBase = NO_FLOATS;
      contactFloors = NO_FLOATS;
      detailCamera = null;
      detailHemisphere = null;
      detailSun = null;
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
      applyContactCount();
      if (lines !== null) lines.visible = quality.dropLines;
      if (!removed) map?.triggerRepaint();
      return { ...quality };
    },

    stats() {
      let instances = 0;
      let triangles = 0;
      let drawCalls = 0;
      for (const held of meshes.values()) {
        instances += held.mesh.count;
        triangles += held.mesh.count * held.triangles;
        if (held.mesh.count > 0) drawCalls += 1;
      }
      if (lines !== null && lines.visible && lines.geometry.drawRange.count > 0) drawCalls += 1;
      const contacts = contactMesh?.count ?? 0;
      if (contacts > 0) drawCalls += 1;
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
        if (detailDrawn.contact.visible) detailCalls += 1;
        triangles += detailTriangles;
        drawCalls += detailCalls;
        detail = { key: detailDrawn.key, triangles: detailTriangles, drawCalls: detailCalls,
          textured: detailDrawn.model.textured };
      }
      return { meshes: meshes.size, instances, contacts, triangles, drawCalls, lost, failed,
        ...(detail === null ? {} : { detail }) };
    },
  };
}
