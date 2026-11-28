import { afterEach, describe, expect, it, vi } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { TAG_GLYPHS } from '../style/trafficImages';
import { TAG_STYLE } from '../traffic/trafficLayers';
import { tagTextOf } from '../traffic/trafficFeatures';
import {
  LABEL_COLUMNS, LABEL_SLOT, LABEL_SLOTS, RING_BOX_PX, createLabelAtlas, createSlotAllocator, tagKey, tagRuns,
} from './labelAtlas';

// The atlas of the animated tags (PR M2) on a 2D context that records what it writes.
function recordingCanvas(width, height) {
  const calls = [];
  const state = {};
  const context = new Proxy(state, {
    get: (target, key) => {
      if (key in target) return target[key];
      if (key === 'calls') return calls;
      return (...args) => {
        calls.push([key, ...args, { font: target.font, fillStyle: target.fillStyle }]);
        return key === 'measureText' ? { width: String(args[0]).length * 7 } : undefined;
      };
    },
    set: (target, key, value) => {
      target[key] = value;
      return true;
    },
  });
  return { width, height, getContext: type => (type === '2d' ? context : null), context };
}

const aviam = (overrides = {}) => ({ id: 'f:k-1', kind: 'aviam', flightNumber: 'DM101', direction: 'Arrival',
  typeIcao: 'B738', altM: 900, gsMs: 70, onGround: false, quality: 'live', standCode: 'B3', lon: 0, lat: 0, ...overrides });

afterEach(() => vi.unstubAllGlobals());

describe('createSlotAllocator', () => {
  it('hands each id one slot, keeps it, and gives a freed slot (the lowest) to the next id', () => {
    const slots = createSlotAllocator({ capacity: 4, reserved: 1 });
    expect(slots.take('a')).toBe(1);
    expect(slots.take('b')).toBe(2);
    expect(slots.take('a')).toBe(1);
    expect(slots.take('c')).toBe(3);
    expect(slots.take('d')).toBeNull();
    expect(slots.retain(new Set(['a', 'c']))).toEqual(['b']);
    expect(slots.take('d')).toBe(2);
    slots.release('a');
    slots.release('c');
    expect(slots.take('e')).toBe(1);
    slots.grow(6);
    expect(slots.take('f')).toBe(3);
    expect(slots.take('g')).toBe(4);
    expect(slots.size()).toBe(4);
    expect(slots.indexOf('nobody')).toBeNull();
  });
});

describe('tagRuns', () => {
  it('writes an ELEVANT tag as the GeoJSON one: glyph, bold number, muted «est.», smaller second line, stand', () => {
    const tag = tagTextOf(aviam({ quality: 'estimated' }));
    const { lines, size } = tagRuns(tag);
    expect(size).toBe(TAG_STYLE.aviam.size);
    expect(lines[0][0]).toEqual({ glyph: TAG_GLYPHS.arrival, size: 12 });
    expect(lines[0][1]).toMatchObject({ text: 'DM101', weight: 700, color: 'text' });
    expect(lines[0][2]).toMatchObject({ text: ' est.', weight: 400, color: 'muted' });
    expect(lines[1][0]).toMatchObject({ text: 'B738 030 136', size: 10.8 });
    expect(lines[1].map(run => run.glyph ?? run.text)).toEqual(['B738 030 136', '  ', TAG_GLYPHS.stand, ' B3']);
    // A departure has its own glyph; other traffic no glyph, in the muted colour of its size.
    expect(tagRuns(tagTextOf(aviam({ direction: 'Departure' }))).lines[0][0].glyph).toBe(TAG_GLYPHS.departure);
    const other = tagRuns(tagTextOf({ id: 'h:abc', kind: 'other', hex: 'abc', callsign: 'JBU12', altM: 3000 }));
    expect(other.size).toBe(TAG_STYLE.other.size);
    expect(other.lines[0]).toEqual([{ text: 'JBU12', weight: 700, size: 11, color: 'muted' }]);
  });
});

describe('createLabelAtlas', () => {
  const create = (options = {}) => {
    const made = [];
    const atlas = createLabelAtlas({
      createCanvas: (width, height) => {
        const canvas = recordingCanvas(width, height);
        made.push(canvas);
        return canvas;
      },
      ratio: 2, fontFamily: 'Manrope', makePath: d => ({ d }), ...options,
    });
    return { atlas, canvas: made[0], texts: () => made[0].context.calls.filter(call => call[0] === 'fillText') };
  };

  it('writes a slot only when its words change, and in the app font and the theme colours', () => {
    const { atlas, canvas, texts } = create();
    expect(canvas.width).toBe(LABEL_COLUMNS * LABEL_SLOT.width * 2);
    expect(canvas.height).toBe(Math.ceil(LABEL_SLOTS.initial / LABEL_COLUMNS) * LABEL_SLOT.height * 2);
    expect(atlas.takeDirty()).toBe(true);
    const words = tagTextOf(aviam());
    atlas.update(new Map([['f:k-1', words]]));
    expect(atlas.stats()).toMatchObject({ slots: 1, writes: 1 });
    expect(atlas.takeDirty()).toBe(true);
    const written = texts().length;
    expect(texts()[0]).toEqual(['fillText', 'DM101', expect.any(Number), expect.any(Number),
      { font: '700 12px Manrope', fillStyle: occColor('text') }]);
    // The same words again (a frame, another write at the same flight level): nothing is written.
    atlas.update(new Map([['f:k-1', { ...words }]]));
    expect(atlas.stats().writes).toBe(1);
    expect(texts()).toHaveLength(written);
    expect(atlas.takeDirty()).toBe(false);
    // A new flight level writes the slot again, in place.
    const before = atlas.cellOf('f:k-1');
    atlas.update(new Map([['f:k-1', tagTextOf(aviam({ altM: 1_500 }))]]));
    expect(atlas.stats().writes).toBe(2);
    expect(atlas.cellOf('f:k-1').uv.slice(0, 2)).toEqual(before.uv.slice(0, 2));
    expect(tagKey(words)).not.toBe(tagKey(tagTextOf(aviam({ altM: 1_500 }))));
  });

  it('frees the slot of a tag that goes and gives it to the next one; slot 0 holds the ring', () => {
    const { atlas } = create();
    atlas.update(new Map([['a', tagTextOf(aviam({ id: 'a' }))], ['b', tagTextOf(aviam({ id: 'b' }))]]));
    const slotOfA = atlas.cellOf('a').uv.slice(0, 2);
    atlas.update(new Map([['b', tagTextOf(aviam({ id: 'b' }))], ['c', tagTextOf(aviam({ id: 'c', flightNumber: 'DM7' }))]]));
    expect(atlas.cellOf('a')).toBeNull();
    expect(atlas.cellOf('c').uv.slice(0, 2)).toEqual(slotOfA);
    expect(atlas.stats()).toMatchObject({ slots: 2, writes: 3 });
    const ring = atlas.ringCell();
    expect(ring.uv.slice(0, 2)).toEqual([0, 0]);
    expect(ring.width).toBe(RING_BOX_PX);
    // A tag's cell is its own size, within its slot.
    const cell = atlas.cellOf('c');
    expect(cell.width).toBeGreaterThan(20);
    expect(cell.width).toBeLessThanOrEqual(LABEL_SLOT.width);
    expect(cell.height).toBeLessThanOrEqual(LABEL_SLOT.height);
  });

  it('grows its rows when full, writing every slot again, and stops at its limit', () => {
    const { atlas, canvas } = create({ initialSlots: 4, maxSlots: 8 });
    const words = count => new Map(Array.from({ length: count }, (_, index) => [`f:${index}`,
      tagTextOf(aviam({ id: `f:${index}`, flightNumber: `DM${index}` }))]));
    atlas.update(words(3));
    expect(atlas.takeResized()).toBe(false);
    atlas.update(words(5));
    expect(atlas.takeResized()).toBe(true);
    expect(canvas.height).toBe(2 * LABEL_SLOT.height * 2);
    expect(atlas.stats()).toMatchObject({ slots: 5, capacity: 8 });
    atlas.update(words(10));
    expect(atlas.stats().slots).toBe(7);
    expect(atlas.cellOf('f:9')).toBeNull();
  });

  it('writes every tag again once invalidated (the app font loaded)', () => {
    const { atlas } = create();
    const words = new Map([['f:k-1', tagTextOf(aviam())]]);
    atlas.update(words);
    atlas.invalidate();
    atlas.update(words);
    expect(atlas.stats().writes).toBe(2);
  });

  it('throws, with nothing built, without a 2D canvas', () => {
    expect(() => createLabelAtlas({ createCanvas: () => null })).toThrow(TypeError);
    expect(() => createLabelAtlas({ createCanvas: () => ({ getContext: () => null }) })).toThrow(TypeError);
  });
});
