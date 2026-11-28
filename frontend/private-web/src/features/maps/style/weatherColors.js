// The colours of the regional weather on the OCC maps (lane M7, owner exception of 2026-11-26: the weather layers and
// the flight categories may use the standard colour scales of aviation, apart from the «cabina oscura» rule that keeps
// hue for attention and urgent). Pure data, read alike by the map layers (traffic/weatherLayers.js), the legend
// swatches (ui/ReferenceSwatch.jsx) and the tests. Every value is an opaque #rrggbb that no OCC token or base-map colour
// has, so the light theme's colour pass (style/occStyle.js) leaves them as they are. The satellite infrared stays in
// greys (traffic/weatherLayers.js: SATELLITE_SATURATION); only these layers carry hue.

const deepFreeze = value => {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
};

/** The flight categories the server sends (AWC fltCat), from the best to the worst. */
export const FLIGHT_CATEGORIES = deepFreeze(['VFR', 'MVFR', 'IFR', 'LIFR']);

/**
 * The colour of each flight category, as aviation charts paint them: VFR green, MVFR blue, IFR red and LIFR magenta. A
 * station without a category is drawn in the muted token, a hollow ring (traffic/weatherLayers.js).
 */
export const FLIGHT_CATEGORY_COLORS = deepFreeze({
  VFR: '#2fbf4a',
  MVFR: '#3d7cff',
  IFR: '#ff3b3b',
  LIFR: '#e040fb',
});

/**
 * The reflectivity scale of the radar in dBZ, as the NWS paints its base reflectivity (N0Q, the product of the IEM
 * TJUA tiles): each stop the lower bound of its colour, from light rain in cyan to hail in violet. The legend shows
 * these steps; the map draws the provider's tiles as they come (the colours are in the image).
 */
export const RADAR_SCALE_NWS = deepFreeze([
  [5, '#04e9e7'], [10, '#019ff4'], [15, '#0300f4'], [20, '#02fd02'], [25, '#01c501'], [30, '#008e00'],
  [35, '#fdf802'], [40, '#e5bc00'], [45, '#fd9500'], [50, '#fd0000'], [55, '#d40000'], [60, '#bc0000'],
  [65, '#f800fd'], [70, '#9854c6'],
]);

/**
 * The scale of each radar provider the API may name (OccRadarFramesResponse.provider). Both are read with the NWS
 * scale: the API (lane M6) asks RainViewer for the colour scheme that follows it. A provider not listed has no scale
 * and the legend shows the radar without one.
 */
export const RADAR_SCALES = deepFreeze({ 'iem-tjua': RADAR_SCALE_NWS, rainviewer: RADAR_SCALE_NWS });

/** The hazards of a SIGMET the map tells apart, in the order the legend lists them. */
export const SIGMET_HAZARDS = deepFreeze(['TS', 'TC', 'TURB', 'ICE', 'MTW', 'VA', 'DS', 'OTHER']);

/**
 * The colour of each hazard, as aviation weather charts tell them apart: thunderstorms in red-orange, tropical
 * cyclones in crimson, turbulence in orange, icing in cyan, mountain waves in tan, volcanic ash in violet, dust and
 * sand in sand, anything else in light grey.
 */
export const SIGMET_HAZARD_COLORS = deepFreeze({
  TS: '#ff5a36',
  TC: '#ff2e6d',
  TURB: '#ffa62b',
  ICE: '#36c5f0',
  MTW: '#c8a165',
  VA: '#b46cff',
  DS: '#d9b36c',
  OTHER: '#d0d4da',
});
