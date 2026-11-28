import { ATLAS_RATIO, ATLAS_SIZE, drawSpriteAtlas } from './spriteAtlas';

// The flat sprites of the animated traffic (PR M2): the silhouettes, dashed rings and «Demo» plates of
// aircraft/instancePlan.js: planSprites, drawn by the 3D aircraft layer (aircraft3dLayer.js) as one InstancedMesh of a
// unit square on the ground of its frame, textured from the atlas of aircraft/spriteAtlas.js. Its shader sizes each
// square in CSS pixels (times the metres of a pixel at the frame's zoom, a uniform), so a sprite keeps its size on screen
// as a MapLibre icon does, and paints a tinted image's shape (red) in its instance colour over its halo (green) in its
// halo colour; colours are sRGB and written as they are, as MapLibre writes its own. No depth: the sprites draw over the
// ground and the buildings, in the order of the plan, as the GeoJSON symbols did. `three` is a parameter, as for the
// layer (aircraft3dChunk.js: THREE_PARTS).

const VERTEX_SHADER = `
attribute vec3 instanceHalo;
attribute float instanceOpacity;
attribute vec2 instanceSize;
attribute vec2 instanceOffset;
attribute vec4 instanceCell;
attribute float instancePlain;
uniform float metresPerPx;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vHalo;
varying float vOpacity;
varying float vPlain;
void main() {
  vUv = instanceCell.xy + uv * instanceCell.zw;
#ifdef USE_INSTANCING_COLOR
  vTint = instanceColor;
#else
  vTint = vec3(1.0);
#endif
  vHalo = instanceHalo;
  vOpacity = instanceOpacity;
  vPlain = instancePlain;
  vec2 local = (position.xy * instanceSize + instanceOffset) * metresPerPx;
  gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(local, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER = `
uniform sampler2D atlas;
varying vec2 vUv;
varying vec3 vTint;
varying vec3 vHalo;
varying float vOpacity;
varying float vPlain;
void main() {
  vec4 texel = texture2D(atlas, vUv);
  vec3 colour = texel.rgb;
  if (vPlain < 0.5) {
    float cover = texel.r + texel.g;
    colour = mix(vHalo, vTint, cover > 0.0 ? texel.r / cover : 0.0);
  }
  float alpha = texel.a * vOpacity;
  if (alpha < 0.004) discard;
  gl_FragColor = vec4(colour, alpha);
}
`;

/** The per-instance attributes of the sprites, with their sizes: what planSprites answers for each. */
export const SPRITE_ATTRIBUTES = Object.freeze([
  ['instanceHalo', 'halos', 3], ['instanceOpacity', 'opacities', 1], ['instanceSize', 'sizes', 2],
  ['instanceOffset', 'offsets', 2], ['instanceCell', 'cells', 4], ['instancePlain', 'plain', 1],
]);

/** A sprite is picked within this share of its half size from its centre. */
export const PICK_SHARE = 0.75;

const nextPowerOfTwo = value => 2 ** Math.ceil(Math.log2(Math.max(1, value)));

/**
 * The sprites of one layer: `{ object, sync(sprites), setMetresPerPx(value), pick(x, y, toPixel), stats(), dispose() }`.
 * - `object`: the InstancedMesh, for the layer's scene;
 * - `sync(sprites)`: copies planSprites' answer (or null: none) into the mesh;
 * - `pick(x, y, toPixel)`: the id of the aircraft whose silhouette is under the CSS pixel, or null; `toPixel(x, y, z)`
 *   answers the CSS pixel `{ x, y }` of a point of the frame;
 * - `createCanvas(width, height)` makes the atlas's canvas; it throws, with nothing built, when there is none or it
 *   has no 2D context (the layer then keeps the GeoJSON icons).
 */
export function createTrafficSprites({ three, createCanvas, theme = 'dark', ratio = ATLAS_RATIO } = {}) {
  const canvas = createCanvas?.(ATLAS_SIZE.width * ratio, ATLAS_SIZE.height * ratio) ?? null;
  const context = canvas?.getContext?.('2d') ?? null;
  if (context === null) throw new TypeError('The traffic sprites need a 2D canvas');
  drawSpriteAtlas(context, { ratio, theme });
  const texture = new three.CanvasTexture(canvas);
  texture.flipY = false;
  texture.premultiplyAlpha = false;
  texture.colorSpace = three.NoColorSpace ?? '';
  texture.needsUpdate = true;
  const material = new three.ShaderMaterial({
    uniforms: { atlas: { value: texture }, metresPerPx: { value: 1 } },
    vertexShader: VERTEX_SHADER,
    fragmentShader: FRAGMENT_SHADER,
    transparent: true,
    depthTest: false,
    depthWrite: false,
  });

  let geometry = null;
  let mesh = null;
  let capacity = 0;
  let current = null;
  const group = new three.Group();
  group.matrixAutoUpdate = false;
  group.name = 'traffic-sprites';

  function quad(size) {
    const made = new three.BufferGeometry();
    made.setAttribute('position', new three.Float32BufferAttribute([-0.5, -0.5, 0, 0.5, -0.5, 0, 0.5, 0.5, 0, -0.5, 0.5, 0], 3));
    // The image's top (v = 0 in the unflipped atlas) at the square's +y: the nose of a silhouette at its track.
    made.setAttribute('uv', new three.Float32BufferAttribute([0, 1, 1, 1, 1, 0, 0, 0], 2));
    made.setIndex([0, 1, 2, 0, 2, 3]);
    for (const [name, , width] of SPRITE_ATTRIBUTES) {
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
    mesh.instanceMatrix.setUsage(three.DynamicDrawUsage);
    mesh.instanceColor = new three.InstancedBufferAttribute(new Float32Array(3 * capacity), 3);
    mesh.instanceColor.setUsage(three.DynamicDrawUsage);
    mesh.frustumCulled = false;
    mesh.matrixAutoUpdate = false;
    mesh.renderOrder = 10;
    mesh.name = 'traffic-sprites';
    mesh.count = 0;
    group.add(mesh);
  }

  return {
    object: group,

    sync(sprites) {
      const count = sprites?.count > 0 ? sprites.count : 0;
      current = count > 0 ? sprites : null;
      if (count === 0) {
        if (mesh !== null) mesh.count = 0;
        return;
      }
      grow(count);
      mesh.instanceMatrix.array.set(sprites.matrices);
      mesh.instanceMatrix.needsUpdate = true;
      mesh.instanceColor.array.set(sprites.colors);
      mesh.instanceColor.needsUpdate = true;
      for (const [name, key] of SPRITE_ATTRIBUTES) {
        const attribute = geometry.getAttribute(name);
        attribute.array.set(sprites[key]);
        attribute.needsUpdate = true;
      }
      mesh.count = count;
    },

    setMetresPerPx(value) {
      if (Number.isFinite(value) && value > 0) material.uniforms.metresPerPx.value = value;
    },

    metresPerPx: () => material.uniforms.metresPerPx.value,

    pick(x, y, toPixel) {
      if (current === null) return null;
      let best = null;
      let bestDistance = Infinity;
      for (let index = 0; index < current.count; index += 1) {
        const id = current.ids[index];
        if (id == null) continue;
        const pixel = toPixel(current.matrices[16 * index + 12], current.matrices[16 * index + 13], 0);
        if (pixel === null) continue;
        const distance = Math.hypot(pixel.x - x, pixel.y - y);
        const reach = (PICK_SHARE * Math.max(current.sizes[2 * index], current.sizes[2 * index + 1])) / 2;
        // The topmost of those under the pointer (drawn last), else the nearest.
        if (distance <= reach && distance <= bestDistance + 1e-9) {
          best = id;
          bestDistance = distance;
        }
      }
      return best;
    },

    stats: () => ({ count: mesh?.count ?? 0, capacity }),

    dispose() {
      if (mesh !== null) {
        group.remove(mesh);
        mesh.dispose();
        geometry.dispose();
      }
      mesh = null;
      geometry = null;
      capacity = 0;
      current = null;
      material.dispose();
      texture.dispose();
      group.removeFromParent();
    },
  };
}
