import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AIRCRAFT_TYPES } from '../../src/features/maps/aircraft/types.js';
import { BASES, RECIPES } from './lib/recipes.mjs';

// The vendored models of plan M5 (public/models/aircraft), as scripts/models/build-aircraft-models.mjs writes them:
// what the production CSP and the lazy three chunk can load (glTF 2.0 with an external .bin, KHR_mesh_quantization
// only, no textures, no data URIs, no GLB), within the budgets, at the dimensions of types.js, with their notices.
const HERE = path.dirname(fileURLToPath(import.meta.url));
const MODELS = path.resolve(HERE, '../../public/models/aircraft');
const manifest = JSON.parse(fs.readFileSync(path.join(MODELS, 'manifest.json'), 'utf8'));
const sources = JSON.parse(fs.readFileSync(path.join(HERE, 'aircraft-sources.json'), 'utf8'));
const sha256 = file => createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const readGltf = (icao, level) => JSON.parse(fs.readFileSync(path.join(MODELS, icao, `${level}.gltf`), 'utf8'));
const triangles = gltf => gltf.meshes.flatMap(m => m.primitives)
  .reduce((sum, p) => sum + gltf.accessors[p.indices].count / 3, 0);

describe('vendored aircraft models (M5)', () => {
  it('builds every recipe type, one row of types.js each, and keeps the 767 procedural', () => {
    expect(Object.keys(manifest.types).sort()).toEqual(Object.keys(RECIPES).sort());
    for (const icao of Object.keys(RECIPES)) expect(AIRCRAFT_TYPES[icao], icao).toBeDefined();
    expect(RECIPES.B763).toBeUndefined();
    expect(Object.keys(RECIPES)).toHaveLength(22);
  });

  it('pins every source file to a commit and a SHA-256', () => {
    const paths = new Set(sources.files.map(file => file.path));
    for (const file of sources.files) {
      expect(file.sha256, file.path).toMatch(/^[0-9a-f]{64}$/);
      expect(file.url, file.path).toContain(`/${file.commit}/`);
      expect(file.commit, file.path).toMatch(/^[0-9a-f]{40}$/);
    }
    for (const base of Object.values(BASES)) {
      for (const file of [base.source, ...base.licenceFiles, base.readme]) expect(paths.has(file), file).toBe(true);
    }
  });

  it('writes plain glTF 2.0 with quantized meshes, no textures and an external buffer', () => {
    for (const [icao, entry] of Object.entries(manifest.types)) {
      const dir = path.join(MODELS, icao);
      expect(fs.readdirSync(dir).sort(), icao)
        .toEqual(['LICENSE', 'NOTICE.md', 'SOURCE.md', 'l1.bin', 'l1.gltf', 'l2.bin', 'l2.gltf']);
      for (const level of ['l1', 'l2']) {
        const gltf = readGltf(icao, level);
        expect(gltf.asset.version, icao).toBe('2.0');
        expect(gltf.extensionsUsed ?? [], icao).toEqual(['KHR_mesh_quantization']);
        expect(gltf.extensionsRequired ?? [], icao).toEqual(['KHR_mesh_quantization']);
        for (const key of ['images', 'textures', 'samplers']) expect(gltf[key], `${icao} ${key}`).toBeUndefined();
        expect(gltf.buffers, icao).toEqual([expect.objectContaining({ uri: `${level}.bin` })]);
        for (const p of gltf.meshes.flatMap(m => m.primitives)) {
          expect(Object.keys(p.attributes).sort(), icao).toEqual(['NORMAL', 'POSITION']);
        }
        for (const file of entry.files[level]) {
          expect(sha256(path.join(dir, file.file)), `${icao} ${file.file}`).toBe(file.sha256);
          expect(fs.statSync(path.join(dir, file.file)).size).toBe(file.bytes);
        }
      }
    }
  });

  it('keeps the triangle budgets, one primitive in L1 and the total weight', () => {
    for (const [icao, entry] of Object.entries(manifest.types)) {
      const l2 = readGltf(icao, 'l2');
      const l1 = readGltf(icao, 'l1');
      expect(triangles(l2), icao).toBe(entry.triangles.l2);
      expect(triangles(l1), icao).toBe(entry.triangles.l1);
      expect(entry.triangles.l2, icao).toBeLessThanOrEqual(60000);
      expect(entry.triangles.l1, icao).toBeLessThanOrEqual(15000);
      expect(entry.triangles.l1, icao).toBeGreaterThanOrEqual(Math.ceil(entry.triangles.l2 * 0.2) - 1);
      expect(l1.meshes.flatMap(m => m.primitives), icao).toHaveLength(1);
    }
    expect(manifest.totalBytes).toBeLessThanOrEqual(25 * 1024 * 1024);
  });

  it('matches the dimensions of types.js and stands above the ground with no gear', () => {
    for (const [icao, entry] of Object.entries(manifest.types)) {
      const spec = AIRCRAFT_TYPES[icao];
      expect(entry.hasGear, icao).toBe(false);
      expect(Math.abs(entry.dimensionsM.length / spec.lengthM - 1), icao).toBeLessThan(0.005);
      expect(Math.abs(entry.dimensionsM.span / spec.spanM - 1), icao).toBeLessThan(0.015);
      expect(Math.abs(entry.dimensionsM.height / spec.heightM - 1), icao).toBeLessThan(0.15);
      expect(entry.dimensionsM.lowest, icao).toBeGreaterThanOrEqual(0.3);
      expect(entry.proxy, icao).toBe(RECIPES[icao].base !== icao);
    }
  });

  it('ships each model with its licence, its origin and changes, and how to rebuild it', () => {
    for (const [icao, entry] of Object.entries(manifest.types)) {
      const dir = path.join(MODELS, icao);
      const licence = fs.readFileSync(path.join(dir, 'LICENSE'), 'utf8');
      const notice = fs.readFileSync(path.join(dir, 'NOTICE.md'), 'utf8');
      const source = fs.readFileSync(path.join(dir, 'SOURCE.md'), 'utf8');
      const version = entry.licence === 'GPL-3.0-only' ? /Version 3, 29 June 2007/ : /Version 2, June 1991/;
      expect(licence, icao).toMatch(version);
      expect(notice, icao).toContain(`## Cambios (${manifest.changeDate}`);
      expect(notice, icao).toContain(entry.licence);
      expect(source, icao).toContain(`build-aircraft-models.mjs <fuentes> --only ${icao}`);
      for (const file of entry.sources) expect(source, `${icao} ${file}`).toContain(file);
    }
    // The ATR keeps its GPL-3.0 apart; the CRJ900 and the 757 are «version 2 or later».
    expect(manifest.types.AT76.licence).toBe('GPL-3.0-only');
    expect([manifest.types.CRJ9.licence, manifest.types.B752.licence])
      .toEqual(['GPL-2.0-or-later', 'GPL-2.0-or-later']);
    expect(manifest.types.B39M.licence).toBe('GPL-2.0-only');
  });

  it('credits each model for the map dialog: base, authors, the pinned repository and commit, and its upstream', () => {
    const bySource = new Map(sources.files.map(file => [file.path, file]));
    for (const [icao, entry] of Object.entries(manifest.types)) {
      const base = BASES[entry.base];
      const model = bySource.get(entry.sources[0]);
      const { credit } = entry;
      expect(credit.baseName, icao).toBe(base.describe);
      expect(credit.authors, icao).toBe(base.credit);
      expect([credit.repository, credit.commit], icao).toEqual([model.repo, model.commit]);
      expect(credit.repositoryUrl, icao).toBe(`https://github.com/${model.repo}`);
      expect(credit.sourceUrl.startsWith(`https://github.com/${model.repo}/blob/${model.commit}/`), icao).toBe(true);
      expect(credit.upstream, icao).toBe(base.upstream);
    }
    expect(manifest.types.B738.credit.upstreamUrl).toBe('https://github.com/FGMEMBERS/737-800');
    expect(manifest.types.B39M.credit.authors).toContain('Original model by omri_ha_muglob');
    expect(manifest.types.AT76.credit.upstreamUrl).toBeNull();
    expect(manifest.types.B77W.credit.note).toContain('GPLv2');
  });
});
