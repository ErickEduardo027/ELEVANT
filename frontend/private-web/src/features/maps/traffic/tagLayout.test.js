import { describe, expect, it } from 'vitest';
import { TAG_LAYOUT_MS, anchorOffset, placeTags, tagBox } from './tagLayout';
import { TAG_ANCHORS } from './trafficLayers';

// The declutter of the animated tags (PR M2): screen pixels in, anchors out.
const tag = (id, x, y, extra = {}) => ({ id, x, y, width: 60, height: 26, offsetPx: 15, priority: 1, always: false,
  ...extra });
const overlap = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

describe('anchorOffset and tagBox', () => {
  it('put the tag past the silhouette on the anchor side, along the diagonal at a corner, as MapLibre does', () => {
    expect(anchorOffset('left', 60, 26, 15)).toEqual([45, 0]);
    expect(anchorOffset('right', 60, 26, 15)).toEqual([-45, 0]);
    expect(anchorOffset('top', 60, 26, 15)).toEqual([0, 28]);
    expect(anchorOffset('bottom', 60, 26, 15)).toEqual([0, -28]);
    const d = 15 * Math.SQRT1_2;
    expect(anchorOffset('bottom-right', 60, 26, 15)).toEqual([-(d + 30), -(d + 13)]);
    expect(() => anchorOffset('middle', 60, 26, 15)).toThrow(RangeError);
    // A tag never covers its own aircraft: every anchor keeps the box clear of the point by the offset.
    for (const anchor of TAG_ANCHORS) {
      const box = tagBox(anchor, tag('a', 100, 100));
      const inside = box.left < 100 && box.right > 100 && box.top < 100 && box.bottom > 100;
      expect(inside, anchor).toBe(false);
    }
    expect(TAG_LAYOUT_MS).toBe(250);
  });
});

describe('placeTags', () => {
  it('right of the aircraft first; a neighbour takes the next free anchor and never overlaps it', () => {
    const anchors = placeTags([tag('a', 100, 100), tag('b', 140, 100)]);
    expect(anchors.get('a')).toBe('left');
    expect(anchors.get('b')).not.toBe('left');
    const a = tagBox(anchors.get('a'), tag('a', 100, 100));
    const b = tagBox(anchors.get('b'), tag('b', 140, 100));
    expect(overlap(a, b)).toBe(false);
  });

  it('places by priority: the chosen tag keeps its first anchor, the one that gives way moves or goes', () => {
    // Twelve aircraft on top of each other: no anchor is free for most.
    const crowd = Array.from({ length: 12 }, (_, index) => tag(`t${index}`, 200 + index, 200, { priority: 2 }));
    const chosen = tag('chosen', 205, 200, { priority: 0, always: true });
    const anchors = placeTags([...crowd, chosen]);
    expect([...anchors.keys()][0]).toBe('chosen');
    expect(anchors.get('chosen')).toBe('left');
    expect(anchors.size).toBeLessThan(13);
    // What was placed never overlaps.
    const boxes = [...anchors].map(([id, anchor]) => tagBox(anchor, id === 'chosen' ? chosen : crowd.find(c => c.id === id)));
    for (let i = 0; i < boxes.length; i += 1) {
      for (let j = i + 1; j < boxes.length; j += 1) expect(overlap(boxes[i], boxes[j])).toBe(false);
    }
  });

  it('a tag that must show (CN-29: ELEVANT from the ramp zoom) is placed where no anchor is free, at the one it had', () => {
    const crowd = Array.from({ length: 12 }, (_, index) => tag(`t${index}`, 200 + index, 200, { always: true }));
    const previous = new Map([['t11', 'bottom']]);
    const anchors = placeTags(crowd, { previous });
    expect(anchors.size).toBe(12);
    expect(anchors.get('t11')).toBe('bottom');
  });

  it('keeps the anchor of the last layout while it stays free, so tags do not jump', () => {
    const previous = new Map([['a', 'top-right']]);
    expect(placeTags([tag('a', 100, 100)], { previous }).get('a')).toBe('top-right');
    expect(placeTags([tag('a', 100, 100)], { previous: new Map([['a', 'nowhere']]) }).get('a')).toBe('left');
  });

  it('keeps off the silhouettes of the other aircraft where it can, never off its own', () => {
    const own = { id: 'a', left: 90, top: 90, right: 110, bottom: 110 };
    const other = { id: 'b', left: 140, top: 90, right: 160, bottom: 110 };
    const anchors = placeTags([tag('a', 100, 100)], { obstacles: [own, other] });
    expect(anchors.get('a')).not.toBe('left');
    expect(overlap(tagBox(anchors.get('a'), tag('a', 100, 100)), other)).toBe(false);
    // Fenced in on every side, it still shows clear of the other tags.
    const fence = TAG_ANCHORS.map(anchor => ({ id: 'z', ...tagBox(anchor, tag('a', 100, 100)) }));
    expect(placeTags([tag('a', 100, 100)], { obstacles: fence }).get('a')).toBe('left');
  });

  it('leaves out an aircraft off screen and one without a size', () => {
    const viewport = { width: 300, height: 300 };
    const anchors = placeTags([tag('in', 150, 150), tag('out', 400, 150), tag('flat', 50, 50, { width: 0 })],
      { viewport });
    expect([...anchors.keys()]).toEqual(['in']);
  });
});
