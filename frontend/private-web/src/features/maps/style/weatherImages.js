// The wind barbs of the METAR stations (lane M7, traffic/weatherLayers.js), drawn on demand by style/mapImages.js as
// SDF images like every other icon, so the layer paints them in its colour with a dark halo. One image per 5 kt from 5
// to 100 kt (barbImageId): a shaft that rises from the station's dot to the north, with its marks on the right of it near the tip, as
// a station plot of the northern hemisphere draws them: a pennant for 50 kt, a barb for 10 kt and a half barb for 5 kt.
// The layer turns the image to where the wind blows from (icon-rotate: the METAR's direction), so the shaft points into
// the wind. The image is square around the station, which sits at its middle, so turning it keeps the station still.
// Sizes are CSS pixels and every shape keeps 3 px clear of the image border, as mapImages.js asks of its icons. Pure.

/** The side of a barb image; the station is at its middle. */
export const BARB_IMAGE_SIZE = 56;
const CENTRE = BARB_IMAGE_SIZE / 2;
/** Where the shaft starts, just outside the station's dot (5 px), and where its tip is. */
export const BARB_SHAFT = Object.freeze({ bottom: CENTRE - 5, top: 6 });
/** The steps of the barbs: 5 kt to 100 kt by 5 kt. */
export const BARB_STEP_KT = 5;
export const BARB_MAX_KT = 100;
/** The speeds that have an image. */
export const BARB_SPEEDS = Object.freeze(Array.from({ length: BARB_MAX_KT / BARB_STEP_KT }, (_, index) => (index + 1) * BARB_STEP_KT));

const PENNANT_HEIGHT = 4;
const PENNANT_STEP = 5;
const BARB_STEP = 2.8;
const BARB_LENGTH = 9;
const BARB_RISE = 3;
const LINE_WIDTH = 1.5;
const round = value => Math.round(value * 100) / 100;

/**
 * The id of the barb image of `speedKt`, one of BARB_SPEEDS: its count of 5 kt steps, «wind-barb-3» for 15 kt (an image
 * id carries no run of three digits, style/mapImages.js).
 */
export const barbImageId = speedKt => `wind-barb-${speedKt / BARB_STEP_KT}`;

/** The pennants, barbs and half barbs of `speedKt` (a multiple of 5): `{ pennants, barbs, half }`. */
export function barbParts(speedKt) {
  let rest = speedKt;
  const pennants = Math.floor(rest / 50);
  rest -= pennants * 50;
  const barbs = Math.floor(rest / 10);
  rest -= barbs * 10;
  return Object.freeze({ pennants, barbs, half: rest >= 5 });
}

// The operations of one barb image: the shaft, then from the tip down its pennants (filled triangles whose top edge
// runs square from the shaft), its barbs and its half barb; a half barb alone sits one step in from the tip, so it never reads as a barb.
function barbOps(speedKt) {
  const { pennants, barbs, half } = barbParts(speedKt);
  const ops = [{ stroke: `M${CENTRE} ${BARB_SHAFT.bottom} V${BARB_SHAFT.top}`, lineWidth: LINE_WIDTH }];
  let y = BARB_SHAFT.top;
  for (let index = 0; index < pennants; index += 1) {
    ops.push({ fill: `M${CENTRE} ${round(y)} L${CENTRE + BARB_LENGTH} ${round(y)} L${CENTRE} ${round(y + PENNANT_HEIGHT)} Z` });
    y += PENNANT_STEP;
  }
  for (let index = 0; index < barbs; index += 1) {
    ops.push({ stroke: `M${CENTRE} ${round(y)} L${CENTRE + BARB_LENGTH} ${round(y - BARB_RISE)}`, lineWidth: LINE_WIDTH });
    y += BARB_STEP;
  }
  if (half) {
    if (pennants === 0 && barbs === 0) y += BARB_STEP;
    ops.push({ stroke: `M${CENTRE} ${round(y)} L${round(CENTRE + BARB_LENGTH / 2)} ${round(y - BARB_RISE / 2)}`, lineWidth: LINE_WIDTH });
  }
  return ops;
}

/** The shape of every barb image (the shape format of style/mapImages.js), in BARB_SPEEDS order. */
export const WEATHER_IMAGE_SHAPES = Object.freeze(Object.fromEntries(BARB_SPEEDS.map(speed => [barbImageId(speed),
  { width: BARB_IMAGE_SIZE, height: BARB_IMAGE_SIZE, ops: barbOps(speed) }])));

/**
 * The barb image of a wind: the id for its speed rounded to 5 kt (at most 100 kt), or null for a calm wind (under
 * 3 kt), a wind without a direction (variable) or no speed.
 */
export function barbImageFor({ speedKt, directionDeg } = {}) {
  if (typeof speedKt !== 'number' || !Number.isFinite(speedKt) || speedKt < 3) return null;
  if (typeof directionDeg !== 'number' || !Number.isFinite(directionDeg)) return null;
  const step = Math.min(BARB_MAX_KT, Math.max(BARB_STEP_KT, Math.round(speedKt / BARB_STEP_KT) * BARB_STEP_KT));
  return barbImageId(step);
}
