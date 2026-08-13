import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { createJsonStore } from '../src/store.js';

async function startTestServer() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'elevant-stage0-'));
  const seed = {
    schemaVersion: 1,
    createdAt: null,
    updatedAt: null,
    users: [],
    flights: [],
  };
  await writeFile(path.join(dataDirectory, 'seed.json'), JSON.stringify(seed), 'utf8');

  const store = createJsonStore({ dataDirectory });
  await store.initialize();
  const server = createApp({ store });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
    dataDirectory,
    store,
  };
}

test('health responde y crea el archivo persistente limpio', async t => {
  const context = await startTestServer();
  t.after(context.close);

  const response = await fetch(`${context.baseUrl}/health`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.status, 'ok');
  assert.equal(body.schemaVersion, 1);

  const persisted = JSON.parse(
    await readFile(path.join(context.dataDirectory, 'runtime.json'), 'utf8'),
  );
  assert.deepEqual(persisted.users, []);
  assert.deepEqual(persisted.flights, []);
});

test('las actualizaciones se conservan al crear una nueva instancia', async t => {
  const context = await startTestServer();
  t.after(context.close);

  await context.store.update(state => {
    state.flights.push({ id: 'FL-001', number: 'AV-101' });
  });

  const reloadedStore = createJsonStore({ dataDirectory: context.dataDirectory });
  const reloaded = await reloadedStore.initialize();

  assert.equal(reloaded.flights.length, 1);
  assert.equal(reloaded.flights[0].id, 'FL-001');
});

test('una ruta inexistente responde 404 en JSON', async t => {
  const context = await startTestServer();
  t.after(context.close);

  const response = await fetch(`${context.baseUrl}/ruta-inexistente`);
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'Ruta no encontrada.' });
});
