import { occColor } from '../../occ-ui/occPalette';
import { TAG_GLYPHS, TRAFFIC_IMAGE_SHAPES } from '../style/trafficImages';
import { SELECTED_RING, TAG_STYLE } from '../traffic/trafficLayers';

// The tags of the animated traffic (PR M2, aircraft/trafficLabels.js) in one canvas atlas: one slot per aircraft whose
// tag shows, written again only when its words change, and freed for another aircraft once its tag goes; slot 0 holds
// the chosen aircraft's ring. A tag is written as the GeoJSON tags write it (traffic/trafficLayers.js): the arrival or
// departure glyph of an ELEVANT flight, its name in bold, «est.» or the age of a stale position muted, then type,
// altitude and knots smaller, and the stand an arrival goes to («B3≠A5» while it stands at another); in the app's font,
// in the colours of the theme's tokens, with the halo of the map's tags. The layer draws each slot as a quad facing the
// screen; its opacity (a stale or fading aircraft) is the quad's, so it never writes a slot again.

/** A slot of the atlas in CSS pixels: the longest tag («Sin actualizar desde las 14:02») fits. */
export const LABEL_SLOT = Object.freeze({ width: 256, height: 40 });
export const LABEL_COLUMNS = 4;
/** Slots the atlas starts with and grows to at most (it doubles its rows when full). */
export const LABEL_SLOTS = Object.freeze({ initial: 16, max: 256 });
/** The slot of the chosen aircraft's ring. */
export const RING_SLOT = 0;

const PAD_PX = 2;
const GLYPH_GAP_PX = 3;

const filled = value => typeof value === 'string' && value !== '';

/**
 * The key of a tag's words (traffic/trafficFeatures.js: tagTextOf): equal keys, the same slot content.
 */
export const tagKey = tag => [tag?.aviam ? 'a' : 'o', tag?.dir ?? '', tag?.tag1 ?? '', tag?.suffix ?? '', tag?.tag2 ?? '',
  tag?.tagStand ?? ''].join('␟');

/**
 * The slots of the atlas, by aircraft id, without a canvas: `take(id)` the id's slot (a freed one first, the lowest),
 * or null when all `capacity` are held; `release(id)`; `retain(ids)` frees those not in `ids` and answers them;
 * `indexOf(id)`; `grow(capacity)`; `size()`; `capacity()`. `reserved` slots from 0 are never handed out.
 */
export function createSlotAllocator({ capacity, reserved = 0 } = {}) {
  let limit = capacity;
  let next = reserved;
  const free = [];
  const held = new Map();
  return {
    take(id) {
      const had = held.get(id);
      if (had !== undefined) return had;
      let index;
      if (free.length > 0) {
        free.sort((a, b) => a - b);
        index = free.shift();
      } else if (next < limit) {
        index = next;
        next += 1;
      } else return null;
      held.set(id, index);
      return index;
    },
    release(id) {
      const index = held.get(id);
      if (index === undefined) return;
      held.delete(id);
      free.push(index);
    },
    retain(ids) {
      const gone = [];
      for (const id of held.keys()) if (!ids.has(id)) gone.push(id);
      for (const id of gone) this.release(id);
      return gone;
    },
    indexOf: id => held.get(id) ?? null,
    grow(nextCapacity) {
      if (nextCapacity > limit) limit = nextCapacity;
    },
    size: () => held.size,
    capacity: () => limit,
  };
}

const fontOf = (weight, size, family) => `${weight} ${size}px ${family}`;

function measure(context, text, font) {
  context.font = font;
  const width = context.measureText?.(text)?.width;
  // A context that measures nothing (tests): a fair width per character.
  return Number.isFinite(width) ? width : text.length * 0.6 * Number.parseFloat(/(\d+(\.\d+)?)px/.exec(font)?.[1] ?? 12);
}

/**
 * The runs of a tag, `{ lines: [[run…], …], size }`, each run `{ text, weight, size, color }` or `{ glyph, size }`: the
 * same words, fonts and colours as the GeoJSON tags (traffic/trafficLayers.js: aviamTag and OTHER_TAG).
 */
export function tagRuns(tag) {
  const style = tag?.aviam ? TAG_STYLE.aviam : TAG_STYLE.other;
  const size = style.size;
  const small = Math.round(size * TAG_STYLE.secondLineScale * 10) / 10;
  const first = [];
  if (tag?.aviam) first.push({ glyph: tag.dir === 'dep' ? TAG_GLYPHS.departure : TAG_GLYPHS.arrival, size });
  first.push({ text: tag?.tag1 ?? '', weight: 700, size, color: style.color });
  if (filled(tag?.suffix)) first.push({ text: ` ${tag.suffix}`, weight: 400, size, color: 'muted' });
  const second = [];
  if (filled(tag?.tag2)) second.push({ text: tag.tag2, weight: 400, size: small, color: style.color });
  if (tag?.aviam && filled(tag?.tagStand)) {
    second.push({ text: second.length > 0 ? '  ' : '', weight: 400, size, color: style.color });
    second.push({ glyph: TAG_GLYPHS.stand, size });
    second.push({ text: ` ${tag.tagStand}`, weight: 700, size, color: style.color });
  }
  return { lines: second.length > 0 ? [first, second] : [first], size };
}

const runWidth = (context, run, family) => (run.glyph
  ? run.size + GLYPH_GAP_PX
  : measure(context, run.text, fontOf(run.weight, run.size, family)));

const lineHeightOf = line => Math.max(...line.map(run => run.size)) * TAG_STYLE.lineHeight;

/** The size in CSS pixels a tag takes, with its halo: `{ width, height }`, at most a slot. */
export function tagSize(context, tag, { fontFamily }) {
  const { lines } = tagRuns(tag);
  const width = Math.max(...lines.map(line => line.reduce((sum, run) => sum + runWidth(context, run, fontFamily), 0)));
  const height = lines.reduce((sum, line) => sum + lineHeightOf(line), 0);
  return {
    width: Math.min(LABEL_SLOT.width, Math.ceil(width + 2 * PAD_PX)),
    height: Math.min(LABEL_SLOT.height, Math.ceil(height + 2 * PAD_PX)),
  };
}

function drawGlyph(context, name, x, centreY, size, theme, makePath) {
  const shape = TRAFFIC_IMAGE_SHAPES[name];
  if (!shape || makePath === null) return;
  const scale = size / shape.width;
  context.save();
  context.translate(x, centreY - size / 2);
  context.scale(scale, scale);
  for (const op of shape.ops) {
    const path = makePath(op.fill ?? op.stroke);
    const colour = occColor(op.color, theme);
    if (op.fill !== undefined) {
      context.fillStyle = colour;
      context.fill(path);
    } else {
      context.strokeStyle = colour;
      context.lineWidth = op.lineWidth;
      context.lineCap = 'butt';
      context.lineJoin = 'round';
      context.stroke(path);
    }
  }
  context.restore();
}

/** Writes a tag at (`x`, `y`), its top-left corner in CSS pixels; answers its size. */
export function drawTag(context, tag, x, y, { theme = 'dark', fontFamily, makePath = null } = {}) {
  const size = tagSize(context, tag, { fontFamily });
  const { lines } = tagRuns(tag);
  const halo = occColor('nav', theme);
  context.textAlign = 'left';
  context.textBaseline = 'middle';
  context.lineJoin = 'round';
  let top = y + PAD_PX;
  for (const line of lines) {
    const height = lineHeightOf(line);
    const centreY = top + height / 2;
    let left = x + PAD_PX;
    for (const run of line) {
      if (run.glyph) {
        drawGlyph(context, run.glyph, left, centreY, run.size, theme, makePath);
      } else if (run.text !== '') {
        const font = fontOf(run.weight, run.size, fontFamily);
        context.font = font;
        context.lineWidth = 2 * TAG_STYLE.haloPx;
        context.strokeStyle = halo;
        context.strokeText?.(run.text, left, centreY);
        context.fillStyle = occColor(run.color, theme);
        context.fillText?.(run.text, left, centreY);
      }
      left += runWidth(context, run, fontFamily);
    }
    top += height;
  }
  return size;
}

/** The ring's box in CSS pixels: its stroke's outer diameter, plus a pixel. */
export const RING_BOX_PX = 2 * (SELECTED_RING.radiusPx + SELECTED_RING.widthPx / 2) + 2;

function drawRing(context, x, y, theme) {
  context.beginPath();
  context.arc(x + RING_BOX_PX / 2, y + RING_BOX_PX / 2, SELECTED_RING.radiusPx, 0, 2 * Math.PI);
  context.lineWidth = SELECTED_RING.widthPx;
  context.strokeStyle = occColor('accent', theme);
  context.stroke();
}

/** The app's font for the tags: the OCC's own (the --font-manrope of the root element), then the system's. */
export function documentFontFamily(root = globalThis.document?.documentElement) {
  let own = '';
  try {
    own = root && typeof globalThis.getComputedStyle === 'function'
      ? globalThis.getComputedStyle(root).getPropertyValue('--font-manrope').trim() : '';
  } catch {
    own = '';
  }
  return `${own ? `${own}, ` : ''}system-ui, 'Segoe UI', sans-serif`;
}

/**
 * The atlas of the tags: `{ canvas, update(tags), cellOf(id), ringCell(), invalidate(), takeDirty(), takeResized(),
 * stats() }`.
 * - `update(tags)` (a Map of id → tagTextOf's words): writes the slots whose words changed and frees those of the ids
 *   that are gone; an id the atlas has no room for (LABEL_SLOTS.max) gets no slot;
 * - `cellOf(id)` → `{ uv: [u0, v0, du, dv], width, height }` (CSS pixels of the tag) or null; `ringCell()` the ring's;
 * - `takeDirty()` answers whether the canvas changed since it was last asked (the texture then uploads it again) and
 *   `takeResized()` whether it grew (a new texture);
 * - `invalidate()` writes every slot again at the next update (the app's font loaded).
 * `createCanvas(width, height)` makes the canvas; it throws, with nothing built, when there is none or it has no 2D
 * context. `ratio` the canvas pixels of a CSS pixel.
 */
export function createLabelAtlas({
  createCanvas, ratio = 2, theme = 'dark', fontFamily = documentFontFamily(), makePath = null,
  initialSlots = LABEL_SLOTS.initial, maxSlots = LABEL_SLOTS.max,
} = {}) {
  const rowsFor = slots => Math.ceil(slots / LABEL_COLUMNS);
  let rows = rowsFor(initialSlots);
  const canvas = createCanvas?.(LABEL_COLUMNS * LABEL_SLOT.width * ratio, rows * LABEL_SLOT.height * ratio) ?? null;
  const context = canvas?.getContext?.('2d') ?? null;
  if (context === null) throw new TypeError('The traffic tags need a 2D canvas');
  const path = makePath ?? (typeof Path2D === 'function' ? d => new Path2D(d) : null);
  const slots = createSlotAllocator({ capacity: rows * LABEL_COLUMNS, reserved: 1 });
  // id → { key, tag, width, height }
  const entries = new Map();
  let dirty = true;
  let resized = false;
  let writes = 0;

  const originOf = index => [(index % LABEL_COLUMNS) * LABEL_SLOT.width, Math.floor(index / LABEL_COLUMNS) * LABEL_SLOT.height];

  function clearSlot(index) {
    const [x, y] = originOf(index);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    context.clearRect(x, y, LABEL_SLOT.width, LABEL_SLOT.height);
  }

  function writeSlot(index, tag) {
    clearSlot(index);
    const [x, y] = originOf(index);
    context.save();
    context.beginPath();
    context.rect(x, y, LABEL_SLOT.width, LABEL_SLOT.height);
    context.clip();
    const size = drawTag(context, tag, x, y, { theme, fontFamily, makePath: path });
    context.restore();
    writes += 1;
    dirty = true;
    return size;
  }

  function paintRing() {
    clearSlot(RING_SLOT);
    const [x, y] = originOf(RING_SLOT);
    drawRing(context, x, y, theme);
  }

  // Twice the rows, every slot written again (a canvas that changes size is cleared).
  function grow() {
    const slotsNow = rows * LABEL_COLUMNS;
    if (slotsNow >= maxSlots) return false;
    rows = rowsFor(Math.min(maxSlots, 2 * slotsNow));
    canvas.height = rows * LABEL_SLOT.height * ratio;
    slots.grow(rows * LABEL_COLUMNS);
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
    paintRing();
    for (const [id, entry] of entries) {
      const index = slots.indexOf(id);
      if (index !== null) Object.assign(entry, writeSlot(index, entry.tag));
    }
    resized = true;
    dirty = true;
    return true;
  }

  context.setTransform(ratio, 0, 0, ratio, 0, 0);
  paintRing();

  const uvOf = (index, width, height) => {
    const [x, y] = originOf(index);
    const total = [LABEL_COLUMNS * LABEL_SLOT.width, rows * LABEL_SLOT.height];
    return [x / total[0], y / total[1], width / total[0], height / total[1]];
  };

  return {
    canvas,

    update(tags) {
      const wanted = tags instanceof Map ? tags : new Map();
      for (const id of slots.retain(new Set(wanted.keys()))) entries.delete(id);
      for (const [id, tag] of wanted) {
        const key = tagKey(tag);
        const entry = entries.get(id);
        if (entry !== undefined && entry.key === key) continue;
        let index = slots.take(id);
        if (index === null && grow()) index = slots.take(id);
        if (index === null) continue;
        entries.set(id, { key, tag, ...writeSlot(index, tag) });
      }
    },

    cellOf(id) {
      const entry = entries.get(id);
      const index = slots.indexOf(id);
      if (entry === undefined || index === null) return null;
      return { uv: uvOf(index, entry.width, entry.height), width: entry.width, height: entry.height };
    },

    ringCell: () => ({ uv: uvOf(RING_SLOT, RING_BOX_PX, RING_BOX_PX), width: RING_BOX_PX, height: RING_BOX_PX }),

    invalidate() {
      for (const entry of entries.values()) entry.key = null;
    },

    takeDirty() {
      const was = dirty;
      dirty = false;
      return was;
    },

    takeResized() {
      const was = resized;
      resized = false;
      return was;
    },

    stats: () => ({ slots: slots.size(), capacity: slots.capacity(), writes }),
  };
}
