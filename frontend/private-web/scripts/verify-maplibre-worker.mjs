import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const outputRoot = path.resolve(fileURLToPath(new URL('../.next/static/', import.meta.url)));
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
assert.ok(workers.length > 0, 'The Next.js build must emit a MapLibre worker asset');

const chunks = files.filter(file => !workers.includes(file));
const chunkSources = await Promise.all(chunks.map(chunk => readFile(chunk, 'utf8')));
for (const worker of workers) {
  const workerName = path.basename(worker);
  const referenced = chunkSources.some(source => source.includes(workerName));
  assert.ok(referenced, `The application must reference its emitted worker (${workerName})`);
  }

console.log(`PRIVATE_WEB_MAPLIBRE_WORKER_OK assets=${workers.length}`);
