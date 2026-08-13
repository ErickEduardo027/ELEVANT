import { copyFile, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const seedPath = resolve(root, 'data/seed.json');
export const runtimePath = resolve(root, process.env.PROTOTYPE_DATA_FILE || 'data/runtime.json');
let queue = Promise.resolve();

async function ensure() {
  await mkdir(dirname(runtimePath), { recursive: true });
  try { await readFile(runtimePath); } catch (error) {
    if (error.code !== 'ENOENT') throw error;
    await copyFile(seedPath, runtimePath);
  }
}

export async function readStore() {
  await ensure();
  return JSON.parse(await readFile(runtimePath, 'utf8'));
}

export function updateStore(mutator) {
  const run = queue.then(async () => {
    const data = await readStore();
    const result = await mutator(data);
    data.meta.updatedAt = new Date().toISOString();
    const temporary = `${runtimePath}.tmp`;
    await writeFile(temporary, `${JSON.stringify(data, null, 2)}\n`);
    await rename(temporary, runtimePath);
    return structuredClone(result);
  });
  queue = run.catch(() => {});
  return run;
}

export async function resetStore() {
  await copyFile(seedPath, runtimePath);
  return readStore();
}
