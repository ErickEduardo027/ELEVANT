import { GIBS_ATTRIBUTION } from '../core/attribution';

// The world seen from afar on the globe of Monitoreo (M8): a raster of NASA GIBS under the references, over the NOC base
// map, from the Mundo view to the Región one. GIBS is already in the CSP (connect-src and img-src), its imagery is free
// of copyright, and its credit, «NASA GIBS», travels on the source, so MapLibre lists it only while the layer is drawn.
// - Light theme, the day: Blue Marble, the shaded relief and the sea floor (BlueMarble_ShadedRelief_Bathymetry), a
//   static layer with no time, JPEG tiles up to level 8.
// - Dark theme, the night: Black Marble, the lights of the cities (VIIRS_Black_Marble), pinned to its 2016 image (GIBS
//   names 2012 and 2016; its default is 2016), PNG tiles up to level 8.
// Each WMTS template is the one GIBS's GetCapabilities gives (epsg3857/best, GoogleMapsCompatible_Level8, checked on
// 2026-11-27). The image is grey or dim, never in its own colours (contracts 2.4: normal things carry no hue): in the
// dark theme in greys under the dark land, the cities lit, in the light one pale and barely tinted, and it fades out
// towards the Región view, where the vector base map, sharper, takes over; from the `approach` threshold on it is not
// drawn at all, so no tile is asked for closer in. Pure: OccMap adds it only on the globe (projection 'globe').

/** The GIBS layer of each theme. */
export const WORLD_BASE_LAYERS = Object.freeze({ light: 'BlueMarble_ShadedRelief_Bathymetry', dark: 'VIIRS_Black_Marble' });
const GIBS_WMTS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best';
/** The WMTS tile template of each theme (`{z}/{y}/{x}`: WMTS names the row before the column). */
export const WORLD_BASE_TILES = Object.freeze({
  light: `${GIBS_WMTS}/${WORLD_BASE_LAYERS.light}/default/GoogleMapsCompatible_Level8/{z}/{y}/{x}.jpeg`,
  dark: `${GIBS_WMTS}/${WORLD_BASE_LAYERS.dark}/default/2016-01-01/GoogleMapsCompatible_Level8/{z}/{y}/{x}.png`,
});
/** GIBS serves both up to level 8 in 256 px tiles; MapLibre stretches the last level past it. */
export const WORLD_BASE_MAX_ZOOM = 8;
export const WORLD_BASE_TILE_SIZE = 256;
export const WORLD_BASE_SOURCE = 'occ-world-base';
export const WORLD_BASE_LAYER_ID = 'occ-world-base-image';
/** Its group: never a key of the layers menu, so it always shows where it is drawn. */
export const WORLD_BASE_GROUP = 'worldBase';
/** Right above the land and the sea, under the night shade (OccMap puts this overlay before the references'). */
export const WORLD_BASE_SLOT = 'shade';
/** The zooms between which it fades from its full opacity to its last one: the Mundo view to the Región one. */
export const WORLD_BASE_FADE_ZOOMS = Object.freeze([4, 7]);

// The look of each theme: [full opacity, last opacity] and the raster adjustments.
const LOOKS = Object.freeze({
  dark: { opacity: [0.85, 0.3], paint: { 'raster-saturation': -1, 'raster-brightness-max': 0.85, 'raster-contrast': 0.1 } },
  light: { opacity: [0.7, 0.25], paint: { 'raster-saturation': -0.8, 'raster-brightness-min': 0.45, 'raster-contrast': -0.2 } },
});

/** The theme's key in WORLD_BASE_LAYERS: the light theme takes the day, any other (dark by default) the night. */
export const worldBaseTheme = theme => (theme === 'light' ? 'light' : 'dark');

/**
 * The overlay of the world base for buildOccStyle in `theme`: one raster source with the GIBS tiles of the theme and
 * their credit, and its layer in the shade slot, drawn up to the `approach` threshold and fading from zoom 4 to 7.
 */
export function worldBaseOverlay({ theme = 'dark' } = {}) {
  const key = worldBaseTheme(theme);
  const { opacity: [full, last], paint } = LOOKS[key];
  return {
    sources: {
      [WORLD_BASE_SOURCE]: {
        type: 'raster',
        tiles: [WORLD_BASE_TILES[key]],
        tileSize: WORLD_BASE_TILE_SIZE,
        maxzoom: WORLD_BASE_MAX_ZOOM,
        attribution: GIBS_ATTRIBUTION,
      },
    },
    layers: [{
      slot: WORLD_BASE_SLOT,
      id: WORLD_BASE_LAYER_ID,
      type: 'raster',
      source: WORLD_BASE_SOURCE,
      paint: {
        'raster-opacity': ['interpolate', ['linear'], ['zoom'], WORLD_BASE_FADE_ZOOMS[0], full, WORLD_BASE_FADE_ZOOMS[1], last],
        ...paint,
        // No fade between tiles: a fade never ends under the map lab's frozen clock, where the map would never settle.
        'raster-fade-duration': 0,
      },
      metadata: { 'occ:group': WORLD_BASE_GROUP, 'occ:maxThreshold': 'approach' },
    }],
  };
}
