// A small reader for AC3D (.ac), the text format of FlightGear models (scripts/models/build-aircraft-models.mjs). It
// reads the text as data and executes nothing: MATERIAL lines, then OBJECT blocks with `name`, `data`, `texture`,
// `crease`, `loc`, `rot`, `numvert`, `numsurf` (SURF, `mat`, `refs`) and `kids`. Polygons are fan-triangulated; line
// surfaces are skipped. Each object's vertices go to the world with its parents' `loc` and `rot`
// (world = parent · T(loc) · R(rot), as tools/analyze_ac.py of the evaluation). Pure.

const unquote = value => {
  const match = /^"(.*)"$/.exec(value.trim());
  return match ? match[1] : value.trim();
};

function parseMaterial(line) {
  const name = /"([^"]*)"/.exec(line)?.[1] ?? '';
  const rgb = /\brgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)/.exec(line);
  const trans = /\btrans\s+([-\d.e]+)/.exec(line);
  return {
    name, rgb: rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : [1, 1, 1], trans: trans ? Number(trans[1]) : 0,
  };
}

const IDENTITY = Object.freeze([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);

// Row-major 4 × 4 products.
function multiply(a, b) {
  const out = new Array(16).fill(0);
  for (let r = 0; r < 4; r += 1) {
    for (let c = 0; c < 4; c += 1) {
      for (let k = 0; k < 4; k += 1) out[r * 4 + c] += a[r * 4 + k] * b[k * 4 + c];
    }
  }
  return out;
}

/**
 * Parse an AC3D text. Returns `{ materials: [{ name, rgb, trans }], parts: [{ name, path, material, crease, hidden,
 * texture, pos: Float64Array, tri: Uint32Array }] }`, one part per object with triangles, in the world frame of the
 * file. A part takes the material of its first surface.
 */
export function parseAc3d(text) {
  const lines = text.split(/\r?\n/);
  if (!/^AC3D/.test(lines[0] ?? '')) throw new Error('ac3d: the file does not start with AC3D');
  const materials = [];
  const parts = [];
  let i = 1;

  function readObject(parent, parentPath) {
    i += 1; // the OBJECT line
    let name = '';
    let loc = [0, 0, 0];
    let rot = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    let verts = [];
    let crease = 30;
    let texture = null;
    let hidden = false;
    let material = null;
    const tri = [];
    let kids = 0;
    while (i < lines.length) {
      const line = lines[i];
      const tok = line.trim().split(/\s+/);
      const key = tok[0];
      if (key === '') { i += 1; continue; }
      if (key === 'name') { name = unquote(line.trim().slice(4)); i += 1; }
      else if (key === 'data') {
        const n = Number(tok[1]);
        i += 1;
        let consumed = 0;
        while (consumed < n && i < lines.length) { consumed += lines[i].length + 1; i += 1; }
      }
      else if (key === 'texture') { texture = unquote(line.trim().slice(7)); i += 1; }
      else if (key === 'crease') { crease = Number(tok[1]); i += 1; }
      else if (key === 'loc') { loc = tok.slice(1, 4).map(Number); i += 1; }
      else if (key === 'rot') { rot = tok.slice(1, 10).map(Number); i += 1; }
      else if (key === 'hidden') { hidden = true; i += 1; }
      else if (key === 'numvert') {
        const n = Number(tok[1]);
        verts = new Array(n);
        for (let k = 0; k < n; k += 1) verts[k] = lines[i + 1 + k].trim().split(/\s+/).slice(0, 3).map(Number);
        i += 1 + n;
      }
      else if (key === 'numsurf') {
        const n = Number(tok[1]);
        i += 1;
        for (let s = 0; s < n; s += 1) {
          const flags = Number.parseInt(lines[i].trim().split(/\s+/)[1], 16);
          i += 1;
          let mat = null;
          if (lines[i].trim().startsWith('mat')) { mat = Number(lines[i].trim().split(/\s+/)[1]); i += 1; }
          const k = Number(lines[i].trim().split(/\s+/)[1]);
          i += 1;
          const refs = [];
          for (let r = 0; r < k; r += 1) refs.push(Number(lines[i + r].trim().split(/\s+/)[0]));
          i += k;
          // Low nibble 0: a polygon; 1 and 2 are closed and open lines.
          if ((flags & 0x0f) === 0 && k >= 3) {
            if (material === null && mat !== null) material = mat;
            for (let t = 1; t < k - 1; t += 1) tri.push(refs[0], refs[t], refs[t + 1]);
          }
        }
      }
      else if (key === 'kids') { kids = Number(tok[1]); i += 1; break; }
      else i += 1;
    }
    const local = [rot[0], rot[1], rot[2], loc[0], rot[3], rot[4], rot[5], loc[1], rot[6], rot[7], rot[8], loc[2],
      0, 0, 0, 1];
    const world = multiply(parent, local);
    const path = parentPath ? `${parentPath}/${name}` : name;
    const valid = [];
    for (let t = 0; t < tri.length; t += 3) {
      if (tri[t] < verts.length && tri[t + 1] < verts.length && tri[t + 2] < verts.length) {
        valid.push(tri[t], tri[t + 1], tri[t + 2]);
      }
    }
    if (verts.length > 0 && valid.length > 0) {
      const pos = new Float64Array(verts.length * 3);
      verts.forEach(([x, y, z], k) => {
        pos[k * 3] = world[0] * x + world[1] * y + world[2] * z + world[3];
        pos[k * 3 + 1] = world[4] * x + world[5] * y + world[6] * z + world[7];
        pos[k * 3 + 2] = world[8] * x + world[9] * y + world[10] * z + world[11];
      });
      parts.push({ name, path, material: material === null ? null : materials[material]?.name ?? null, crease,
        hidden, texture, pos, tri: Uint32Array.from(valid) });
    }
    for (let k = 0; k < kids; k += 1) {
      while (i < lines.length && !lines[i].startsWith('OBJECT')) i += 1;
      if (i < lines.length) readObject(world, path);
    }
  }

  while (i < lines.length) {
    if (lines[i].startsWith('MATERIAL')) { materials.push(parseMaterial(lines[i])); i += 1; }
    else if (lines[i].startsWith('OBJECT')) readObject(IDENTITY, '');
    else i += 1;
  }
  return { materials, parts };
}
