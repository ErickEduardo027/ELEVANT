import { fromEnu } from '../airport/geo';
import { silhouetteOutline } from './silhouette';

// The footprint of an aircraft at true size on the ground (design D3): the plan view of its type (aircraft/silhouette.js,
// from the same dimension table as its icon and its 3D model of PR M7), turned to a heading and placed with its centre
// on a point. The stand layers draw it on a stand (stands/standFeatures.js): solid where the aircraft is on the stand,
// dashed where it is still to come, so one sees whether it fits. Pure.

const DEGREE = Math.PI / 180;
// Seven decimals of a degree are about a centimetre: the footprint keeps its shape and its features stay small.
const round = value => Math.round(value * 1e7) / 1e7;

/**
 * The footprint of `spec` (an aircraft type of aircraft/types.js) with its centre at `center` (`[lng, lat]`) and its
 * nose along `headingTrue` (degrees true, clockwise from north): a closed ring `[[lng, lat], …]` whose first point is
 * the nose. The outline's box is span × length, so the footprint's is too: the span across the heading, the length
 * along it.
 */
export function aircraftFootprint(spec, center, headingTrue) {
  const heading = (Number.isFinite(headingTrue) ? headingTrue : 0) * DEGREE;
  const cos = Math.cos(heading);
  const sin = Math.sin(heading);
  // The outline's x runs to the right wing and its y to the nose; on the ground the nose points along the heading and
  // the right wing 90° clockwise from it.
  const ring = silhouetteOutline(spec).map(([x, y]) => {
    const [lng, lat] = fromEnu(center, [x * cos + y * sin, y * cos - x * sin]);
    return [round(lng), round(lat)];
  });
  return [...ring, [...ring[0]]];
}
