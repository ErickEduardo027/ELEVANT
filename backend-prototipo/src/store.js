import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

function clone(value) {
  return structuredClone(value);
}

export function createJsonStore({ dataDirectory }) {
  const seedPath = path.join(dataDirectory, 'seed.json');
  const runtimePath = path.join(dataDirectory, 'runtime.json');
  let writeQueue = Promise.resolve();

  async function readJson(filePath) {
    return JSON.parse(await readFile(filePath, 'utf8'));
  }

  async function initialize() {
    await mkdir(dataDirectory, { recursive: true });
    const seed = await readJson(seedPath);

    try {
      const runtime = await readJson(runtimePath);
      if (runtime.schemaVersion === seed.schemaVersion) return runtime;
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }

    const now = new Date().toISOString();
    const initialState = {
      ...clone(seed),
      createdAt: now,
      updatedAt: now,
    };

    await persist(initialState);
    return initialState;
  }

  async function persist(state) {
    const temporaryPath = `${runtimePath}.${process.pid}.tmp`;
    await writeFile(temporaryPath, `${JSON.stringify(state, null, 2)}\n`, 'utf8');
    await rename(temporaryPath, runtimePath);
  }

  async function read() {
    try {
      return await readJson(runtimePath);
    } catch (error) {
      if (error.code === 'ENOENT') return initialize();
      throw error;
    }
  }

  async function update(mutator) {
    const operation = writeQueue.then(async () => {
      const current = await read();
      const draft = clone(current);
      const result = await mutator(draft);
      draft.updatedAt = new Date().toISOString();
      await persist(draft);
      return result ?? draft;
    });

    writeQueue = operation.catch(() => undefined);
    return operation;
  }

  return { initialize, read, update, runtimePath };
}
