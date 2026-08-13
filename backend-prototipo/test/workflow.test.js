import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import * as flow from '../src/workflow.js';
import { excel, pdf } from '../src/reports.js';

const seedUrl = new URL('../data/seed.json', import.meta.url);
const actor = (id, name, role) => ({ id, name, role });
async function fresh() { return JSON.parse(await readFile(seedUrl, 'utf8')); }

test('recorre solicitud, contrato, RRHH, OCC, agente y Finanzas', async () => {
  const data = await fresh();
  const contracts = actor('USR-CONTRACTS', 'Contratos', 'CONTRATOS');
  const hr = actor('USR-HR', 'Gestión Humana', 'GESTION_HUMANA');
  const occ = actor('USR-ADMIN', 'OCC', 'ADMIN_OCC');
  const agent = actor('USR-AGENT-01', 'José Pérez', 'AGENTE_RAMPA');
  const finance = actor('USR-FINANCE', 'Finanzas', 'FINANZAS');

  flow.reviewRequest(data, 'SOL-108', contracts);
  const { contract } = flow.decideRequest(data, 'SOL-108', { status: 'APPROVED', decisionNote: 'Aprobada.', contractType: 'TEMPORARY', defaultRate: 300 }, contracts);
  assert.equal(contract.status, 'ACTIVE');
  const allocation = flow.allocatePersonnel(data, { agentId: 'AGT-001' }, hr);
  const assignment = flow.assignFlight(data, 'FLT-EV204', { agentId: 'AGT-001', services: ['Puente de abordaje', 'GPU', 'Equipaje'] }, occ);
  const operation = flow.startOperation(data, 'FLT-EV204', {}, agent);
  flow.completeOperation(data, operation.id, { checklist: { exterior: 'OK', escalera: 'NA' } }, agent);
  flow.reviewOperation(data, operation.id, { status: 'APPROVED', note: 'Validada.' }, occ);
  const preinvoice = flow.generatePreinvoice(data, { airlineId: 'AIR-DEMO', currency: 'USD' }, finance);
  flow.transitionPreinvoice(data, preinvoice.id, 'approve', finance);
  flow.transitionPreinvoice(data, preinvoice.id, 'send', finance);
  assert.equal(allocation.status, 'ASSIGNED');
  assert.equal(assignment.status, 'IN_PROGRESS');
  assert.equal(preinvoice.status, 'SENT');
  assert.equal(flow.summary(data).approvedServices, 3);
});

test('sincronización móvil es idempotente y conserva incidencias', async () => {
  const data = await fresh();
  const agent = actor('USR-AGENT-01', 'José Pérez', 'AGENTE_RAMPA');
  const items = [
    { idempotencyKey: 'a', type: 'operación', createdAt: '2026-08-12T10:00:00Z', payload: { flightId: 'B61015', startedAt: '2026-08-12T10:00:00Z' } },
    { idempotencyKey: 'b', type: 'checklist', createdAt: '2026-08-12T10:10:00Z', payload: { flightId: 'B61015', answers: { exterior: 'OK' } } },
    { idempotencyKey: 'c', type: 'operación', createdAt: '2026-08-12T10:11:00Z', payload: { flightId: 'B61015', startedAt: '2026-08-12T10:00:00Z', endedAt: '2026-08-12T10:11:00Z' } },
    { idempotencyKey: 'd', type: 'incidencia', createdAt: '2026-08-12T10:12:00Z', payload: { flightId: 'B61015', description: 'Neumático requiere inspección.', impact: 'HIGH' } },
  ];
  flow.synchronizeMobile(data, items, agent);
  flow.synchronizeMobile(data, items, agent);
  assert.equal(data.operations.length, 1);
  assert.equal(data.incidents.length, 1);
  assert.equal(data.mobileSyncRecords.length, 4);
});

test('chat departamental y exportaciones producen archivos válidos', async () => {
  const data = await fresh();
  const contracts = actor('USR-CONTRACTS', 'Contratos', 'CONTRATOS');
  const chat = flow.createChat(data, { participants: ['FINANZAS'], title: 'Contrato y tarifas' }, contracts);
  flow.sendMessage(data, chat.id, { text: 'Contrato listo para revisión financiera.' }, contracts);
  assert.equal(data.messages[0].senderRole, 'CONTRATOS');
  assert.equal((await pdf(data)).subarray(0, 4).toString(), '%PDF');
  assert.deepEqual([...((await excel(data)).subarray(0, 2))], [80, 75]);
});
