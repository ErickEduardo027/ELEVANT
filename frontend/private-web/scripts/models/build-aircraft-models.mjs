#!/usr/bin/env node
// Builds the 3D aircraft models of the OCC maps (plan M5) from GPL models published on GitHub, reproducibly:
//
//   node scripts/models/build-aircraft-models.mjs <sources-dir> [--only A320,B738] [--out <dir>] [--inspect]
//
// <sources-dir> holds the files of scripts/models/aircraft-sources.json at their `path` (one folder per repository,
// downloaded from their pinned `url`); the script checks each file's SHA-256 before reading it and stops on any
// mismatch. For every type of lib/recipes.mjs it reads the base model (glTF 2.0 binary or AC3D), turns it to the app's
// frame (x right, y toward the nose, z up), drops what the app draws itself or what would z-fight (lines and points,
// overlapping duplicates, light halos, cabin, decals, the REXO landing gear) and every texture, UV and original
// material (the livery is the app's shader), adjusts siblings (fuselage plugs in constant-section runs, engines,
// procedural wingtips), scales it to the dimensions of src/features/maps/aircraft/types.js and lifts it so its wheels
// would stand on z = 0 (no model keeps its gear: the app adds its procedural gear). It writes per type, in
// public/models/aircraft/<ICAO>/:
//   - l2.gltf + l2.bin: the model the map follows (≤ 60 000 triangles, one primitive per class: body, glass, dark);
//   - l1.gltf + l1.bin: simplified with meshoptimizer (≤ 15 000 triangles, one primitive), for near and parked
//     aircraft;
//   - LICENSE (the upstream licence text), NOTICE.md (origin, authors, changes and their date) and SOURCE.md (how to
//     rebuild it).
// Both levels are quantized with KHR_mesh_quantization, carry no textures and are .gltf with an external .bin (no
// GLB, no Draco, meshopt or KTX2: the production CSP stays as it is). manifest.json lists every type.
//
// Nothing from the sources is executed: GLB and AC3D are read as data. The output is deterministic.

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Document, NodeIO, Primitive } from '@gltf-transform/core';
import { ALL_EXTENSIONS } from '@gltf-transform/extensions';
import { quantize } from '@gltf-transform/functions';
import { MeshoptSimplifier } from 'meshoptimizer';
import { parseAc3d } from './lib/ac3d.mjs';
import {
  SOURCE_FRAMES, bounds, centre, cleanPart, compact, creaseNormals, determinant3, dropDuplicates, extent, findWingtip,
  insertPlug, mapVertices, mergeParts, resizeNacelles, rotateParts, splitBySide, stretchSpan, triangleCount,
  weldPositions, wingtipDevice,
} from './lib/mesh.mjs';
import { classify } from './lib/classes.mjs';
import { BASES, RECIPES } from './lib/recipes.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '../..');
const DEFAULT_OUT = path.join(APP, 'public/models/aircraft');
const SOURCES_FILE = path.join(HERE, 'aircraft-sources.json');
/** The date of the changes recorded in each NOTICE (GPLv2 § 2a). Fixed, so a rebuild gives the same bytes. */
export const CHANGE_DATE = '2026-11-27';
export const LIMITS = Object.freeze({ l2: 60000, l1: 15000, l1MinRatio: 0.2, totalBytes: 25 * 1024 * 1024 });
const GENERATOR = 'ELEVANT scripts/models/build-aircraft-models.mjs (glTF-Transform 4.5.1, meshoptimizer 1.2.0)';
const CLASS_COLOURS = Object.freeze({
  body: [0.9, 0.91, 0.92, 1], glass: [0.1, 0.13, 0.17, 1], dark: [0.24, 0.25, 0.27, 1],
});
const CLASSES = Object.keys(CLASS_COLOURS);
// The clearance of the lowest part (a nacelle, or the belly of a rear-engined jet or a high-wing turboprop) over the
// ground, in metres, by icon category: estimated bounds for a model whose fin is shorter or taller than the type's.
export const GROUND_CLEARANCE_M = Object.freeze({
  min: 0.3, max: Object.freeze({ narrow: 0.75, wide2: 1.1, regional: 0.6, turboprop: 0.7 }),
});

const { AIRCRAFT_TYPES } = await import(pathToFileURL(path.join(APP, 'src/features/maps/aircraft/types.js')).href);

const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');

function loadSources(dir) {
  const list = JSON.parse(fs.readFileSync(SOURCES_FILE, 'utf8'));
  const byPath = new Map(list.files.map(file => [file.path, file]));
  return {
    list,
    read(relative) {
      const entry = byPath.get(relative);
      if (!entry) throw new Error(`${relative} is not in aircraft-sources.json`);
      const buffer = fs.readFileSync(path.join(dir, relative));
      const digest = sha256(buffer);
      if (digest !== entry.sha256) throw new Error(`${relative}: SHA-256 ${digest} is not the pinned ${entry.sha256}`);
      return { buffer, entry };
    },
    entry: relative => byPath.get(relative),
  };
}

// ── Reading ───────────────────────────────────────────────────────────────────────────────────────────────────────

async function readGlbParts(io, buffer, log) {
  const doc = await io.readBinary(new Uint8Array(buffer));
  const parts = [];
  let lines = 0;
  for (const node of doc.getRoot().listNodes()) {
    const mesh = node.getMesh();
    if (!mesh) continue;
    const m = node.getWorldMatrix(); // column-major
    const rows = [[m[0], m[4], m[8]], [m[1], m[5], m[9]], [m[2], m[6], m[10]]];
    const flip = determinant3(rows) < 0;
    for (const prim of mesh.listPrimitives()) {
      if (prim.getMode() !== Primitive.Mode.TRIANGLES) {
        lines += 1;
        continue;
      }
      const position = prim.getAttribute('POSITION');
      const count = position.getCount();
      const pos = new Float64Array(count * 3);
      const el = [0, 0, 0];
      for (let i = 0; i < count; i += 1) {
        position.getElement(i, el);
        pos[i * 3] = m[0] * el[0] + m[4] * el[1] + m[8] * el[2] + m[12];
        pos[i * 3 + 1] = m[1] * el[0] + m[5] * el[1] + m[9] * el[2] + m[13];
        pos[i * 3 + 2] = m[2] * el[0] + m[6] * el[1] + m[10] * el[2] + m[14];
      }
      const indices = prim.getIndices();
      const tri = indices ? Uint32Array.from(indices.getArray()) : Uint32Array.from({ length: count }, (_, i) => i);
      if (flip) for (let t = 0; t < tri.length; t += 3) [tri[t + 1], tri[t + 2]] = [tri[t + 2], tri[t + 1]];
      const material = prim.getMaterial()?.getName() ?? '';
      const name = node.getName() && node.getName() !== 'rootNode' ? node.getName() : mesh.getName() || node.getName();
      const cls = classify(name, mesh.getName(), material);
      parts.push({ name, mesh: mesh.getName(), material, cls, crease: 35, pos, tri });
    }
  }
  if (lines > 0) log.push(`Quitadas ${lines} primitivas de líneas o puntos.`);
  return parts;
}

function readAcParts(buffer) {
  const { parts } = parseAc3d(buffer.toString('latin1'));
  return parts.map(part => ({ ...part, mesh: part.path, cls: classify(part.name, part.material) }));
}

async function loadBase(io, sources, baseKey, log) {
  const base = BASES[baseKey];
  const { buffer } = sources.read(base.source);
  const parts = base.source.endsWith('.ac') ? readAcParts(buffer) : await readGlbParts(io, buffer, log);
  rotateParts(parts, SOURCE_FRAMES[base.frame]);
  // Some bases sit off their own origin (the A330s): centre them on the span and the length, the lowest point on z = 0.
  const box = bounds(parts);
  const [cx, cy] = centre(box);
  mapVertices(parts, (x, y, z) => [x - cx, y - cy, z - box.min[2]]);
  log.push(`Girado al marco de la app (x a la derecha, y hacia la nariz, z arriba) desde «${base.frame}».`);
  log.push('Quitadas todas las texturas, coordenadas UV y materiales originales: la librea es un shader de la app.');
  return parts;
}

// ── Processing ────────────────────────────────────────────────────────────────────────────────────────────────────

const round = (value, digits = 2) => Math.round(value * 10 ** digits) / 10 ** digits;
const fmt = value => round(value).toLocaleString('es', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function cleanup(parts, base, log) {
  let kept = parts.map(part => cleanPart(part)).flatMap(part => splitBySide(part)).filter(part => part.tri.length > 0);
  const drop = base.drop ?? [];
  const droppedNames = [];
  let droppedTris = 0;
  kept = kept.filter(part => {
    const hit = drop.some(rule => rule.test(part.name) || rule.test(part.mesh ?? ''));
    if (hit) {
      droppedNames.push(part.name);
      droppedTris += part.tri.length / 3;
    }
    return !hit;
  });
  if (droppedNames.length > 0) {
    const unique = [...new Set(droppedNames)].sort();
    log.push(`Quitadas ${unique.length} piezas (${droppedTris} triángulos): ${unique.join(', ')}.`);
  }
  const dups = dropDuplicates(kept);
  if (dups.dropped.length > 0) {
    const tris = dups.dropped.reduce((sum, d) => sum + d.triangles, 0);
    log.push(`Quitadas ${dups.dropped.length} piezas duplicadas superpuestas (${tris} triángulos).`);
  }
  return dups.parts;
}

function processType(icao, parts, log) {
  const recipe = RECIPES[icao];
  const spec = AIRCRAFT_TYPES[icao];
  const baseSpec = AIRCRAFT_TYPES[recipe.base];
  if (!spec || !baseSpec) throw new Error(`${icao}: no row in types.js`);
  const ext0 = extent(bounds(parts));
  const kBase = baseSpec.lengthM / ext0[1];
  mapVertices(parts, (x, y, z) => [x * kBase, y * kBase, z * kBase]);
  log.push(`Escalado ×${kBase.toFixed(4)} a la longitud del ${recipe.base} (${fmt(baseSpec.lengthM)} m).`);

  // Fuselage plugs, aft run first so the stations of the forward one (from the nose) stay put. The forward run lies
  // ahead of the wing, every other one behind it.
  if (recipe.plugs) {
    const total = spec.lengthM - baseSpec.lengthM;
    const band = (spec.fuselageDiaM / 2) * 1.2;
    const forward = Math.min(...recipe.plugs.map(([fromM]) => fromM));
    for (const [fromM, toM, share] of [...recipe.plugs].sort((a, b) => b[0] - a[0])) {
      const deltaM = total * share;
      const margin = 0.25;
      const run = { fromM: fromM + margin, toM: toM - margin, deltaM, bandHalfWidth: band,
        wing: fromM === forward ? 'behind' : 'ahead' };
      const { sheared } = insertPlug(parts, run);
      if (sheared > 0) console.warn(`${icao}: plug ${fromM}–${toM} m shears ${sheared} triangles`);
      log.push(`${deltaM >= 0 ? 'Insertado un tramo' : 'Retirado un tramo'} de fuselaje de ${fmt(Math.abs(deltaM))} m `
        + `entre ${fmt(run.fromM)} y ${fmt(run.toM)} m desde la nariz (sección constante; reparto estimado).`);
    }
  }

  // The span: brought to the type's (or to the wing before its wingtip devices) outside the fuselage.
  const tips = recipe.tips;
  const spanTarget = tips?.spanBeforeM ?? (tips ? null : spec.spanM);
  if (spanTarget) {
    const span = extent(bounds(parts))[0];
    const factor = spanTarget / span;
    if (Math.abs(factor - 1) > 0.012) {
      const r0 = (spec.fuselageDiaM / 2) * 1.1;
      stretchSpan(parts, r0, (spanTarget / 2 - r0) / (span / 2 - r0));
      log.push(`Envergadura llevada de ${fmt(span)} a ${fmt(spanTarget)} m fuera del fuselaje (alas, motores y `
        + 'estabilizador).');
    }
  }

  if (recipe.nacelles) {
    const records = resizeNacelles(parts, recipe.nacelles);
    for (const rec of records) {
      const sideName = rec.side < 0 ? 'izquierda' : 'derecha';
      log.push(`Góndola ${sideName} de Ø ${fmt(rec.fromDiameterM)} a Ø ${fmt(rec.toDiameterM)} m y alargada `
        + `×${recipe.nacelles.lengthen} (${rec.members.length} piezas; forma estimada).`);
    }
  }

  if (tips) {
    const span = extent(bounds(parts))[0];
    const reachM = (spec.spanM - span) / 2;
    if (reachM > 0.05) {
      for (const side of [-1, 1]) {
        const tip = findWingtip(parts, side);
        parts.push(wingtipDevice(tip, side, { ...tips, reachM, name: `${tips.kind}.${side < 0 ? 'L' : 'R'}` }));
      }
      const added = tips.kind === 'sharklet'
        ? 'Añadidos sharklets procedurales' : 'Añadidas puntas inclinadas procedurales';
      log.push(`${added} (forma estimada): envergadura de ${fmt(span)} a ${fmt(spec.spanM)} m.`);
    }
  }

  // Centre on the span and the length and lift the model so the gear the app draws stands on z = 0: the fin's top at
  // the type's height, unless that leaves the lowest part (a nacelle, or the belly) implausibly high or low for its
  // category; then the clearance is clamped and the fin ends below or above the published height.
  const box = bounds(parts);
  const [cx, cy] = centre(box);
  const lift = spec.heightM - (box.max[2] - box.min[2]);
  const groundM = Math.min(GROUND_CLEARANCE_M.max[spec.iconCategory] ?? 0.75, Math.max(GROUND_CLEARANCE_M.min, lift));
  mapVertices(parts, (x, y, z) => [x - cx, y - cy, z - box.min[2] + groundM]);
  const finM = box.max[2] - box.min[2] + groundM;
  log.push(`Centrado en la envergadura y la longitud y elevado: la parte más baja queda a ${fmt(groundM)} m del suelo `
    + `(z = 0) y la deriva a ${fmt(finM)} m (${fmt(spec.heightM)} m publicados); el tren lo dibuja la app (est.).`);
  return { groundM };
}

// ── Writing ───────────────────────────────────────────────────────────────────────────────────────────────────────

function writePrimitive(doc, buffer, mesh, materials, cls, { pos, nor, tri }) {
  const vertexCount = pos.length / 3;
  const index = vertexCount < 65536 ? Uint16Array.from(tri) : Uint32Array.from(tri);
  const prim = doc.createPrimitive()
    .setAttribute('POSITION', doc.createAccessor().setType('VEC3').setArray(pos).setBuffer(buffer))
    .setAttribute('NORMAL', doc.createAccessor().setType('VEC3').setArray(nor).setBuffer(buffer))
    .setIndices(doc.createAccessor().setType('SCALAR').setArray(index).setBuffer(buffer))
    .setMaterial(materials[cls]);
  mesh.addPrimitive(prim);
}

async function writeLevel(io, file, icao, licence, groups) {
  const doc = new Document();
  doc.getRoot().getAsset().generator = GENERATOR;
  doc.getRoot().getAsset().copyright = `${licence}; véanse LICENSE y NOTICE.md en esta carpeta`;
  const buffer = doc.createBuffer('buffer').setURI(`${path.basename(file, '.gltf')}.bin`);
  const materials = Object.fromEntries(CLASSES.map(cls => [cls, doc.createMaterial(cls)
    .setBaseColorFactor(CLASS_COLOURS[cls]).setMetallicFactor(0).setRoughnessFactor(0.7).setDoubleSided(true)]));
  const mesh = doc.createMesh(icao);
  for (const [cls, geometry] of groups) writePrimitive(doc, buffer, mesh, materials, cls, geometry);
  const node = doc.createNode(icao).setMesh(mesh);
  doc.getRoot().setDefaultScene(doc.createScene(icao).addChild(node));
  for (const material of doc.getRoot().listMaterials()) {
    if (!mesh.listPrimitives().some(p => p.getMaterial() === material)) material.dispose();
  }
  await doc.transform(quantize({ quantizePosition: 14, quantizeNormal: 8 }));
  await io.write(file, doc);
  return fs.readdirSync(path.dirname(file)).filter(name => name.startsWith(path.basename(file, '.gltf')));
}

function simplifyL1(parts, log) {
  const merged = mergeParts(parts);
  const welded = weldPositions(merged.pos, merged.tri, 1e-4);
  const triangles = welded.tri.length / 3;
  const floor = Math.ceil(triangles * LIMITS.l1MinRatio);
  const target = Math.max(floor, Math.min(LIMITS.l1 - 600, Math.round(triangles * 0.55)));
  let result = welded.tri;
  let error = 0;
  for (const targetError of [0.004, 0.01, 0.02, 0.04]) {
    [result, error] = MeshoptSimplifier.simplify(welded.tri, welded.pos, 3, target * 3, targetError, []);
    if (result.length / 3 <= LIMITS.l1) break;
  }
  const kept = compact(welded.pos, result);
  const geometry = creaseNormals(kept.pos, kept.tri, 35);
  const kept3 = geometry.tri.length / 3;
  log.push(`L1 simplificado con meshoptimizer de ${triangles} a ${kept3} triángulos (ratio `
    + `${(kept3 / triangles).toFixed(2)}, error relativo ${error.toFixed(4)}), en una primitiva.`);
  return geometry;
}

function l2Groups(parts) {
  const groups = [];
  for (const cls of CLASSES) {
    const members = parts.filter(part => part.cls === cls);
    if (members.length === 0) continue;
    // Normals per part, with the part's crease angle, then merged.
    const pieces = members.map(part => creaseNormals(part.pos, part.tri, part.crease ?? 35));
    const vertexCount = pieces.reduce((sum, p) => sum + p.pos.length / 3, 0);
    const pos = new Float32Array(vertexCount * 3);
    const nor = new Float32Array(vertexCount * 3);
    const tri = new Uint32Array(pieces.reduce((sum, p) => sum + p.tri.length, 0));
    let v = 0;
    let t = 0;
    for (const piece of pieces) {
      pos.set(piece.pos, v * 3);
      nor.set(piece.nor, v * 3);
      for (let i = 0; i < piece.tri.length; i += 1) tri[t + i] = piece.tri[i] + v;
      v += piece.pos.length / 3;
      t += piece.tri.length;
    }
    groups.push([cls, { pos, nor, tri }]);
  }
  return groups;
}

function fileRecord(dir, name) {
  const buffer = fs.readFileSync(path.join(dir, name));
  return { file: name, bytes: buffer.length, sha256: sha256(buffer) };
}

// ── Notices ───────────────────────────────────────────────────────────────────────────────────────────────────────

const SEPARATOR = `\n\n${'-'.repeat(70)}\n\n`;

function licenceText(sources, base) {
  const texts = base.licenceFiles.map(file => sources.read(file).buffer
    .toString(/atr72/.test(file) ? 'latin1' : 'utf8').replace(/\r\n/g, '\n').trimEnd());
  return `${texts.join(SEPARATOR)}\n`;
}

// A source file's path inside its repository, and a link to a GitHub repository (or the text as it is).
const inRepo = entry => entry.path.split('/').slice(1).join('/');
const repoLink = name => (/^[\w.-]+\/[\w.-]+$/.test(name) ? `[${name}](https://github.com/${name})` : name);

function noticeText(icao, sources, base, recipe, log) {
  const spec = AIRCRAFT_TYPES[icao];
  const model = sources.entry(base.source);
  const name = recipe.name ?? base.describe;
  const licences = base.licenceFiles.map(file => `\`${inRepo(sources.entry(file))}\` de ${sources.entry(file).repo}`);
  const size = [spec.lengthM, spec.spanM, spec.heightM].map(fmt).join(' × ');
  const lines = [
    `# ${icao}: aviso de origen, licencia y cambios`,
    '',
    `Modelo 3D del ${icao} (${name}) para los mapas del OCC de ELEVANT (AVIAM). Es una obra derivada de un modelo `
      + `publicado con licencia ${base.licence} y se distribuye con la misma licencia: el texto completo está en `
      + '`LICENSE`.',
    recipe.base !== icao
      ? `Es un **hermano ajustado**: se construye a partir del modelo del ${base.describe} y no es un modelo propio `
        + `del ${icao}.`
      : `Se construye a partir del modelo del ${base.describe}.`,
    '',
    '## Origen',
    '',
    `- Archivo: \`${inRepo(model)}\` del repositorio ${repoLink(model.repo)} en el commit \`${model.commit}\`.`,
    `- URL fijada: ${model.url}`,
    `- SHA-256 del original: \`${model.sha256}\`.`,
    `- Autoría: ${base.credit}.`,
    `- Procedencia aguas arriba: ${repoLink(base.upstream)}.`,
    ...(base.upstreamNote ? [`- Nota: ${base.upstreamNote}.`] : []),
    `- Licencia: ${base.licence}, según ${licences.join(' y ')}.`,
    '',
    `## Cambios (${CHANGE_DATE}, ELEVANT / AVIAM)`,
    '',
    'Hechos con `frontend/private-web/scripts/models/build-aircraft-models.mjs`; las medidas de destino son las de '
      + `\`src/features/maps/aircraft/types.js\` (${size} m).`,
    '',
    ...log.map(item => `- ${item}`),
    '',
    '## Marcas',
    '',
    'Los nombres de fabricantes y de tipos de avión solo identifican el tipo representado. El modelo no lleva librea, '
      + 'logotipos ni marcas de ninguna aerolínea ni fabricante.',
    '',
  ];
  return lines.join('\n');
}

// What the map's «Créditos y licencias» shows for a type (ui/MapCreditsDialog.jsx): the model it derives from, its
// authors, the repository and commit it was taken from (with links), and where the model came from before that.
function creditOf(sources, base) {
  const model = sources.entry(base.source);
  const repoUrl = /^[\w.-]+\/[\w.-]+$/.test(model.repo) ? `https://github.com/${model.repo}` : null;
  return {
    baseName: base.describe,
    authors: base.credit,
    repository: model.repo,
    repositoryUrl: repoUrl,
    commit: model.commit,
    sourceUrl: repoUrl === null ? model.url : `${repoUrl}/blob/${model.commit}/${inRepo(model)}`,
    upstream: base.upstream,
    upstreamUrl: /^[\w.-]+\/[\w.-]+$/.test(base.upstream) ? `https://github.com/${base.upstream}` : null,
    ...(base.upstreamNote ? { note: base.upstreamNote } : {}),
  };
}

function sourceText(icao, sources, base) {
  const files = [base.source, ...base.licenceFiles, base.readme].filter(Boolean).map(file => sources.entry(file));
  return [
    `# ${icao}: cómo reconstruir este modelo`,
    '',
    'La forma preferida de modificar esta obra es el modelo original de su repositorio, más el script que la procesa. '
      + 'Los dos son públicos:',
    '',
    ...files.map(file => `- [\`${file.path}\`](${file.url}) (${file.bytes} bytes, SHA-256 \`${file.sha256}\`)`),
    '- `frontend/private-web/scripts/models/build-aircraft-models.mjs`, con `lib/` y `aircraft-sources.json` (en el '
      + 'repositorio de ELEVANT).',
    '',
    '## Pasos',
    '',
    '1. Descarga cada archivo de la lista anterior desde su URL a `<fuentes>/<ruta>` (la ruta de la lista).',
    '2. Desde `frontend/private-web`, instala las dependencias con `npm ci`.',
    `3. Ejecuta \`node scripts/models/build-aircraft-models.mjs <fuentes> --only ${icao}\`.`,
    '',
    'El script comprueba el SHA-256 de cada archivo antes de usarlo y escribe `l2.gltf`, `l2.bin`, `l1.gltf`, '
      + `\`l1.bin\`, \`LICENSE\`, \`NOTICE.md\` y este archivo en \`public/models/aircraft/${icao}/\`. El resultado es `
      + 'determinista: con las mismas fuentes salen los mismos bytes.',
    '',
  ].join('\n');
}

// ── Main ──────────────────────────────────────────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  const args = { sources: null, only: null, out: DEFAULT_OUT, inspect: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only') args.only = argv[++i].split(',').map(code => code.trim().toUpperCase()).filter(Boolean);
    else if (arg === '--out') args.out = path.resolve(argv[++i]);
    else if (arg === '--inspect') args.inspect = true;
    else if (!args.sources) args.sources = path.resolve(arg);
    else throw new Error(`unknown argument ${arg}`);
  }
  if (!args.sources) {
    throw new Error('usage: build-aircraft-models.mjs <sources-dir> [--only A320,B738] [--out dir] [--inspect]');
  }
  return args;
}

function inspect(icao, parts) {
  console.log(`== ${icao}: ${parts.length} parts, ${triangleCount(parts)} triangles`);
  for (const part of [...parts].sort((a, b) => a.name.localeCompare(b.name))) {
    const box = bounds([part]);
    const corner = values => `[${values.map(v => v.toFixed(1)).join(' ')}]`;
    console.log(`${part.name.padEnd(28).slice(0, 28)} ${part.cls.padEnd(5)} ${String(part.tri.length / 3).padStart(6)} `
      + `${corner(box.min)} ${corner(box.max)} ${part.material ?? ''} ${part.mesh && part.mesh !== part.name ? `(mesh ${part.mesh})` : ''}`);
  }
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const sources = loadSources(args.sources);
  const io = new NodeIO().registerExtensions(ALL_EXTENSIONS);
  await MeshoptSimplifier.ready;
  const codes = args.only ?? Object.keys(RECIPES);
  for (const code of codes) if (!RECIPES[code]) throw new Error(`${code}: no recipe`);

  const manifestFile = path.join(args.out, 'manifest.json');
  const previous = fs.existsSync(manifestFile) ? JSON.parse(fs.readFileSync(manifestFile, 'utf8')).types : {};
  const types = { ...previous };
  for (const icao of codes) {
    const recipe = RECIPES[icao];
    const base = BASES[recipe.base];
    const log = [];
    const raw = await loadBase(io, sources, recipe.base, log);
    const parts = cleanup(raw, base, log);
    if (args.inspect) {
      inspect(icao, parts);
      continue;
    }
    const { groundM } = processType(icao, parts, log);
    log.push('Normales recalculadas con el ángulo de pliegue de cada pieza; vértices soldados y cuantizados con '
      + 'KHR_mesh_quantization; materiales unificados en tres clases (cuerpo, vidrio, oscuro) de doble cara.');

    const dir = path.join(args.out, icao);
    fs.rmSync(dir, { recursive: true, force: true });
    fs.mkdirSync(dir, { recursive: true });
    const l2 = l2Groups(parts);
    const l2Triangles = l2.reduce((sum, [, g]) => sum + g.tri.length / 3, 0);
    if (l2Triangles > LIMITS.l2) throw new Error(`${icao}: L2 has ${l2Triangles} triangles (> ${LIMITS.l2})`);
    await writeLevel(io, path.join(dir, 'l2.gltf'), icao, base.licence, l2);
    const l1 = simplifyL1(parts, log);
    const l1Triangles = l1.tri.length / 3;
    if (l1Triangles > LIMITS.l1) throw new Error(`${icao}: L1 has ${l1Triangles} triangles (> ${LIMITS.l1})`);
    await writeLevel(io, path.join(dir, 'l1.gltf'), icao, base.licence, [['body', l1]]);

    fs.writeFileSync(path.join(dir, 'LICENSE'), licenceText(sources, base));
    fs.writeFileSync(path.join(dir, 'NOTICE.md'), noticeText(icao, sources, base, recipe, log));
    fs.writeFileSync(path.join(dir, 'SOURCE.md'), sourceText(icao, sources, base));

    const box = bounds(parts);
    const size = extent(box);
    types[icao] = {
      name: recipe.name ?? base.describe,
      proxy: recipe.base !== icao,
      base: recipe.base,
      licence: base.licence,
      hasGear: false,
      files: {
        l2: ['l2.gltf', 'l2.bin'].map(name => fileRecord(dir, name)),
        l1: ['l1.gltf', 'l1.bin'].map(name => fileRecord(dir, name)),
        notices: ['LICENSE', 'NOTICE.md', 'SOURCE.md'],
      },
      triangles: { l2: l2Triangles, l1: l1Triangles },
      dimensionsM: {
        length: round(size[1]), span: round(size[0]), height: round(box.max[2]), lowest: round(box.min[2]),
      },
      groundClearanceM: round(groundM),
      sources: [base.source, ...base.licenceFiles],
      credit: creditOf(sources, base),
      changes: log,
    };
    console.log(`${icao}: L2 ${l2Triangles} △, L1 ${l1Triangles} △, ${size.map(v => v.toFixed(2)).join(' × ')} m, `
      + `suelo ${groundM.toFixed(2)} m`);
  }
  if (args.inspect) return;

  const ordered = Object.fromEntries(Object.keys(types).sort().map(code => [code, types[code]]));
  const totalBytes = Object.values(ordered)
    .reduce((sum, t) => sum + [...t.files.l2, ...t.files.l1].reduce((s, f) => s + f.bytes, 0), 0);
  if (totalBytes > LIMITS.totalBytes) throw new Error(`models weigh ${totalBytes} bytes (> ${LIMITS.totalBytes})`);
  const manifest = {
    description: 'Modelos 3D de aviones de los mapas del OCC (M5). Generado por '
      + 'scripts/models/build-aircraft-models.mjs: no se edita a mano.',
    generator: GENERATOR,
    changeDate: CHANGE_DATE,
    frame: 'x a la derecha, y hacia la nariz, z arriba, metros; centrado en la envergadura y la longitud; suelo en '
      + 'z = 0 (sin tren: hasGear false)',
    format: 'glTF 2.0 (.gltf + .bin), KHR_mesh_quantization, sin texturas',
    levels: {
      l2: 'avión seguido, hasta 60 000 triángulos',
      l1: 'cercanos y estacionados, hasta 15 000 triángulos, una primitiva',
    },
    totalBytes,
    types: ordered,
  };
  fs.writeFileSync(manifestFile, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`total ${(totalBytes / 1024 / 1024).toFixed(2)} MB in ${Object.keys(ordered).length} types`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
