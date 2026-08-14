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
      {
        id: 'USR-CONTRATOS',
        email: 'contratos@elevant.test',
        password: 'Elevant2026!',
        name: 'Marcos Silva',
        role: 'CONTRATOS',
        roleLabel: 'Contratos',
        active: true,
      },
      {
        id: 'USR-GESTION-HUMANA',
        email: 'gestionhumana@elevant.test',
        password: 'Elevant2026!',
        name: 'Camila Reyes',
        role: 'GESTION_HUMANA',
        roleLabel: 'Gestión Humana',
        active: true,
      },
      {
        id: 'USR-FINANZAS',
        email: 'finanzas@elevant.test',
        password: 'Elevant2026!',
        name: 'Elena Rojas',
        role: 'FINANZAS',
        roleLabel: 'Finanzas',
        active: true,
      },
    ],
    flights: [],
    personnel: [],
    audit: [],
    serviceRequests: [],
    contracts: [],
    contractServices: [],
    assignments: [],
    operations: [],
    incidents: [],
    syncReceipts: [],
    preinvoices: [],
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
  assert.equal(persisted.users.length, 4);
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

test('Gestión Humana crea, desactiva y reactiva el acceso móvil de un agente', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const hrLoginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'gestionhumana@elevant.test',
      password: 'Elevant2026!',
    }),
  });
  const hrLogin = await hrLoginResponse.json();
  assert.equal(hrLoginResponse.status, 200);

  const createResponse = await fetch(`${context.baseUrl}/api/hr/users`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${hrLogin.token}`,
    },
    body: JSON.stringify({
      identity: {
        firstName: 'Ana',
        lastName: 'Pérez',
        email: 'ana.perez@elevant.test',
        phone: '809-555-0101',
        identificationType: 'Cédula',
        identificationNumber: '001-0000000-1',
      },
      access: { roleId: 'role-agente-rampa' },
      userType: 'ramp_agent',
      rampAgent: {
        employeeNumber: 'AVIAM-001',
        terminals: ['PUJ'],
        category: 'Agente de Rampa',
        hireDate: '2026-08-13',
        supervisorName: 'Camila Reyes',
      },
    }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(created.identity.email, 'ana.perez@elevant.test');
  assert.equal(created.account.status, 'active');

  const mobileLogin = async () => fetch(`${context.baseUrl}/api/mobile/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      email: 'ana.perez@elevant.test',
      password: 'Elevant2026!',
    }),
  });

  const firstMobileLogin = await mobileLogin();
  assert.equal(firstMobileLogin.status, 200);
  assert.equal((await firstMobileLogin.json()).user.role, 'AGENTE_RAMPA');

  const deactivateResponse = await fetch(
    `${context.baseUrl}/api/hr/users/${created.identity.id}/deactivate`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${hrLogin.token}`,
      },
      body: JSON.stringify({ reason: 'Prueba de desactivación' }),
    },
  );
  assert.equal(deactivateResponse.status, 200);
  assert.equal((await deactivateResponse.json()).account.status, 'disabled');
  assert.equal((await mobileLogin()).status, 401);

  const activateResponse = await fetch(
    `${context.baseUrl}/api/hr/users/${created.identity.id}/activate`,
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${hrLogin.token}` },
    },
  );
  assert.equal(activateResponse.status, 200);
  assert.equal((await activateResponse.json()).account.status, 'active');
  assert.equal((await mobileLogin()).status, 200);
});

test('una solicitud pública llega a Contratos y puede resolverse', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const createResponse = await fetch(`${context.baseUrl}/api/public/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      airline: 'Aerolínea de Prueba',
      contactName: 'Ana Pérez',
      contactEmail: 'ana@aerolinea.test',
      type: 'affiliation',
      requestedService: 'Afiliación y servicios de rampa en PUJ.',
    }),
  });
  const created = await createResponse.json();
  assert.equal(createResponse.status, 201);
  assert.equal(created.status, 'pending');

  const loginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'contratos@elevant.test', password: 'Elevant2026!' }),
  });
  const login = await loginResponse.json();
  const authorization = { Authorization: `Bearer ${login.token}` };

  const listResponse = await fetch(`${context.baseUrl}/api/contracts/requests`, { headers: authorization });
  assert.equal(listResponse.status, 200);
  assert.equal((await listResponse.json())[0].id, created.id);

  const reviewResponse = await fetch(`${context.baseUrl}/api/contracts/requests/${created.id}/review`, {
    method: 'POST', headers: authorization,
  });
  assert.equal((await reviewResponse.json()).status, 'inReview');

  const resolveResponse = await fetch(`${context.baseUrl}/api/contracts/requests/${created.id}/resolve`, {
    method: 'POST',
    headers: { ...authorization, 'Content-Type': 'application/json' },
    body: JSON.stringify({ status: 'approved', decisionNote: 'Solicitud aprobada para elaborar contrato.' }),
  });
  const resolved = await resolveResponse.json();
  assert.equal(resolveResponse.status, 200);
  assert.equal(resolved.status, 'approved');
  assert.equal(resolved.decisionNote, 'Solicitud aprobada para elaborar contrato.');

  const trackingResponse = await fetch(
    `${context.baseUrl}/api/public/service-requests?contactEmail=${encodeURIComponent('ana@aerolinea.test')}`,
  );
  const tracked = await trackingResponse.json();
  assert.equal(trackingResponse.status, 200);
  assert.equal(tracked.length, 1);
  assert.equal(tracked[0].id, created.id);
  assert.equal(tracked[0].status, 'approved');
  assert.equal(tracked[0].decisionNote, 'Solicitud aprobada para elaborar contrato.');
  assert.ok(tracked[0].updatedAt);

  const lateCancellation = await fetch(`${context.baseUrl}/api/public/service-requests/${created.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactEmail: 'ana@aerolinea.test', reason: 'Ya no se requiere.' }),
  });
  assert.equal(lateCancellation.status, 409);
});

test('la aerolínea puede cancelar una solicitud pendiente propia', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const createResponse = await fetch(`${context.baseUrl}/api/public/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      airline: 'Aerolínea Portal', contactName: 'María López', contactEmail: 'maria@portal.test',
      type: 'additionalService', requestedService: 'Escalera adicional',
    }),
  });
  const created = await createResponse.json();
  const cancelResponse = await fetch(`${context.baseUrl}/api/public/service-requests/${created.id}/cancel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ contactEmail: 'maria@portal.test', reason: 'Cambio operacional.' }),
  });
  const cancelled = await cancelResponse.json();
  assert.equal(cancelResponse.status, 200);
  assert.equal(cancelled.status, 'cancelled');
  assert.equal(cancelled.cancellationReason, 'Cambio operacional.');

  const otherUserResponse = await fetch(
    `${context.baseUrl}/api/public/service-requests?contactEmail=${encodeURIComponent('otro@portal.test')}`,
  );
  assert.deepEqual(await otherUserResponse.json(), []);
});

test('Contratos convierte una solicitud aprobada en contrato y servicios pactados persistentes', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const requestResponse = await fetch(`${context.baseUrl}/api/public/service-requests`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      airline: 'Aerolínea Integrada', contactName: 'Ana Pérez', contactEmail: 'ana@integrada.test',
      type: 'affiliation', requestedService: 'Servicios de rampa permanentes.',
      details: { iataCode: 'AI' },
    }),
  });
  const request = await requestResponse.json();
  const loginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'contratos@elevant.test', password: 'Elevant2026!' }),
  });
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json' };

  await fetch(`${context.baseUrl}/api/contracts/requests/${request.id}/resolve`, {
    method: 'POST', headers,
    body: JSON.stringify({ status: 'approved', decisionNote: 'Aprobada para contratación.' }),
  });
  const contractResponse = await fetch(`${context.baseUrl}/api/contracts/contracts`, {
    method: 'POST', headers,
    body: JSON.stringify({
      requestId: request.id, airline: request.airline, airlineCode: 'AI', contractType: 'permanent',
      startDate: '2026-08-13', conditions: 'Atención permanente en la estación PUJ.',
    }),
  });
  const contract = await contractResponse.json();
  assert.equal(contractResponse.status, 201);
  assert.equal(contract.contractType, 'permanent');
  assert.equal(contract.endDate, null);

  const serviceResponse = await fetch(`${context.baseUrl}/api/contracts/services`, {
    method: 'POST', headers,
    body: JSON.stringify({
      contractId: contract.id, name: 'Puente de abordaje', rate: 485,
      currency: 'USD', billingUnit: 'Por operación', startDate: '2026-08-13',
    }),
  });
  const service = await serviceResponse.json();
  assert.equal(serviceResponse.status, 201);
  assert.equal(service.contractId, contract.id);
  assert.equal(service.endDate, null);

  const contractsResponse = await fetch(`${context.baseUrl}/api/contracts/contracts`, { headers });
  assert.equal((await contractsResponse.json())[0].servicesCount, 1);
  const persisted = await context.store.read();
  assert.equal(persisted.serviceRequests[0].contractId, contract.id);
  assert.equal(persisted.contractServices[0].rate, 485);
});

test('OCC registra un vuelo contratado, asigna un agente habilitado y lo publica en su móvil', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);
  const login = async (email, route = '/api/auth/login') => {
    const response = await fetch(`${context.baseUrl}${route}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Elevant2026!' }),
    });
    assert.equal(response.status, 200);
    return response.json();
  };

  const hr = await login('gestionhumana@elevant.test');
  const agentResponse = await fetch(`${context.baseUrl}/api/hr/users`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${hr.token}` },
    body: JSON.stringify({
      identity: { firstName: 'Ana', lastName: 'Pérez', email: 'ana.occ@elevant.test', phone: '809-555-0101', identificationType: 'Cédula', identificationNumber: '001-1' },
      access: { roleId: 'role-agente-rampa' }, userType: 'ramp_agent',
      rampAgent: { employeeNumber: 'AVIAM-002', terminals: ['PUJ'], category: 'Agente de Rampa', hireDate: '2026-08-13', supervisorName: 'Camila Reyes' },
    }),
  });
  const agent = await agentResponse.json();
  const hrHeaders = { 'Content-Type': 'application/json', Authorization: `Bearer ${hr.token}` };

  const qualificationResponse = await fetch(`${context.baseUrl}/api/hr/qualifications`, {
    method: 'POST', headers: hrHeaders,
    body: JSON.stringify({
      agentId: agent.identity.id, equipmentId: 'bridge', trainingDate: '2026-08-01',
      obtainedAt: '2026-08-01', expiresAt: '2027-08-01',
      certifyingEntity: 'AVIAM', instructor: 'Camila Reyes',
    }),
  });
  assert.equal(qualificationResponse.status, 201);

  for (const [type, number] of [['carnet', 'CARN-002'], ['licencia', 'LIC-002']]) {
    const permitResponse = await fetch(`${context.baseUrl}/api/hr/permits/${agent.identity.id}-${type}/renew`, {
      method: 'POST', headers: hrHeaders,
      body: JSON.stringify({ number, issuedAt: '2026-08-01', expiresAt: '2027-08-01' }),
    });
    assert.equal(permitResponse.status, 200);
  }

  const shiftResponse = await fetch(`${context.baseUrl}/api/hr/schedules/shifts`, {
    method: 'POST', headers: hrHeaders,
    body: JSON.stringify({
      agentId: agent.identity.id, date: '2026-08-13', startTime: '14:00',
      endTime: '22:00', terminal: 'A', positionId: 'bridge',
    }),
  });
  assert.equal(shiftResponse.status, 200);

  const contractsLogin = await login('contratos@elevant.test');
  await context.store.update(state => state.serviceRequests.unshift({ id: 'SOL-OCC', airline: 'Aerolínea Integrada', status: 'approved', contractId: null }));
  const contractResponse = await fetch(`${context.baseUrl}/api/contracts/contracts`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${contractsLogin.token}` },
    body: JSON.stringify({ requestId: 'SOL-OCC', airline: 'Aerolínea Integrada', airlineCode: 'AI', contractType: 'temporary', startDate: '2026-08-01', endDate: '2027-08-01', conditions: 'Servicios en PUJ.' }),
  });
  const contract = await contractResponse.json();
  const serviceResponse = await fetch(`${context.baseUrl}/api/contracts/services`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${contractsLogin.token}` },
    body: JSON.stringify({ contractId: contract.id, name: 'Puente de abordaje', rate: 485, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-08-01', endDate: '2027-08-01' }),
  });
  const service = await serviceResponse.json();

  const occ = await login('admin@elevant.test');
  const flightResponse = await fetch(`${context.baseUrl}/api/occ/flights`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${occ.token}` },
    body: JSON.stringify({ contractId: contract.id, flightNumber: 'AI101', origin: 'MIA', destination: 'PUJ', scheduledTime: '2026-08-13T14:30:00-04:00', aircraftType: 'A320', position: 'B12' }),
  });
  const flight = await flightResponse.json();
  assert.equal(flightResponse.status, 201);
  const assignmentResponse = await fetch(`${context.baseUrl}/api/occ/flights/${flight.id}/assign`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${occ.token}` },
    body: JSON.stringify({ agentId: agent.identity.id, serviceIds: [service.id], position: 'B12' }),
  });
  assert.equal(assignmentResponse.status, 200);
  assert.deepEqual((await assignmentResponse.json()).services, ['Puente de abordaje']);

  const mobile = await login('ana.occ@elevant.test', '/api/mobile/auth/login');
  assert.equal(mobile.user.personnelId, agent.identity.id);
  const mobileResponse = await fetch(`${context.baseUrl}/api/mobile/flights`, { headers: { Authorization: `Bearer ${mobile.token}` } });
  const mobileFlights = await mobileResponse.json();
  assert.equal(mobileResponse.status, 200);
  assert.equal(mobileFlights.length, 1);
  assert.equal(mobileFlights[0].id, flight.id);

  const syncResponse = await fetch(`${context.baseUrl}/api/mobile/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mobile.token}` },
    body: JSON.stringify({ items: [
      { idempotencyKey: 'SYNC-END', type: 'operación', createdAt: '2026-08-13T15:30:00-04:00', payload: { flightId: flight.id, startedAt: '2026-08-13T14:31:00-04:00', endedAt: '2026-08-13T15:30:00-04:00' } },
      { idempotencyKey: 'SYNC-CHECKLIST', type: 'checklist', createdAt: '2026-08-13T15:29:00-04:00', payload: { flightId: flight.id, answers: { exterior: 'OK', escalera: 'NA' }, completedAt: '2026-08-13T15:29:00-04:00' } },
      { idempotencyKey: 'SYNC-START', type: 'operación', createdAt: '2026-08-13T14:31:00-04:00', payload: { flightId: flight.id, startedAt: '2026-08-13T14:31:00-04:00' } },
      { idempotencyKey: 'SYNC-INCIDENT', type: 'incidencia', createdAt: '2026-08-13T14:45:00-04:00', payload: { flightId: flight.id, type: 'Equipo', impact: 'Alto', description: 'Daño detectado durante la operación.' } },
      { idempotencyKey: 'SYNC-CHAT', type: 'chat', createdAt: '2026-08-13T14:46:00-04:00', payload: { text: 'OCC, necesito apoyo en la posición B12.' } },
    ] }),
  });
  const sync = await syncResponse.json();
  assert.equal(syncResponse.status, 200);
  assert.equal(sync.count, 5);

  const conversationsResponse = await fetch(`${context.baseUrl}/api/occ/chat/conversations`, { headers: { Authorization: `Bearer ${occ.token}` } });
  const conversations = await conversationsResponse.json();
  assert.equal(conversationsResponse.status, 200);
  assert.equal(conversations.conversations.length, 1);
  assert.equal(conversations.conversations[0].lastMessage, 'OCC, necesito apoyo en la posición B12.');
  assert.equal(conversations.conversations[0].unreadCount, 1);

  const conversationId = conversations.conversations[0].id;
  const occReplyResponse = await fetch(`${context.baseUrl}/api/occ/chat/conversations/${conversationId}/messages`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${occ.token}` },
    body: JSON.stringify({ content: 'Recibido, enviaremos apoyo a la posición.' }),
  });
  assert.equal(occReplyResponse.status, 201);

  const mobileChatResponse = await fetch(`${context.baseUrl}/api/mobile/chat`, { headers: { Authorization: `Bearer ${mobile.token}` } });
  const mobileChat = await mobileChatResponse.json();
  assert.equal(mobileChatResponse.status, 200);
  assert.equal(mobileChat.messages.length, 2);
  assert.equal(mobileChat.messages[0].clientId, 'SYNC-CHAT');
  assert.equal(mobileChat.messages[1].content, 'Recibido, enviaremos apoyo a la posición.');

  const reviewQueueResponse = await fetch(`${context.baseUrl}/api/occ/reviews`, { headers: { Authorization: `Bearer ${occ.token}` } });
  const reviewQueue = await reviewQueueResponse.json();
  assert.equal(reviewQueueResponse.status, 200);
  assert.equal(reviewQueue.operations.length, 1);
  assert.equal(reviewQueue.operations[0].flight.number, 'AI101');
  assert.equal(reviewQueue.operations[0].status, 'PENDING_REVIEW');
  assert.equal(reviewQueue.operations[0].incidents.length, 1);

  const approveResponse = await fetch(`${context.baseUrl}/api/occ/reviews/${reviewQueue.operations[0].id}/approve`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${occ.token}` }, body: JSON.stringify({ comment: 'Operación validada.' }),
  });
  assert.equal(approveResponse.status, 200);
  assert.equal((await approveResponse.json()).status, 'APPROVED');

  const finance = await login('finanzas@elevant.test');
  const approvedServicesResponse = await fetch(`${context.baseUrl}/api/finance/approved-services`, { headers: { Authorization: `Bearer ${finance.token}` } });
  const approvedServices = await approvedServicesResponse.json();
  assert.equal(approvedServicesResponse.status, 200);
  assert.equal(approvedServices.length, 1);
  assert.equal(approvedServices[0].flight, 'AI101');

  const preinvoiceResponse = await fetch(`${context.baseUrl}/api/finance/preinvoices`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${finance.token}` },
    body: JSON.stringify({ airline: 'Aerolínea Integrada', period: 'Agosto 2026' }),
  });
  const preinvoice = await preinvoiceResponse.json();
  assert.equal(preinvoiceResponse.status, 201);
  assert.equal(preinvoice.services, 1);
  assert.equal(preinvoice.total, 485);

  const approvePreinvoiceResponse = await fetch(`${context.baseUrl}/api/finance/preinvoices/${preinvoice.id}/approve`, { method: 'POST', headers: { Authorization: `Bearer ${finance.token}` } });
  assert.equal(approvePreinvoiceResponse.status, 200);
  const sendPreinvoiceResponse = await fetch(`${context.baseUrl}/api/finance/preinvoices/${preinvoice.id}/send`, { method: 'POST', headers: { Authorization: `Bearer ${finance.token}` } });
  assert.equal(sendPreinvoiceResponse.status, 200);
  assert.equal((await sendPreinvoiceResponse.json()).status, 'sent');

  const duplicateSyncResponse = await fetch(`${context.baseUrl}/api/mobile/sync`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${mobile.token}` },
    body: JSON.stringify({ items: [{ idempotencyKey: 'SYNC-INCIDENT', type: 'incidencia', createdAt: '2026-08-13T14:45:00-04:00', payload: { flightId: flight.id } }] }),
  });
  assert.equal((await duplicateSyncResponse.json()).count, 0);
});

test('OCC muestra y acepta contratos activos próximos a vencer', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  await context.store.update(state => {
    state.contracts.push({
      id: 'CTR-2026-001', requestId: 'SOL-AVIAM', airline: 'Aviam', airlineCode: '232',
      contractType: 'temporary', startDate: '2026-08-01', endDate: '2026-08-16',
      conditions: 'Todo', statusOverride: null, createdAt: new Date().toISOString(),
    });
    state.contractServices.push({
      id: 'SRV-AVIAM', contractId: 'CTR-2026-001', airline: 'Aviam', name: 'Catering',
      rate: 25, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-08-01',
      endDate: '2026-08-16', active: true, createdAt: new Date().toISOString(),
    });
  });

  const loginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@elevant.test', password: 'Elevant2026!' }),
  });
  const session = await loginResponse.json();
  const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${session.token}` };

  const optionsResponse = await fetch(`${context.baseUrl}/api/occ/planning/options`, { headers });
  const options = await optionsResponse.json();
  assert.equal(optionsResponse.status, 200);
  assert.equal(options.contracts[0].id, 'CTR-2026-001');
  assert.equal(options.contracts[0].status, 'expiring');

  const flightResponse = await fetch(`${context.baseUrl}/api/occ/flights`, {
    method: 'POST', headers,
    body: JSON.stringify({
      contractId: 'CTR-2026-001', flightNumber: 'AV232', origin: 'MIA', destination: 'PUJ',
      scheduledTime: '2026-08-14T10:30:00-04:00', aircraftType: 'A320', position: 'A04',
    }),
  });
  assert.equal(flightResponse.status, 201);
  assert.equal((await flightResponse.json()).contractId, 'CTR-2026-001');
});

test('una solicitud pública genera una notificación persistente para Contratos', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  const requestResponse = await fetch(`${context.baseUrl}/api/public/service-requests`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      airline: 'Aerolínea Prueba', contactName: 'Ana Cliente',
      contactEmail: 'ana@aerolinea.test', requestedService: 'Afiliación', type: 'affiliation',
    }),
  });
  assert.equal(requestResponse.status, 201);

  const loginResponse = await fetch(`${context.baseUrl}/api/auth/login`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'contratos@elevant.test', password: 'Elevant2026!' }),
  });
  const login = await loginResponse.json();
  const headers = { Authorization: `Bearer ${login.token}` };

  const listResponse = await fetch(`${context.baseUrl}/api/notifications`, { headers });
  const snapshot = await listResponse.json();
  assert.equal(listResponse.status, 200);
  assert.equal(snapshot.notifications.length, 1);
  assert.equal(snapshot.notifications[0].recipientRole, 'CONTRATOS');
  assert.equal(snapshot.notifications[0].read, false);

  const readResponse = await fetch(`${context.baseUrl}/api/notifications/${snapshot.notifications[0].id}/read`, {
    method: 'POST', headers,
  });
  assert.equal(readResponse.status, 200);
  assert.equal((await readResponse.json()).read, true);
});

test('Contratos y Finanzas intercambian mensajes departamentales persistentes', async t => {
  resetSessionsForTests();
  const context = await startTestServer();
  t.after(context.close);

  async function login(email) {
    const response = await fetch(`${context.baseUrl}/api/auth/login`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password: 'Elevant2026!' }),
    });
    assert.equal(response.status, 200);
    return (await response.json()).token;
  }

  const contractsToken = await login('contratos@elevant.test');
  const financeToken = await login('finanzas@elevant.test');
  const sentResponse = await fetch(`${context.baseUrl}/api/internal-chat/messages`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${contractsToken}` },
    body: JSON.stringify({ recipientRole: 'FINANZAS', content: 'Contrato CTR-2026-001 disponible para revisión.' }),
  });
  const sent = await sentResponse.json();
  assert.equal(sentResponse.status, 201);
  assert.equal(sent.senderRole, 'CONTRATOS');
  assert.equal(sent.recipientRole, 'FINANZAS');

  const inboxResponse = await fetch(`${context.baseUrl}/api/internal-chat/messages`, {
    headers: { Authorization: `Bearer ${financeToken}` },
  });
  const inbox = await inboxResponse.json();
  assert.equal(inboxResponse.status, 200);
  assert.equal(inbox.messages.length, 1);
  assert.equal(inbox.messages[0].content, 'Contrato CTR-2026-001 disponible para revisión.');

  const readResponse = await fetch(`${context.baseUrl}/api/internal-chat/messages/${sent.id}/read`, {
    method: 'POST', headers: { Authorization: `Bearer ${financeToken}` },
  });
  assert.equal(readResponse.status, 200);
  assert.ok((await readResponse.json()).readAt);

  const notificationsResponse = await fetch(`${context.baseUrl}/api/notifications`, {
    headers: { Authorization: `Bearer ${financeToken}` },
  });
  const notifications = await notificationsResponse.json();
  assert.equal(notifications.notifications[0].source, 'Chat departamental');
});
