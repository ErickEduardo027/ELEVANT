// Pure geometry for the aircraft model build (scripts/models/build-aircraft-models.mjs): parts as plain typed arrays,
// no three and no glTF. A part is `{ name, mesh, material, cls, crease, pos, tri }`: `pos` holds x, y, z per vertex
// (Float64Array) and `tri` three vertex indices per triangle (Uint32Array). Every function here is deterministic, so
// the same inputs give the same bytes.
//
// The frame is the app's (aircraft/aircraftDetail.js, aircraft/aircraftGeometry.js): x to the right, y toward the nose,
// z up, the ground at z = 0.

/** Rows of the rotation from each source frame to the app's (all proper rotations, det +1). */
export const SOURCE_FRAMES = Object.freeze({
  // fr24 glTF 2.0 (mbr1376) and livetaiwan: nose −Z, up +Y, right +X → x = X, y = −Z, z = Y.
  'nose-Z': Object.freeze([[1, 0, 0], [0, 0, -1], [0, 1, 0]]),
  // FlightAirMap A319, A321, A332, A333, B788, CRJ9, E190, AT75: nose +Z, up +Y, right −X → x = −X, y = Z, z = Y.
  'nose+Z': Object.freeze([[-1, 0, 0], [0, 0, 1], [0, 1, 0]]),
  // FlightAirMap A320 and B752: nose +X, up +Y, right +Z → x = Z, y = X, z = Y.
  'nose+X': Object.freeze([[0, 0, 1], [1, 0, 0], [0, 1, 0]]),
  // REXO 737 MAX (AC3D): nose −X, up +Y, right −Z → x = −Z, y = −X, z = Y.
  'nose-X': Object.freeze([[0, 0, -1], [-1, 0, 0], [0, 1, 0]]),
});

export function determinant3(m) {
  return m[0][0] * (m[1][1] * m[2][2] - m[1][2] * m[2][1])
    - m[0][1] * (m[1][0] * m[2][2] - m[1][2] * m[2][0])
    + m[0][2] * (m[1][0] * m[2][1] - m[1][1] * m[2][0]);
}

export function triangleCount(parts) {
  return parts.reduce((sum, part) => sum + part.tri.length / 3, 0);
}

/** Apply `fn(x, y, z) → [x, y, z]` to every vertex of the parts (or of those `filter` keeps), in place. */
export function mapVertices(parts, fn, filter = () => true) {
  for (const part of parts) {
    if (!filter(part)) continue;
    const { pos } = part;
    for (let i = 0; i < pos.length; i += 3) {
      const [x, y, z] = fn(pos[i], pos[i + 1], pos[i + 2]);
      pos[i] = x;
      pos[i + 1] = y;
      pos[i + 2] = z;
    }
  }
}

export function rotateParts(parts, rows) {
  mapVertices(parts, (x, y, z) => rows.map(r => r[0] * x + r[1] * y + r[2] * z));
}

/** The box of the vertices that triangles use: `{ min: [x, y, z], max: [x, y, z] }`. */
export function bounds(parts) {
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const part of parts) {
    for (const v of part.tri) {
      for (let k = 0; k < 3; k += 1) {
        const value = part.pos[v * 3 + k];
        if (value < min[k]) min[k] = value;
        if (value > max[k]) max[k] = value;
      }
    }
  }
  return { min, max };
}

export const extent = box => box.max.map((value, k) => value - box.min[k]);

/**
 * Split a part whose pieces lie on both sides of the plane x = 0 and none across it (both engines, both winglets in
 * one mesh) into one part per side, so each side can be found and changed alone. A part with a triangle across the
 * plane (a fuselage, a tailplane) comes back whole.
 */
export function splitBySide(part) {
  let left = false;
  let right = false;
  for (let t = 0; t < part.tri.length; t += 3) {
    let below = 0;
    for (let c = 0; c < 3; c += 1) if (part.pos[part.tri[t + c] * 3] < 0) below += 1;
    // A triangle across (or on) the plane: the part is one piece through it.
    if (below > 0 && below < 3) return [part];
    if (below === 3) left = true; else right = true;
  }
  if (!(left && right)) return [part];
  const sides = [[], []];
  for (let t = 0; t < part.tri.length; t += 3) {
    const x = part.pos[part.tri[t] * 3] + part.pos[part.tri[t + 1] * 3] + part.pos[part.tri[t + 2] * 3];
    sides[x < 0 ? 0 : 1].push(part.tri[t], part.tri[t + 1], part.tri[t + 2]);
  }
  return sides.map(tri => cleanPart({ ...part, tri: Uint32Array.from(tri) }));
}

/** Drop the triangles that repeat a vertex or have no area, and the vertices no triangle uses. */
export function cleanPart(part, minArea = 1e-10) {
  const { pos, tri } = part;
  const kept = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = tri[t]; const b = tri[t + 1]; const c = tri[t + 2];
    if (a === b || b === c || a === c) continue;
    const n = faceNormal(pos, a, b, c);
    if (Math.hypot(n[0], n[1], n[2]) / 2 <= minArea) continue;
    kept.push(a, b, c);
  }
  const remap = new Map();
  const nextPos = [];
  const nextTri = new Uint32Array(kept.length);
  kept.forEach((v, i) => {
    if (!remap.has(v)) {
      remap.set(v, remap.size);
      nextPos.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    nextTri[i] = remap.get(v);
  });
  return { ...part, pos: Float64Array.from(nextPos), tri: nextTri };
}

// A part's fingerprint: its triangle count, its box and the sum of its used vertices, rounded to the centimetre.
function fingerprint(part) {
  const box = bounds([part]);
  const sum = [0, 0, 0];
  for (const v of part.tri) for (let k = 0; k < 3; k += 1) sum[k] += part.pos[v * 3 + k];
  const n = Math.max(1, part.tri.length);
  const cm = value => Math.round(value * 100);
  return [part.tri.length / 3, ...box.min.map(cm), ...box.max.map(cm), ...sum.map(value => cm(value / n))].join(',');
}

/**
 * Drop the overlapping duplicates (same triangles, same box, same centre to the centimetre), which z-fight: the first
 * copy stays. Returns `{ parts, dropped: [{ name, triangles }] }`.
 */
export function dropDuplicates(parts) {
  const seen = new Set();
  const kept = [];
  const dropped = [];
  for (const part of parts) {
    const key = fingerprint(part);
    if (seen.has(key)) dropped.push({ name: part.name, triangles: part.tri.length / 3 });
    else {
      seen.add(key);
      kept.push(part);
    }
  }
  return { parts: kept, dropped };
}

/**
 * Stretch or shrink the fuselage in a constant-section run, between `fromM` and `toM` metres from the nose (fromM <
 * toM), by `deltaM` metres (a plug when positive, its removal when negative). Inside the fuselage band (|x| ≤
 * `bandHalfWidth`) the run maps linearly onto its new length, everything ahead of it moves forward by `deltaM` and
 * everything behind stays: no vertex is added and no gap opens, because the map is continuous. Outside the band (wings,
 * engines, tailplane) nothing stretches: what lies ahead of the run moves by `deltaM`, what lies behind stays, and what
 * lies across the run (a swept wingtip behind the wing root, an engine's intake ahead of it) moves with the wing: by
 * `deltaM` when the wing is ahead of the run (`wing: 'ahead'`), not at all when it is behind (`wing: 'behind'`).
 * Returns the y range of the run before the change and how many triangles cross the band's edge inside the run (they
 * shear).
 */
export function insertPlug(parts, { fromM, toM, deltaM, bandHalfWidth = Infinity, wing = 'behind' }) {
  if (!(toM > fromM)) throw new Error(`plug: the run ${fromM}–${toM} m is empty`);
  const length = toM - fromM;
  if (length + deltaM < length * 0.25) throw new Error(`plug: removing ${-deltaM} m leaves too little of ${length} m`);
  const nose = bounds(parts).max[1];
  const yA = nose - toM;
  const yB = nose - fromM;
  const factor = (length + deltaM) / length;
  const across = wing === 'ahead' ? deltaM : 0;
  let sheared = 0;
  for (const part of parts) {
    for (let t = 0; t < part.tri.length; t += 3) {
      let inBand = 0;
      let inRun = false;
      for (let c = 0; c < 3; c += 1) {
        const v = part.tri[t + c];
        if (Math.abs(part.pos[v * 3]) <= bandHalfWidth) inBand += 1;
        const y = part.pos[v * 3 + 1];
        if (y > yA && y < yB) inRun = true;
      }
      if (inRun && inBand > 0 && inBand < 3) sheared += 1;
    }
  }
  mapVertices(parts, (x, y, z) => {
    if (y <= yA) return [x, y, z];
    if (y >= yB) return [x, y + deltaM, z];
    if (Math.abs(x) > bandHalfWidth) return [x, y + across, z];
    return [x, yA + (y - yA) * factor, z];
  });
  return { yA, yB, sheared };
}

/** Scale across the span outside the fuselage: |x| beyond `r0` grows by `factor`; the fuselage keeps its width. */
export function stretchSpan(parts, r0, factor) {
  mapVertices(parts, (x, y, z) => {
    const ax = Math.abs(x);
    if (ax <= r0) return [x, y, z];
    return [Math.sign(x) * (r0 + (ax - r0) * factor), y, z];
  });
}

export function partBounds(part) {
  return bounds([part]);
}

const inside = (inner, outer) => inner.min.every((value, k) => value >= outer.min[k] && inner.max[k] <= outer.max[k]);

/**
 * Resize the engines: the parts whose name matches `seed` mark each nacelle (one per side of x = 0); every part whose
 * box lies inside a nacelle's envelope (its seed box grown by `margin` of the diameter) belongs to it. Each nacelle is
 * scaled about its own centre to the diameter `diameterM` (or by `scale`) and lengthened by `lengthen`. Returns one
 * record per side.
 */
export function resizeNacelles(parts, { seed, diameterM, scale, lengthen = 1, margin = 0.12 }) {
  const records = [];
  for (const side of [-1, 1]) {
    const seeds = parts.filter(p => seed.test(p.name) && Math.sign(centre(partBounds(p))[0]) === side);
    if (seeds.length === 0) throw new Error(`nacelles: no part matches ${seed} on side ${side}`);
    const box = bounds(seeds);
    const size = extent(box);
    const d0 = Math.max(size[0], size[2]);
    const grow = d0 * margin;
    const envelope = {
      min: [box.min[0] - grow, box.min[1] - grow * 2, box.min[2] - grow],
      max: [box.max[0] + grow, box.max[1] + grow * 2, box.max[2] + grow],
    };
    const members = parts.filter(p => inside(partBounds(p), envelope));
    const [cx, cy, cz] = centre(box);
    const f = scale ?? diameterM / d0;
    const set = new Set(members);
    mapVertices(parts, (x, y, z) => [cx + (x - cx) * f, cy + (y - cy) * lengthen, cz + (z - cz) * f], p => set.has(p));
    records.push({ side, members: members.map(p => p.name), fromDiameterM: d0, toDiameterM: d0 * f });
  }
  return records;
}

export const centre = box => box.min.map((value, k) => (value + box.max[k]) / 2);

/**
 * The wingtip on one side (`side` −1 left, +1 right): the vertices within `bandM` of the outermost x of the parts
 * `isWing` keeps. Returns `{ x, le, te, z, thickness }`: the tip's x, the y of its leading and trailing edges, the z of
 * its middle and its thickness.
 */
export function findWingtip(parts, side, { isWing = () => true, bandM = 0.08 } = {}) {
  let outer = -Infinity;
  for (const part of parts.filter(isWing)) {
    for (const v of part.tri) outer = Math.max(outer, side * part.pos[v * 3]);
  }
  let le = -Infinity; let te = Infinity; let zMin = Infinity; let zMax = -Infinity;
  for (const part of parts.filter(isWing)) {
    for (const v of part.tri) {
      if (side * part.pos[v * 3] < outer - bandM) continue;
      const y = part.pos[v * 3 + 1];
      const z = part.pos[v * 3 + 2];
      le = Math.max(le, y); te = Math.min(te, y); zMin = Math.min(zMin, z); zMax = Math.max(zMax, z);
    }
  }
  return { x: side * outer, le, te, z: (zMin + zMax) / 2, thickness: zMax - zMin };
}

// A thin symmetric airfoil: [share of the chord from the leading edge, share of the thickness], around the section.
const TIP_AIRFOIL = Object.freeze([[0, 0], [0.12, 0.42], [0.4, 0.5], [0.75, 0.3], [1, 0], [0.75, -0.3], [0.4, -0.5],
  [0.12, -0.42]]);

/**
 * A wingtip device lofted out of a wingtip (findWingtip): a sharklet or blended winglet (`kind: 'sharklet'`), which
 * curves out by `reachM` and up by `heightM`, or a raked tip (`kind: 'raked'`), which runs out by `reachM` in the
 * wing's plane. The chord tapers to `taper` of the tip's, the leading edge sweeps back `sweepDeg` from its run; the
 * section is a thin airfoil at least `minThicknessM` thick. Returns a part.
 */
export function wingtipDevice(tip, side, { kind, reachM, heightM = 0, sweepDeg, taper, dihedralDeg = 6, segments = 10,
  minThicknessM = 0.06, name }) {
  const chord0 = tip.le - tip.te;
  const thick0 = Math.max(tip.thickness, minThicknessM);
  const path = kind === 'sharklet'
    ? t => {
      // A quadratic Bézier from the tip, out and then up: (0, 0) → (0.9 reach, 0) → (reach, height).
      const u = 1 - t;
      return [2 * u * t * 0.9 * reachM + t * t * reachM, t * t * heightM];
    }
    : t => [t * reachM, t * reachM * Math.tan((dihedralDeg * Math.PI) / 180)];
  const run = kind === 'sharklet' ? heightM : reachM;
  const sweep = Math.tan((sweepDeg * Math.PI) / 180);
  const pos = [];
  const tri = [];
  const ring = TIP_AIRFOIL.length;
  for (let s = 0; s <= segments; s += 1) {
    const t = s / segments;
    const [dx, dz] = path(t);
    // The section's thickness runs along the path's normal in the x–z plane.
    const e = 1e-4;
    const [ax, az] = path(Math.max(0, t - e));
    const [bx, bz] = path(Math.min(1, t + e));
    const len = Math.hypot(bx - ax, bz - az) || 1;
    const nx = -(bz - az) / len;
    const nz = (bx - ax) / len;
    const chord = chord0 * (1 - (1 - taper) * t);
    const le = tip.le - run * t * sweep;
    const thick = thick0 * (1 - 0.55 * t);
    for (const [u, v] of TIP_AIRFOIL) {
      pos.push(side * (Math.abs(tip.x) + dx + nx * v * thick), le - u * chord, tip.z + dz + nz * v * thick);
    }
  }
  for (let s = 0; s < segments; s += 1) {
    for (let k = 0; k < ring; k += 1) {
      const a = s * ring + k;
      const b = s * ring + ((k + 1) % ring);
      const c = a + ring;
      const d = b + ring;
      tri.push(a, c, b, b, c, d);
    }
  }
  // The cap at the outer end.
  const last = segments * ring;
  for (let k = 1; k < ring - 1; k += 1) tri.push(last, last + k, last + k + 1);
  if (side < 0) for (let t = 0; t < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
  return { name, mesh: name, material: 'wingtip', cls: 'body', crease: 40, pos: Float64Array.from(pos),
    tri: Uint32Array.from(tri) };
}

function faceNormal(pos, a, b, c) {
  const [ux, uy, uz] = [0, 1, 2].map(k => pos[b * 3 + k] - pos[a * 3 + k]);
  const [vx, vy, vz] = [0, 1, 2].map(k => pos[c * 3 + k] - pos[a * 3 + k]);
  return [uy * vz - uz * vy, uz * vx - ux * vz, ux * vy - uy * vx];
}

/**
 * Merge the vertices that share a position (to `epsilon` metres). Returns `{ pos: Float32Array, tri: Uint32Array }`;
 * the triangles that collapse are dropped.
 */
export function weldPositions(pos, tri, epsilon = 1e-4) {
  const key = i => [0, 1, 2].map(k => Math.round(pos[i * 3 + k] / epsilon)).join(',');
  const ids = new Map();
  const out = [];
  const remap = new Uint32Array(pos.length / 3);
  for (let i = 0; i < pos.length / 3; i += 1) {
    const k = key(i);
    if (!ids.has(k)) {
      ids.set(k, ids.size);
      out.push(pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]);
    }
    remap[i] = ids.get(k);
  }
  const nextTri = [];
  for (let t = 0; t < tri.length; t += 3) {
    const a = remap[tri[t]]; const b = remap[tri[t + 1]]; const c = remap[tri[t + 2]];
    if (a !== b && b !== c && a !== c) nextTri.push(a, b, c);
  }
  return { pos: Float32Array.from(out), tri: Uint32Array.from(nextTri) };
}

/**
 * Smooth normals with a crease angle: each corner averages the area-weighted normals of the triangles around its
 * position that turn less than `creaseDeg` from its own. Vertices split where the normals differ. Returns
 * `{ pos: Float32Array, nor: Float32Array, tri: Uint32Array }`.
 */
export function creaseNormals(pos, tri, creaseDeg = 35) {
  const welded = weldPositions(pos, tri, 1e-5);
  const P = welded.pos;
  const T = welded.tri;
  const faces = T.length / 3;
  const area = new Float64Array(faces * 3);
  const unit = new Float64Array(faces * 3);
  for (let f = 0; f < faces; f += 1) {
    const n = faceNormal(P, T[f * 3], T[f * 3 + 1], T[f * 3 + 2]);
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    for (let k = 0; k < 3; k += 1) {
      area[f * 3 + k] = n[k];
      unit[f * 3 + k] = n[k] / len;
    }
  }
  const around = Array.from({ length: P.length / 3 }, () => []);
  for (let f = 0; f < faces; f += 1) for (let c = 0; c < 3; c += 1) around[T[f * 3 + c]].push(f);
  const cos = Math.cos((creaseDeg * Math.PI) / 180);
  const outPos = [];
  const outNor = [];
  const outTri = new Uint32Array(T.length);
  const ids = new Map();
  for (let f = 0; f < faces; f += 1) {
    for (let c = 0; c < 3; c += 1) {
      const v = T[f * 3 + c];
      const n = [0, 0, 0];
      for (const g of around[v]) {
        const dot = unit[f * 3] * unit[g * 3] + unit[f * 3 + 1] * unit[g * 3 + 1] + unit[f * 3 + 2] * unit[g * 3 + 2];
        if (dot >= cos) for (let k = 0; k < 3; k += 1) n[k] += area[g * 3 + k];
      }
      const len = Math.hypot(n[0], n[1], n[2]);
      const nn = len > 0 ? n.map(value => value / len) : [unit[f * 3], unit[f * 3 + 1], unit[f * 3 + 2]];
      const key = `${v},${Math.round(nn[0] * 127)},${Math.round(nn[1] * 127)},${Math.round(nn[2] * 127)}`;
      if (!ids.has(key)) {
        ids.set(key, ids.size);
        outPos.push(P[v * 3], P[v * 3 + 1], P[v * 3 + 2]);
        outNor.push(...nn);
      }
      outTri[f * 3 + c] = ids.get(key);
    }
  }
  return { pos: Float32Array.from(outPos), nor: Float32Array.from(outNor), tri: outTri };
}

/** Concatenate parts into one `{ pos: Float64Array, tri: Uint32Array }`. */
export function mergeParts(parts) {
  const vertexCount = parts.reduce((sum, p) => sum + p.pos.length / 3, 0);
  const triCount = parts.reduce((sum, p) => sum + p.tri.length, 0);
  const pos = new Float64Array(vertexCount * 3);
  const tri = new Uint32Array(triCount);
  let vOffset = 0;
  let tOffset = 0;
  for (const part of parts) {
    pos.set(part.pos, vOffset * 3);
    for (let i = 0; i < part.tri.length; i += 1) tri[tOffset + i] = part.tri[i] + vOffset;
    vOffset += part.pos.length / 3;
    tOffset += part.tri.length;
  }
  return { pos, tri };
}

/** Keep only the vertices `tri` uses, in order of first use. */
export function compact(pos, tri) {
  const remap = new Map();
  const out = [];
  const nextTri = new Uint32Array(tri.length);
  for (let i = 0; i < tri.length; i += 1) {
    const v = tri[i];
    if (!remap.has(v)) {
      remap.set(v, remap.size);
      out.push(pos[v * 3], pos[v * 3 + 1], pos[v * 3 + 2]);
    }
    nextTri[i] = remap.get(v);
  }
  return { pos: Float32Array.from(out), tri: nextTri };
}
