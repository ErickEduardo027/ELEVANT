// The contact shadow of a 3D aircraft (M4, 2026-11-28): a soft ellipse on the ground under it, darkest in its middle
// and gone at its rim, that ties the model to the apron as the flat silhouette (instancePlan.js: SHADOW) cannot. It is
// map rendering, not UI chrome (ADR-0044 keeps shadows out of the panels only). Pure: the layer
// (aircraft3dLayer.js) builds its disc once and writes one matrix and one strength per aircraft.
//
// - Size: scaled by the type, `alongShare` of its length along the fuselage and `acrossShare` of its span across it
//   (semi-axes), spreading to `spreadAtFade` times that as the aircraft climbs;
// - strength: 1 on the ground, fading smoothly to 0 at `fadeM` above the field (an aircraft in the air has none);
// - the governor's «shadows and drop lines» switch (core/aircraft3d.js: setQuality) takes it away with the silhouette.

/** The contact shadow's constants (M4, 2026-11-28). */
export const CONTACT_SHADOW = Object.freeze({
  // Two centimetres above the ground, under the silhouette's five (instancePlan.js: SHADOW.heightM).
  heightM: 0.02,
  alongShare: 0.56,
  acrossShare: 0.36,
  fadeM: 45,
  spreadAtFade: 1.6,
  // How much of the ground's light the middle of the ellipse takes away (the layer's blend: ground × (1 − darkness)).
  darkness: 0.5,
  // The falloff from the middle (radius 0) to the rim (radius 1): `[radius, share of darkness]`.
  rings: Object.freeze([Object.freeze([0, 1]), Object.freeze([0.35, 0.85]), Object.freeze([0.65, 0.45]),
    Object.freeze([1, 0])]),
  segments: 32,
});

const finite = value => typeof value === 'number' && Number.isFinite(value);
const positive = value => (finite(value) && value > 0 ? value : 0);

/**
 * The strength of the contact shadow of an aircraft `heightM` metres above the field: 1 on the ground (or below it),
 * then a smooth fall to 0 at CONTACT_SHADOW.fadeM and above; 1 for a height that is not a number (a parked aircraft).
 */
export function contactShadowStrength(heightM) {
  if (!finite(heightM) || heightM <= 0) return 1;
  const share = Math.min(1, heightM / CONTACT_SHADOW.fadeM);
  const rest = 1 - share;
  // Smoothstep from 1 to 0: no edge where it ends.
  return rest * rest * (3 - 2 * rest);
}

/**
 * The semi-axes of the contact shadow of a type `spec` (`{ lengthM, spanM }`, aircraft/types.js) `heightM` above the
 * field: `{ alongM, acrossM }`, along the fuselage and across it, spreading with the height up to
 * CONTACT_SHADOW.spreadAtFade at fadeM. A spec without sizes has none (0, 0).
 */
export function contactShadowSize(spec, heightM = 0) {
  const share = finite(heightM) && heightM > 0 ? Math.min(1, heightM / CONTACT_SHADOW.fadeM) : 0;
  const spread = 1 + (CONTACT_SHADOW.spreadAtFade - 1) * share;
  return {
    alongM: CONTACT_SHADOW.alongShare * positive(spec?.lengthM) * spread,
    acrossM: CONTACT_SHADOW.acrossShare * positive(spec?.spanM) * spread,
  };
}

/**
 * The column-major matrix (three's Matrix4.elements) that lays the unit disc (contactDisc) as the contact shadow at
 * `x`, `y` in the local frame (metres east and north of the ARP): T(x, y, heightM) · Rz(−heading) · S(acrossM, alongM,
 * 1), so its long axis points along the heading, as the models' noses do (instancePlan.js).
 */
export function contactShadowMatrix({ x = 0, y = 0, headingDeg = 0, alongM, acrossM, z = CONTACT_SHADOW.heightM }) {
  const radians = ((finite(headingDeg) ? headingDeg : 0) * Math.PI) / 180;
  const cos = Math.cos(radians);
  const sin = Math.sin(radians);
  const across = positive(acrossM);
  const along = positive(alongM);
  return [cos * across, -sin * across, 0, 0, sin * along, cos * along, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

/**
 * The unit disc of the contact shadow, facing up: a centre and one ring of `segments` vertices per CONTACT_SHADOW.rings
 * radius after the first, `{ positions, colors, indices }` (3 floats per vertex; colours grey, the darkness at that
 * radius, so the middle is darkest and the rim 0; triangles counter-clockwise from above).
 */
export function contactDisc(segments = CONTACT_SHADOW.segments) {
  const count = Math.max(8, Math.floor(segments));
  const rings = CONTACT_SHADOW.rings.slice(1);
  const vertices = 1 + rings.length * count;
  const positions = new Float32Array(3 * vertices);
  const colors = new Float32Array(3 * vertices);
  colors.fill(CONTACT_SHADOW.darkness * CONTACT_SHADOW.rings[0][1], 0, 3);
  rings.forEach(([radius, share], ring) => {
    for (let index = 0; index < count; index += 1) {
      const angle = (2 * Math.PI * index) / count;
      const vertex = 1 + ring * count + index;
      positions.set([radius * Math.cos(angle), radius * Math.sin(angle), 0], 3 * vertex);
      colors.fill(CONTACT_SHADOW.darkness * share, 3 * vertex, 3 * vertex + 3);
    }
  });
  const indices = [];
  for (let index = 0; index < count; index += 1) indices.push(0, 1 + index, 1 + ((index + 1) % count));
  for (let ring = 1; ring < rings.length; ring += 1) {
    const inner = 1 + (ring - 1) * count;
    const outer = 1 + ring * count;
    for (let index = 0; index < count; index += 1) {
      const next = (index + 1) % count;
      indices.push(inner + index, outer + index, outer + next, inner + index, outer + next, inner + next);
    }
  }
  return { positions, colors, indices: Uint16Array.from(indices) };
}
