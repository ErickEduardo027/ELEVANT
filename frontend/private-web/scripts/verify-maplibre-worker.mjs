import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { findUncopiedWorkerImports } from './copy-maplibre-worker.mjs';

const projectRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const assetRoot = path.join(projectRoot, 'public/assets/maplibre');
const packageRoot = path.join(projectRoot, 'node_modules/maplibre-gl/dist');
const assetNames = ['maplibre-gl-worker.mjs', 'maplibre-gl-shared.mjs'];

for (const name of assetNames) {
  const copied = await readFile(path.join(assetRoot, name));
  const installed = await readFile(path.join(packageRoot, name));
  assert.deepEqual(copied, installed, `MapLibre ${name} must match the locked package`);
}

const worker = await readFile(path.join(assetRoot, assetNames[0]), 'utf8');
const uncopiedImports = findUncopiedWorkerImports(worker);
assert.equal(
  uncopiedImports.length,
  0,
  `The MapLibre worker imports modules that are not copied next to it: ${uncopiedImports.join(', ')}`,
);

const chunks = [];
async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(?:js|mjs)$/.test(entry.name)) chunks.push(file);
  }
}

await visit(path.join(projectRoot, '.next/static'));
const sources = await Promise.all(chunks.map(chunk => readFile(chunk, 'utf8')));
assert.ok(
  sources.some(source => source.includes('/assets/maplibre/maplibre-gl-worker.mjs')),
  'The Next.js bundle must configure the served MapLibre worker URL',
);

console.log('PRIVATE_WEB_MAPLIBRE_WORKER_OK assets=2');
