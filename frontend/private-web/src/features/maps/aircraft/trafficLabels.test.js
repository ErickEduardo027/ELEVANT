import { afterEach, describe, expect, it, vi } from 'vitest';
import { tagTextOf } from '../traffic/trafficFeatures';
import { TAG_LAYOUT_MS, anchorOffset } from '../traffic/tagLayout';
import { THREE_PARTS } from './aircraft3dChunk';
import { LABEL_ATTRIBUTES, createTrafficLabels } from './trafficLabels';

// The tags of the animated traffic (PR M2) with the real three in Node: its mesh needs no WebGL. The frame's metres are
// the screen's pixels here (toPixel), so a tag's place reads directly.
function fakeCanvas(width, height) {
  const context = new Proxy({}, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (key === 'measureText') return text => ({ width: String(text).length * 7 });
      return () => {};
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { width, height, getContext: type => (type === '2d' ? context : null) };
}

const toPixel = (x, y) => ({ x, y });
const viewport = { width: 1_000, height: 800 };
const item = (id, x, y, extra = {}) => ({
  id, x, y, priority: 1, always: false, offsetPx: 15, opacity: 1,
  tag: tagTextOf({ id, kind: 'aviam', flightNumber: id.toUpperCase(), direction: 'Arrival', altM: 600, gsMs: 60 }),
  ...extra,
});

function labelsWorld() {
  vi.stubGlobal('Path2D', class Path2D {});
  const labels = createTrafficLabels({ three: THREE_PARTS, createCanvas: fakeCanvas, fontFamily: 'Manrope' });
  const mesh = () => labels.object.children[0];
  const attribute = name => mesh().geometry.getAttribute(name);
  return { labels, mesh, attribute };
}

afterEach(() => vi.unstubAllGlobals());

describe('createTrafficLabels', () => {
  it('anchors each tag to its aircraft every frame, at the anchor of a layout made four times a second', () => {
    const { labels, mesh, attribute } = labelsWorld();
    const frame = (x, nowMs, extra = {}) => labels.frame({ tags: [item('a', x, 300), item('b', x + 40, 400)], marks: [],
      ring: null, ...extra }, { toPixel, viewport, pixelRatio: 2, nowMs });
    frame(100, 0);
    expect(labels.stats()).toMatchObject({ count: 2, layouts: 1, slots: 2 });
    expect(mesh()).toMatchObject({ isInstancedMesh: true, count: 2, frustumCulled: false });
    expect(mesh().material).toMatchObject({ transparent: true, depthTest: false, depthWrite: false });
    expect(mesh().material.uniforms.viewport.value.toArray()).toEqual([1_000, 800]);
    expect(mesh().material.uniforms.pixelRatio.value).toBe(2);
    const anchors = labels.anchors();
    expect(anchors.get('a')).toBe('left');
    // The frames between two layouts move the quads with their aircraft and keep their anchors.
    frame(120, 16);
    frame(140, 32);
    expect(labels.stats().layouts).toBe(1);
    const anchorsOf = () => Array.from({ length: mesh().count }, (_, index) => attribute('instanceAnchor').array
      .slice(3 * index, 3 * index + 3)[0]).sort((p, q) => p - q);
    expect(anchorsOf()).toEqual([140, 180]);
    frame(160, TAG_LAYOUT_MS + 1);
    expect(labels.stats().layouts).toBe(2);
    // The offset is the anchor's, past the silhouette.
    const index = Array.from({ length: mesh().count }, (_, i) => i)
      .find(i => attribute('instanceAnchor').array[3 * i] === 160);
    const size = attribute('instanceSize').array.slice(2 * index, 2 * index + 2);
    expect([...attribute('instanceOffset').array.slice(2 * index, 2 * index + 2)])
      .toEqual(anchorOffset(labels.anchors().get('a'), size[0], size[1], 15).map(value => expect.closeTo(value, 4)));
    expect(LABEL_ATTRIBUTES.map(([name]) => name)).toEqual(['instanceAnchor', 'instanceOffset', 'instanceSize',
      'instanceCell', 'instanceOpacity']);
  });

  it('lays out again at once when the tags that may show change, and once more where the traffic came to rest', () => {
    const { labels } = labelsWorld();
    const view = nowMs => ({ toPixel, viewport, nowMs });
    labels.frame({ tags: [item('a', 100, 300)], marks: [], ring: null }, view(0));
    labels.frame({ tags: [item('a', 101, 300), item('b', 400, 300)], marks: [], ring: null }, view(10));
    expect(labels.stats()).toMatchObject({ layouts: 2, count: 2 });
    const resting = { tags: [item('a', 102, 300), item('b', 400, 300)], marks: [], ring: null, rest: true };
    labels.frame(resting, view(20));
    expect(labels.stats().layouts).toBe(3);
    labels.frame(resting, view(30));
    expect(labels.stats().layouts).toBe(3);
  });

  it('draws the chosen ring under the tags and picks a tag where this frame drew it, never the ring', () => {
    const { labels, mesh, attribute } = labelsWorld();
    labels.frame({ tags: [item('a', 100, 300, { priority: 0, always: true, opacity: 0.5 })], marks: [],
      ring: { x: 100, y: 300 } }, { toPixel, viewport, nowMs: 0 });
    expect(mesh().count).toBe(2);
    expect(labels.stats()).toMatchObject({ count: 1, ring: true });
    // The ring first (under), the tag last (on top), faded by its aircraft's opacity.
    expect([...attribute('instanceOffset').array.slice(0, 2)]).toEqual([0, 0]);
    expect(attribute('instanceOpacity').array[1]).toBe(0.5);
    const [dx, dy] = attribute('instanceOffset').array.slice(2, 4);
    expect(labels.pick(100 + dx, 300 + dy, toPixel)).toBe('a');
    expect(labels.pick(100, 300, toPixel)).toBeNull();
    // Moved by a frame, it is picked where it is now.
    labels.frame({ tags: [item('a', 200, 300, { priority: 0, always: true })], marks: [], ring: null },
      { toPixel, viewport, nowMs: 16 });
    expect(labels.pick(100 + dx, 300 + dy, toPixel)).toBeNull();
    expect(labels.pick(200 + dx, 300 + dy, toPixel)).toBe('a');
    expect(labels.pick(200 + dx, 300 + dy, () => null)).toBeNull();
  });

  it('a tag that gives way draws nothing and gives its slot back; no labels, no quads', () => {
    const { labels, mesh } = labelsWorld();
    // Ten tags on one point, none that must show: only those with a free anchor show.
    const crowd = Array.from({ length: 10 }, (_, index) => item(`t${index}`, 500, 400, { priority: 2 }));
    labels.frame({ tags: crowd, marks: [], ring: null }, { toPixel, viewport, nowMs: 0 });
    const shown = labels.stats().count;
    expect(shown).toBeGreaterThan(0);
    expect(shown).toBeLessThan(10);
    expect(labels.stats().slots).toBe(shown);
    labels.frame(null, { toPixel, viewport, nowMs: 16 });
    expect(mesh().count).toBe(0);
    expect(labels.pick(500, 400, toPixel)).toBeNull();
    labels.dispose();
    expect(labels.object.children).toHaveLength(0);
  });
});
