import { destinationPoint, haversineM, initialBearing, toLocal } from './geo.js';

// The shape of a stand on the airport layout (PR M3): a box sized by the ICAO code letter of the largest aircraft it
// takes, centred on the stand point (owner decision 20: the point is the centre of the stand), its depth along the
// heading the parked aircraft's nose points to, and the lead-in line from the taxilane to that centre. Pure and
// Node-safe like geo.js. Moving a box rigidly to a location OCC saved (resolveStandGeometry) is PR M4.

/** Span limit plus Annex 14 clearance (width) and the length of the longest common type (depth), in metres. */
export const STAND_BOX = Object.freeze({
  C: Object.freeze({ widthM: 41, depthM: 50 }),
  D: Object.freeze({ widthM: 60, depthM: 66 }),
  E: Object.freeze({ widthM: 73, depthM: 80 }),
  F: Object.freeze({ widthM: 88, depthM: 82 }),
});

export const SIZE_LETTERS = Object.freeze(Object.keys(STAND_BOX));

/**
 * How far behind a stand's centre an aircraft of its code letter lines up on the stand axis when no taxi edge lies
 * straight behind it: half the box's depth plus half its width. Taxiing across the row there, its wingtips clear the
 * tails of the stands beside it.
 */
export function lineUpDistanceM(sizeLetter) {
  const size = STAND_BOX[sizeLetter];
  if (!size) throw new Error(`Unknown stand size letter: ${sizeLetter}`);
  return (size.depthM + size.widthM) / 2;
}

const normalizeBearing = degrees => ((degrees % 360) + 360) % 360;
const angleBetween = (a, b) => Math.abs(((a - b + 540) % 360) - 180);

/**
 * The closed 5-point ring `[lng, lat]` of a stand box: nose-left, nose-right, tail-right, tail-left, nose-left.
 * `maxWidthM` narrows the box (never widens it) where the row spacing is tighter than the code letter.
 */
export function standBox(center, headingTrue, sizeLetter, { maxWidthM = Infinity } = {}) {
  const size = STAND_BOX[sizeLetter];
  if (!size) throw new Error(`Unknown stand size letter: ${sizeLetter}`);
  const width = Math.min(size.widthM, maxWidthM);
  const plane = toLocal(center);
  const radians = (headingTrue * Math.PI) / 180;
  const nose = [Math.sin(radians), Math.cos(radians)];
  const right = [Math.cos(radians), -Math.sin(radians)];
  const corner = (along, across) => plane.inverse([
    nose[0] * along + right[0] * across,
    nose[1] * along + right[1] * across,
  ]);
  const halfDepth = size.depthM / 2;
  const halfWidth = width / 2;
  const ring = [
    corner(halfDepth, -halfWidth),
    corner(halfDepth, halfWidth),
    corner(-halfDepth, halfWidth),
    corner(-halfDepth, -halfWidth),
  ];
  return [...ring, ring[0]];
}

/**
 * Picks the direction of an axis (`axisDeg` or its opposite) that points towards `target` (`towards: true`, the
 * terminal for a contact stand) or away from it (`towards: false`, the taxilane for a remote stand). The result is in
 * [0, 360).
 */
export function headingFromAxis(axisDeg, center, target, { towards = true } = {}) {
  const forward = normalizeBearing(axisDeg);
  const backward = normalizeBearing(axisDeg + 180);
  const bearing = initialBearing(center, target);
  const forwardCloser = angleBetween(forward, bearing) <= angleBetween(backward, bearing);
  return forwardCloser === towards ? forward : backward;
}

/**
 * The lead-in line from the taxi network to the stand centre: `[snapPoint, center]` when the snap point lies on the
 * stand's tail axis, otherwise `[snapPoint, alignPoint, center]`, where the aircraft lines up behind the stand on its
 * axis before rolling in nose first. The align point sits abreast of the snap point, and at least `minAlignM` metres
 * behind the centre (`lineUpDistanceM`, so the aircraft lines up clear of its row instead of crossing it).
 */
export function leadIn(center, headingTrue, snapPoint, { minAlignM = 0 } = {}) {
  const plane = toLocal(center);
  const [x, y] = plane.forward(snapPoint);
  const back = normalizeBearing(headingTrue + 180);
  const radians = (back * Math.PI) / 180;
  const alongBack = Math.max(minAlignM, x * Math.sin(radians) + y * Math.cos(radians));
  const align = destinationPoint(center, back, alongBack);
  const line = [snapPoint];
  if (haversineM(align, snapPoint) > 1 && haversineM(align, center) > 1) line.push(align);
  line.push(center);
  return line;
}
