// The colours the OCC maps paint that are not OCC tokens (owner request of 2026-11-15, «más color» on the NOC map):
// the base map, the altitude scale of the traffic, the region's airports and the fills of the seven stand states. One
// palette per theme, `dark` (the one the OCC uses today) and `light`; mapColorsFor(theme) picks one and falls back to
// dark. Every value is an opaque #rrggbb (the stand fills carry their own opacity), so MapLibre, a canvas, SVG and CSS
// read them alike. The tokens of the panels stay in occ-ui/occPalette.js: no token value is copied here.
//
// Altitude (traffic/trafficLayers.js, ui/AltitudeLegend.jsx): our own scale for the NOC map, in the warm-to-cold order
// pilots know from ADS-B maps (low and slow in orange, cruise in blue and violet), interpolated linearly between the
// stops in feet; an aircraft on the ground is light grey and one without an altitude the neutral grey.

const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

/** The altitude stops in feet, from the ground to the top of the scale (40 000 ft and above). */
export const ALTITUDE_STOPS_FT = deepFreeze([0, 500, 1000, 2000, 4000, 6000, 8000, 10000, 20000, 30000, 40000]);

const ALTITUDE_DARK = ['#f06a20', '#f08a20', '#f0a020', '#f0b420', '#e0c800', '#b8d000', '#60c820', '#20c060',
  '#20b8c8', '#3060f0', '#b020e0'];
// On the light land and sea the same hues, deeper so they hold on a light ground: the yellows go to a dark gold and
// the greens and cyan a step darker; a dark halo (altitude.halo) edges every aircraft in this theme.
const ALTITUDE_LIGHT = ['#d4500a', '#d0640a', '#c87800', '#bb8a00', '#a39600', '#7f9c00', '#3a9418', '#0f8c48',
  '#0d8496', '#2448c8', '#8a14b8'];

const stops = colours => ALTITUDE_STOPS_FT.map((feet, index) => [feet, colours[index]]);

/** The palettes by theme. */
export const MAP_COLORS = deepFreeze({
  dark: {
    // Deep navy sea, a lighter blue-grey land, borders and names that read, pavement that stands off the land.
    basemap: {
      land: '#223243',
      sea: '#081a36',
      coastline: '#3f6185',
      boundary: '#9fb3c8',
      road: '#2e4053',
      roadMajor: '#3a4f64',
      building: '#2c3d4f',
      buildingExtrusion: '#38495c',
      runway: '#4c5f73',
      taxiway: '#334558',
      apron: '#2a3a4b',
      placeLabel: '#d2dde8',
      waterLabel: '#7fa6d0',
      labelHalo: '#07111f',
    },
    // The halo edges each aircraft: almost the colour of the dark land, a dark line on the light one.
    altitude: { stops: stops(ALTITUDE_DARK), ground: '#c4ccd2', unknown: '#8d989f', halo: '#0b1218' },
    // The region's airports (style/referenceLayers.js): the home airport in cyan and larger, international airports
    // green, regional ones blue, the rest white; every code in yellow.
    airports: {
      home: '#3fdcf2', international: '#3ecf6e', regional: '#4a9bf0', other: '#f2f5f7', label: '#f5d547', halo: '#07111f',
    },
    // The routes from Punta Cana (style/routeLayers.js): a warm coral that no altitude, airport or stand colour uses,
    // with its labels light on a dark halo.
    routes: { line: '#ff7a8a', label: '#ffd3d9', halo: '#07111f' },
    // The night shade (PR M8, style/referenceLayers.js): a near-black a little over the land and the sea.
    night: { color: '#0a1014', opacity: 0.45 },
    // The fill of each stand state (stands/standLayers.js), under the vocabulary's outline, dash and marks.
    stands: {
      available: { color: '#3fae6a', opacity: 0.22 },
      planned: { color: '#3b7ff0', opacity: 0.3 },
      arriving: { color: '#22bfe0', opacity: 0.32 },
      occupied: { color: '#e0a33a', opacity: 0.4 },
      releasing: { color: '#9b6cf0', opacity: 0.4 },
      disabled: { color: '#6b7780', opacity: 0.35 },
      unverified: { color: '#8a949a', opacity: 0.12 },
    },
  },
  light: {
    basemap: {
      land: '#eef1f3',
      sea: '#b0d0ee',
      coastline: '#7ea6cb',
      boundary: '#5b6875',
      road: '#d9dee3',
      roadMajor: '#cdd4da',
      building: '#dfe4e8',
      buildingExtrusion: '#d3d9de',
      runway: '#9aa6b0',
      taxiway: '#bcc5cc',
      apron: '#d6dce1',
      placeLabel: '#2c3a46',
      waterLabel: '#22507c',
      labelHalo: '#fdfefe',
    },
    // On the light land: a mid grey on the ground, and every aircraft edged in a dark halo.
    altitude: { stops: stops(ALTITUDE_LIGHT), ground: '#69747b', unknown: '#a3acb2', halo: '#1c2830' },
    // Darker dots, and the codes in a dark amber on a light halo: yellow does not read on a light map.
    airports: {
      home: '#0a7fa8', international: '#16893f', regional: '#2a62c8', other: '#3a4650', label: '#6e5200', halo: '#fdfefe',
    },
    routes: { line: '#c2334a', label: '#7a1426', halo: '#fdfefe' },
    // On the light map the night must still darken it: a deep blue-grey, lighter in weight.
    night: { color: '#1b2a3d', opacity: 0.22 },
    stands: {
      available: { color: '#2f9a58', opacity: 0.2 },
      planned: { color: '#2f6fe0', opacity: 0.24 },
      arriving: { color: '#1a9fc0', opacity: 0.26 },
      occupied: { color: '#d08a20', opacity: 0.32 },
      releasing: { color: '#7d50d8', opacity: 0.3 },
      disabled: { color: '#7a858c', opacity: 0.3 },
      unverified: { color: '#9aa4aa', opacity: 0.12 },
    },
  },
});

/** The palette of `theme` ('dark' or 'light'); anything else is the dark one. */
export function mapColorsFor(theme = 'dark') {
  return Object.hasOwn(MAP_COLORS, theme) ? MAP_COLORS[theme] : MAP_COLORS.dark;
}

/**
 * The MapLibre expression of the altitude colour of an aircraft (traffic/trafficLayers.js): light grey on the ground,
 * the neutral grey without an altitude (`altFt` < 0), else the scale interpolated on `altFt`.
 */
export function altitudeColourExpression(theme = 'dark') {
  const { stops: scale, ground, unknown } = mapColorsFor(theme).altitude;
  return ['case',
    ['==', ['get', 'ground'], true], ground,
    ['<', ['coalesce', ['get', 'altFt'], -1], 0], unknown,
    ['interpolate', ['linear'], ['get', 'altFt'], ...scale.flat()]];
}

/** The CSS gradient of the altitude scale, left (ground) to right (40 000 ft), with each stop at its share. */
export function altitudeGradient(theme = 'dark', positions = null) {
  const { stops: scale } = mapColorsFor(theme).altitude;
  const at = positions ?? scale.map((_, index) => (index / (scale.length - 1)) * 100);
  return `linear-gradient(to right, ${scale.map(([, colour], index) => `${colour} ${Math.round(at[index] * 10) / 10}%`).join(', ')})`;
}
