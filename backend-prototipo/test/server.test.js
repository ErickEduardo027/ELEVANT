import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createApp } from '../src/app.js';
import { resetSessionsForTests } from '../src/auth.js';
import { createJsonStore } from '../src/store.js';

async function startTestServer() {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'elevant-stage0-'));
  const seed = {
    schemaVersion: 1,
    createdAt: null,
    updatedAt: null,
    users: [
      {
        id: 'USR-ADMIN-OCC',
        email: 'admin@elevant.test',
        password: 'Elevant2026!',
        name: 'Laisha Ramírez',
        role: 'ADMIN_OCC',
        roleLabel: 'Administrador OCC',
        active: true,
      },
    ],
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
  assert.equal(persisted.users.length, 1);
  assert.equal(persisted.users[0].email, 'admin@elevant.test');
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

test('inicia, consulta y cierra una sesión departamental', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const loginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ADMIN@ELEVANT.TEST',
      password: 'Elevant2026!',
    }),
  });
  const login = await loginResponse.json();

  assert.equal(loginResponse.status, 200);
  assert.equal(login.user.role, 'ADMIN_OCC');
  assert.ok(login.token);
  assert.equal(login.user.password, undefined);

  const sessionResponse = await fetch(`${context.baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.equal(sessionResponse.status, 200);

  const logoutResponse = await fetch(`${context.baseUrl}/api/auth/logout`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.equal(logoutResponse.status, 200);

  const closedResponse = await fetch(`${context.baseUrl}/api/auth/session`, {
    headers: { Authorization: `Bearer ${login.token}` },
  });
  assert.equal(closedResponse.status, 401);
});

test('rechaza credenciales incorrectas', async t => {
  const context = await startTestServer();
  t.after(context.close);

  const response = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@elevant.test', password: 'incorrecta' }),
  });

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: 'Credenciales inválidas.' });
});

test('regenera datos cuando cambia la versión del esquema', async () => {
  const dataDirectory = await mkdtemp(path.join(os.tmpdir(), 'elevant-migration-'));
  await writeFile(path.join(dataDirectory, 'seed.json'), JSON.stringify({
    schemaVersion: 2,
    createdAt: null,
    updatedAt: null,
    users: [{ id: 'USR-NEW', email: 'nuevo@elevant.test' }],
    flights: [],
  }), 'utf8');
  await writeFile(path.join(dataDirectory, 'runtime.json'), JSON.stringify({
    schemaVersion: 1,
    createdAt: 'anterior',
    updatedAt: 'anterior',
    users: [],
    flights: [{ id: 'DATO-ANTERIOR' }],
  }), 'utf8');

  const store = createJsonStore({ dataDirectory });
  const state = await store.initialize();

  assert.equal(state.schemaVersion, 2);
  assert.equal(state.users[0].email, 'nuevo@elevant.test');
  assert.deepEqual(state.flights, []);
});
