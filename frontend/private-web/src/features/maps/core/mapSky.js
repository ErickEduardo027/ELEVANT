import { occColor } from '../../occ-ui/occPalette';

// The sky of the OCC map (M4, 2026-11-28): MapLibre's own sky (setSky, a property of the style, so never a setStyle),
// on for the 3D views and while «Seguir en 3D» follows an aircraft, off in 2D. A tilted camera then sees a horizon that
// blends from the sky into the fog over the far ground instead of the canvas's flat edge. Map rendering, not UI chrome
// (ADR-0044): the colours are the OCC palette's of the map's theme.

/** The blends of the sky (MapLibre's sky properties), the same in both themes. */
export const OCC_SKY_BLENDS = Object.freeze({
  // The sky fades into the horizon over 60 % of the way down, the horizon into the fog over 70 %, and the fog covers
  // the ground from 80 % of the distance to the horizon.
  'sky-horizon-blend': 0.6,
  'horizon-fog-blend': 0.7,
  'fog-ground-blend': 0.8,
  // The atmosphere of the globe projection, full when far and gone near the ground (the map is mercator: unused).
  'atmosphere-blend': Object.freeze(['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0]),
});

// The sky changes at once, without MapLibre's 300 ms transition (2026-11-28): under the map lab's frozen clock
// (MapLibre's setNow) a transition never ends and the map never goes idle, as with the fades of the weather layers.
export const SKY_TRANSITION = Object.freeze({ duration: 0, delay: 0 });
const SKY_PROPERTIES = Object.freeze(['sky-color', 'horizon-color', 'fog-color', 'sky-horizon-blend', 'horizon-fog-blend',
  'fog-ground-blend', 'atmosphere-blend']);

// The palette's tokens of each theme: in dark a slate sky over a blue-grey horizon, in light a pale blue sky
// over a white horizon; the fog is the map's canvas, so the far ground melts into it.
const SKY_TOKENS = Object.freeze({
  dark: Object.freeze({ sky: '--occ-nav', horizon: '--occ-accent-soft', fog: '--occ-canvas' }),
  light: Object.freeze({ sky: '--occ-accent-soft', horizon: '--occ-panel', fog: '--occ-canvas' }),
});

/** The SkySpecification of the OCC map in `theme` ('dark' by default, or 'light'); a new object each call. */
export function occSky(theme = 'dark') {
  const name = theme === 'light' ? 'light' : 'dark';
  const tokens = SKY_TOKENS[name];
  return {
    'sky-color': occColor(tokens.sky, name),
    'horizon-color': occColor(tokens.horizon, name),
    'fog-color': occColor(tokens.fog, name),
    'sky-horizon-blend': OCC_SKY_BLENDS['sky-horizon-blend'],
    'horizon-fog-blend': OCC_SKY_BLENDS['horizon-fog-blend'],
    'fog-ground-blend': OCC_SKY_BLENDS['fog-ground-blend'],
    'atmosphere-blend': structuredClone([...OCC_SKY_BLENDS['atmosphere-blend']]),
    ...Object.fromEntries(SKY_PROPERTIES.map(name => [`${name}-transition`, { ...SKY_TRANSITION }])),
  };
}

/** Whether the map shows its sky: in the 3D views (`pitchMode` '3d') and while following in 3D, never in 2D else. */
export function skyWanted({ pitchMode, following3d = false } = {}) {
  return pitchMode === '3d' || following3d === true;
}

/** The sky the map should show now: occSky(theme) when skyWanted, else null (none). */
export function skyFor({ theme = 'dark', pitchMode, following3d = false } = {}) {
  return skyWanted({ pitchMode, following3d }) ? occSky(theme) : null;
}
