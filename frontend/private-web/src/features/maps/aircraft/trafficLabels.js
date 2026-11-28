import { TAG_LAYOUT_MS, anchorOffset, placeTags } from '../traffic/tagLayout';
import { createLabelAtlas, documentFontFamily, tagKey, tagSize } from './labelAtlas';

// The tags and the chosen aircraft's ring of the animated traffic (PR M2), drawn by the 3D aircraft layer
// (aircraft3dLayer.js) over its models and sprites as one InstancedMesh of quads facing the screen, textured from the
// canvas atlas of aircraft/labelAtlas.js. Each quad is anchored to its aircraft where the frame draws it and set a fixed
// number of pixels beside it, at the anchor the layout chose (traffic/tagLayout.js: placeTags, on the CPU, a few times a
// second); its corners land on whole device pixels, so the words stay sharp while the aircraft moves. Picked on the CPU:
// the tag under the pointer names its aircraft. `three` is a parameter, as for the layer (aircraft3dChunk.js).

const VERTEX_SHADER = `
attribute vec3 instanceAnchor;
attribute vec2 instanceOffset;
attribute vec2 instanceSize;
attribute vec4 instanceCell;
attribute float instanceOpacity;
uniform vec2 viewport;
uniform float pixelRatio;
varying vec2 vUv;
varying float vOpacity;
void main() {
  vUv = instanceCell.xy + uv * instanceCell.zw;
  vOpacity = instanceOpacity;
  vec4 clip = projectionMatrix * modelViewMatrix * vec4(instanceAnchor, 1.0);
  if (clip.w <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    return;
  }
  vec2 screen = (clip.xy / clip.w * 0.5 + 0.5) * viewport;
  vec2 corner = screen + vec2(instanceOffset.x, -instanceOffset.y) - 0.5 * instanceSize;
  corner = floor(corner * pixelRatio + 0.5) / pixelRatio;
  vec2 point = corner + (position.xy + 0.5) * instanceSize;
  gl_Position = vec4(point / viewport * 2.0 - 1.0, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D atlas;
varying vec2 vUv;
varying float vOpacity;
void main() {
  vec4 texel = texture2D(atlas, vUv);
  float alpha = texel.a * vOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(texel.rgb, alpha);
}
`;

/** The per-instance attributes of the quads, with their sizes. */
export const LABEL_ATTRIBUTES = Object.freeze([
  ['instanceAnchor', 3], ['instanceOffset', 2], ['instanceSize', 2], ['instanceCell', 4], ['instanceOpacity', 1],
]);

const SIZE_MEMO_LIMIT = 1_024;
const nextPowerOfTwo = value => 2 ** Math.ceil(Math.log2(Math.max(1, value)));
const finite = value => typeof value === 'number' && Number.isFinite(value);

// The key of what the layout depends on besides the positions: which tags may show and how.
const candidatesKey = tags => tags.map(item => `${item.id}:${item.priority}:${item.always ? 1 : 0}:${tagKey(item.tag)}`)
  .join('|');

/**
 * The tags of one layer: `{ object, frame(labels, view), pick(x, y, toPixel), invalidate(), stats(), dispose() }`.
 * - `frame(labels, { toPixel, viewport: { width, height }, pixelRatio, nowMs })`: the frame's `labels` (planLabels:
 *   `{ tags, marks, ring, rest }` in the frame's metres, or null) laid out again when due and written into the mesh;
 *   `toPixel(x, y, z)` answers the CSS pixel `{ x, y }` of a point of the frame, or null;
 * - `pick(x, y, toPixel)`: the id of the aircraft whose tag is under the CSS pixel, or null (the ring is no tag);
 * - `createCanvas(width, height)` makes the atlas's canvas; it throws, with nothing built, when there is none.
 */
export function createTrafficLabels({ three, createCanvas, theme = 'dark', ratio = 2, fontFamily, makePath } = {}) {
  const family = fontFamily ?? documentFontFamily();
  const atlas = createLabelAtlas({ createCanvas, ratio, theme, fontFamily: family, makePath });
  const measureContext = atlas.canvas.getContext('2d');
  let texture = null;
  const makeTexture = () => {
    const made = new three.CanvasTexture(atlas.canvas);
    made.flipY = false;
    made.premultiplyAlpha = false;
    made.generateMipmaps = false;
    if (three.LinearFilter !== undefined) {
      made.minFilter = three.LinearFilter;
      made.magFilter = three.LinearFilter;
    }
    made.colorSpace = three.NoColorSpace ?? '';
    made.needsUpdate = true;
    return made;
  };
  texture = makeTexture();
  const material = new three.ShaderMaterial({
    uniforms: { atlas: { value: texture }, viewport: { value: new three.Vector2(1, 1) }, pixelRatio: { value: 1 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  const group = new three.Group();
  group.matrixAutoUpdate = false;
  group.name = 'traffic-labels';
  let geometry = null;
  let mesh = null;
  let capacity = 0;
  // The layout: the anchors of the tags that show, when it ran, and on what.
  let anchors = new Map();
  let laidOutAt = null;
  let laidOutKey = null;
  let laidOutOn = null;
  let laidOutViewport = '';
  let layouts = 0;
  // What the mesh draws now, top first, for the pick: `{ id, x, y, dx, dy, width, height }` in the frame and pixels.
  let drawn = [];
  const sizes = new Map();

  function quad(size) {
    const made = new three.BufferGeometry();
    made.setAttribute('position', new three.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    made.setAttribute('uv', new three.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    made.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, width] of LABEL_ATTRIBUTES) {
      const attribute = new three.InstancedBufferAttribute(new Float32Array(width * size), width);
      attribute.setUsage(three.DynamicDrawUsage);
      made.setAttribute(name, attribute);
    }
    return made;
  }

  function grow(count) {
    if (mesh !== null && capacity >= count) return;
    if (mesh !== null) {
      group.remove(mesh);
      mesh.dispose();
      geometry.dispose();
    }
    capacity = nextPowerOfTwo(Math.max(count, 16));
    geometry = quad(capacity);
    mesh = new three.InstancedMesh(geometry, material, capacity);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 20;
    mesh.name = 'traffic-labels';
    mesh.count = 0;
    group.add(mesh);
  }

  function sizeOf(tag) {
    const key = tagKey(tag);
    let size = sizes.get(key);
    if (size === undefined) {
      if (sizes.size >= SIZE_MEMO_LIMIT) sizes.clear();
      size = tagSize(measureContext, tag, { fontFamily: family });
      sizes.set(key, size);
    }
    return size;
  }

  // The tags placed again: their aircraft and the silhouettes on screen now, the anchors they had tried first.
  function layout(labels, toPixel, viewport) {
    const candidates = [];
    for (const item of labels.tags) {
      const pixel = toPixel(item.x, item.y, 0);
      if (pixel === null) continue;
      const { width, height } = sizeOf(item.tag);
      candidates.push({ id: item.id, x: pixel.x, y: pixel.y, width, height, offsetPx: item.offsetPx,
        priority: item.priority, always: item.always });
    }
    const obstacles = [];
    for (const mark of labels.marks ?? []) {
      const pixel = toPixel(mark.x, mark.y, 0);
      if (pixel === null) continue;
      const r = mark.radius;
      obstacles.push({ id: mark.id, left: pixel.x - r, top: pixel.y - r, right: pixel.x + r, bottom: pixel.y + r });
    }
    anchors = placeTags(candidates, { obstacles, previous: anchors, viewport });
    const words = new Map();
    for (const item of labels.tags) if (anchors.has(item.id)) words.set(item.id, item.tag);
    atlas.update(words);
    if (atlas.takeResized()) {
      texture.dispose();
      texture = makeTexture();
      material.uniforms.atlas.value = texture;
      atlas.takeDirty();
    } else if (atlas.takeDirty()) texture.needsUpdate = true;
    layouts += 1;
  }

  function write(labels) {
    const byId = new Map(labels.tags.map(item => [item.id, item]));
    const entries = [];
    // The chosen aircraft's ring under its tag, the tags placed first on top.
    if (labels.ring) {
      const cell = atlas.ringCell();
      entries.push({ id: null, x: labels.ring.x, y: labels.ring.y, dx: 0, dy: 0, cell, opacity: 1 });
    }
    const placed = [...anchors.keys()];
    for (let index = placed.length - 1; index >= 0; index -= 1) {
      const id = placed[index];
      const item = byId.get(id);
      const cell = atlas.cellOf(id);
      if (item === undefined || cell === null) continue;
      const [dx, dy] = anchorOffset(anchors.get(id), cell.width, cell.height, item.offsetPx);
      entries.push({ id, x: item.x, y: item.y, dx, dy, cell, opacity: finite(item.opacity) ? item.opacity : 1 });
    }
    if (entries.length === 0) {
      if (mesh !== null) mesh.count = 0;
      drawn = [];
      return;
    }
    grow(entries.length);
    const attributes = Object.fromEntries(LABEL_ATTRIBUTES.map(([name]) => [name, geometry.getAttribute(name)]));
    entries.forEach((entry, index) => {
      attributes.instanceAnchor.array.set([entry.x, entry.y, 0], 3 * index);
      attributes.instanceOffset.array.set([entry.dx, entry.dy], 2 * index);
      attributes.instanceSize.array.set([entry.cell.width, entry.cell.height], 2 * index);
      attributes.instanceCell.array.set(entry.cell.uv, 4 * index);
      attributes.instanceOpacity.array[index] = entry.opacity;
    });
    for (const attribute of Object.values(attributes)) attribute.needsUpdate = true;
    mesh.count = entries.length;
    drawn = entries.filter(entry => entry.id !== null).reverse()
      .map(({ id, x, y, dx, dy, cell }) => ({ id, x, y, dx, dy, width: cell.width, height: cell.height }));
  }

  return {
    object: group,

    frame(labels, { toPixel, viewport, pixelRatio = 1, nowMs = 0 } = {}) {
      if (viewport?.width > 0 && viewport?.height > 0) {
        material.uniforms.viewport.value.set(viewport.width, viewport.height);
      }
      if (finite(pixelRatio) && pixelRatio > 0) material.uniforms.pixelRatio.value = pixelRatio;
      if (labels == null || ((labels.tags?.length ?? 0) === 0 && !labels.ring)) {
        if (mesh !== null) mesh.count = 0;
        drawn = [];
        anchors = new Map();
        laidOutKey = null;
        laidOutOn = labels ?? null;
        return;
      }
      const key = candidatesKey(labels.tags);
      const viewportKey = viewport ? `${viewport.width}x${viewport.height}` : '';
      const due = key !== laidOutKey || laidOutAt === null || nowMs - laidOutAt >= TAG_LAYOUT_MS || nowMs < laidOutAt
        || viewportKey !== laidOutViewport || (labels.rest === true && laidOutOn !== labels);
      if (due && typeof toPixel === 'function') {
        layout(labels, toPixel, viewport ?? null);
        laidOutAt = nowMs;
        laidOutKey = key;
        laidOutOn = labels;
        laidOutViewport = viewportKey;
      }
      write(labels);
    },

    pick(x, y, toPixel) {
      for (const entry of drawn) {
        const pixel = toPixel(entry.x, entry.y, 0);
        if (pixel === null) continue;
        const cx = pixel.x + entry.dx;
        const cy = pixel.y + entry.dy;
        if (Math.abs(x - cx) <= entry.width / 2 && Math.abs(y - cy) <= entry.height / 2) return entry.id;
      }
      return null;
    },

    /** The app's font has loaded: every tag is written again at the next layout. */
    invalidate() {
      atlas.invalidate();
      sizes.clear();
      laidOutKey = null;
    },

    /** The anchors of the last layout, by id (for tests and the map lab). */
    anchors: () => new Map(anchors),

    stats: () => ({ count: drawn.length, ring: mesh !== null && mesh.count > drawn.length, layouts, ...atlas.stats() }),

    dispose() {
      if (mesh !== null) {
        group.remove(mesh);
        mesh.dispose();
        geometry.dispose();
      }
      mesh = null;
      geometry = null;
      capacity = 0;
      drawn = [];
      material.dispose();
      texture.dispose();
      group.removeFromParent();
    },
  };
}
