import { afterEach, expect, it, vi } from 'vitest';
import { resolveOpenFreeMapSpriteGaps } from './basemapStyles';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

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

it('keeps the OpenFreeMap styles whatever the environment says: the style variables are gone', async () => {
  // A style outside the CSP could only come from these retired variables; they no longer change anything.
  vi.stubEnv('NEXT_PUBLIC_POSITIONS_MAP_STYLE_LIGHT', 'https://styles.example.test/light.json');
  vi.stubEnv('NEXT_PUBLIC_POSITIONS_MAP_STYLE_DARK', 'https://styles.example.test/dark.json');
  vi.resetModules();
  const { BASEMAP_STYLE_URLS, basemapStyleUrl } = await import('./basemapStyles');
  expect(BASEMAP_STYLE_URLS).toEqual({
    light: 'https://tiles.openfreemap.org/styles/liberty',
    dark: 'https://tiles.openfreemap.org/styles/dark',
  });
  expect(basemapStyleUrl('dark')).toBe('https://tiles.openfreemap.org/styles/dark');
  expect(basemapStyleUrl('unknown')).toBe('https://tiles.openfreemap.org/styles/liberty');
});
