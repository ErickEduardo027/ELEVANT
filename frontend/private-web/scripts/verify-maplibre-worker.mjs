import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = fileURLToPath(new URL('..', import.meta.url));
const assetsRoot = path.join(projectRoot, 'dist', 'assets');
const files = await readdir(assetsRoot);
const workers = files.filter(name => /^maplibre-gl-worker-[\w-]+\.js$/.test(name));
const mainBundles = files.filter(name => /^main-[\w-]+\.js$/.test(name));

assert.equal(workers.length, 1, 'The MapLibre worker must be emitted exactly once');
assert.equal(mainBundles.length, 1, 'The AVIAM application bundle must be emitted exactly once');

const mainBundle = await readFile(path.join(assetsRoot, mainBundles[0]), 'utf8');
assert.ok(
  mainBundle.includes(workers[0]),
  'The AVIAM application must reference its emitted MapLibre worker',
);

console.log(`PRIVATE_WEB_MAPLIBRE_WORKER_OK asset=${workers[0]}`);
