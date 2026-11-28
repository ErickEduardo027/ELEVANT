import { describe, expect, it } from 'vitest';
import { occColor } from '../../occ-ui/occPalette';
import { OCC_SKY_BLENDS, occSky, skyFor, skyWanted } from './mapSky';

describe('the sky of the OCC map (M4, 2026-11-28)', () => {
  it('takes its colours from the palette of the theme and its blends from OCC_SKY_BLENDS', () => {
    expect(occSky('dark')).toEqual({
      'sky-color': occColor('nav', 'dark'),
      'horizon-color': occColor('accent-soft', 'dark'),
      'fog-color': occColor('canvas', 'dark'),
      'sky-horizon-blend': 0.6,
      'horizon-fog-blend': 0.7,
      'fog-ground-blend': 0.8,
      'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0],
    });
    const light = occSky('light');
    expect([light['sky-color'], light['horizon-color'], light['fog-color']])
      .toEqual([occColor('accent-soft', 'light'), occColor('panel', 'light'), occColor('canvas', 'light')]);
    // Dark by default and for anything but 'light'.
    expect(occSky()).toEqual(occSky('dark'));
    expect(occSky('sepia')).toEqual(occSky('dark'));
    // The two themes differ, and each call is a new object a caller may change.
    expect(light['sky-color']).not.toBe(occSky('dark')['sky-color']);
    const first = occSky('dark');
    first['atmosphere-blend'].push(99);
    expect(occSky('dark')['atmosphere-blend']).toEqual(OCC_SKY_BLENDS['atmosphere-blend']);
    expect(Object.isFrozen(OCC_SKY_BLENDS)).toBe(true);
  });

  it('is on in the 3D views and while following in 3D, off in 2D', () => {
    expect(skyWanted({ pitchMode: '3d' })).toBe(true);
    expect(skyWanted({ pitchMode: '2d' })).toBe(false);
    expect(skyWanted({ pitchMode: '2d', following3d: true })).toBe(true);
    expect(skyWanted({})).toBe(false);
    expect(skyWanted()).toBe(false);
    expect(skyFor({ theme: 'light', pitchMode: '3d' })).toEqual(occSky('light'));
    expect(skyFor({ theme: 'dark', pitchMode: '2d', following3d: true })).toEqual(occSky('dark'));
    expect(skyFor({ theme: 'dark', pitchMode: '2d' })).toBeNull();
  });
});
