import { expect, it, vi } from 'vitest';
import { resolveOpenFreeMapSpriteGaps } from './basemapStyles';

it('uses the published circle sprite and a solid wood fill for the two missing dark-style IDs', () => {
  const circle = { data: { width: 15, height: 15, data: new Uint8Array(15 * 15 * 4) }, pixelRatio: 1, sdf: false };
  let resolve;
  const map = {
    setMissingStyleImageResolver: vi.fn(callback => { resolve = callback; }),
    hasImage: vi.fn(id => id === 'circle_11'),
    getImage: vi.fn(() => circle),
    addImage: vi.fn(),
  };

  resolveOpenFreeMapSpriteGaps(map);
  resolve('circle-11');
  expect(map.addImage).toHaveBeenCalledWith('circle-11', circle.data, { pixelRatio: 1, sdf: false });

  resolve('wood-pattern');
  expect(map.addImage).toHaveBeenCalledWith('wood-pattern', {
    width: 1, height: 1, data: new Uint8Array([32, 32, 32, 255]),
  });

  resolve('unexpected-icon');
  expect(map.addImage).toHaveBeenCalledTimes(2);
});
