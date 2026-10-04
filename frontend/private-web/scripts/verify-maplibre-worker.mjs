import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputRoot = path.resolve(fileURLToPath(new URL('../out/_next/static/', import.meta.url)));
const files = [];

async function visit(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) await visit(file);
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(file);
  }
}

await visit(outputRoot);
const workers = files.filter(file => /maplibre-gl-worker.*\.(?:js|mjs)$/.test(path.basename(file)));
assert.equal(workers.length, 1, 'The Next.js export must emit exactly one MapLibre worker asset');

const chunks = files.filter(file => !workers.includes(file));
const workerName = path.basename(workers[0]);
let referenced = false;
for (const chunk of chunks) {
  if ((await readFile(chunk, 'utf8')).includes(workerName)) {
    referenced = true;
    break;
  }
}
assert.ok(referenced, `The exported application must reference its emitted worker (${workerName})`);

console.log(`PRIVATE_WEB_MAPLIBRE_WORKER_OK asset=${workerName}`);
