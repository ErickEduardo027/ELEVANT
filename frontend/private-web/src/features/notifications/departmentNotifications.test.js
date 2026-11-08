import { describe, expect, it } from 'vitest';
import { CONTRACT_MODULE_IDS } from '../contracts/shell/modules';
import { FINANCE_MODULE_IDS } from '../finance/shell/modules';
import { describeNotification } from './departmentNotifications';
import { notificationKindLabel, notificationTargetPath } from './notificationKinds';

describe('Finance alerts of phase 4 (block A)', () => {
  it('opens «Por facturar» when OCC approves operations ready to invoice (4-N26)', () => {
    const described = describeNotification({ kind: 'operation_ready_to_invoice', subject: 'Demo Airlines', stationCode: 'PUJ' });
    expect(described.title).toBe('OCC aprobó operaciones listas para facturar');
    expect(described.message).toBe('OCC aprobó operaciones listas para facturar: Demo Airlines · PUJ');
    expect(described.target).toEqual({ moduleId: FINANCE_MODULE_IDS.TO_INVOICE });
  });
});

describe('contract lifecycle notifications (phase 2, block A)', () => {
  it.each([
    ['contract_termination_scheduled', 'Se programó la terminación de un contrato'],
    ['contract_termination_cancelled', 'Se canceló la terminación programada de un contrato'],
    ['contract_terminated', 'Un contrato terminó en su fecha efectiva'],
    ['contract_version_withdrawn', 'Contratos retiró una versión sin las dos firmas'],
    ['contract_renewal_blocked', 'La renovación automática de un contrato no pudo iniciarse'],
  ])('%s has a Spanish title and opens Contratos', (kind, title) => {
    const described = describeNotification({ kind, subject: 'CTR-2026-0001 · Demo Air' });
    expect(described.title).toBe(title);
    expect(described.message).toBe(`${title}: CTR-2026-0001 · Demo Air`);
    expect(described.target).toEqual({ moduleId: CONTRACT_MODULE_IDS.CONTRACTS });
  });
});

describe('contract notifications without a title or a destination before (2-N29)', () => {
  it.each([
    ['contract_validity', 'Se fijó la vigencia de un contrato: ya puede firmarse', CONTRACT_MODULE_IDS.CONTRACTS],
    ['contract_renewal_started', 'Empezó la renovación automática de un contrato: complete el borrador', CONTRACT_MODULE_IDS.DRAFTS],
    ['contract_suspended', 'Contrato suspendido por falta de un permiso de operación vigente', CONTRACT_MODULE_IDS.CONTRACTS],
    ['contract_expiring', 'Un contrato está por vencer', CONTRACT_MODULE_IDS.CONTRACTS],
  ])('%s has a Spanish title and opens its module', (kind, title, moduleId) => {
    const described = describeNotification({ kind, subject: 'CTR-2026-0001 · Demo Air' });
    expect(described.title).toBe(title);
    expect(described.target).toEqual({ moduleId });
  });

  it('still names an unknown kind in Spanish without a destination', () => {
    expect(describeNotification({ kind: 'something_new', subject: null })).toMatchObject({ title: 'Nueva notificación',
      target: null });
  });
});

describe('ramp agent notices of phase 2 (block D)', () => {
  it.each([
    ['agent_document_expiring', 'Un carnet o una licencia de rampa está por vencer', '/gestion-humana/permits'],
    ['agent_qualification_expiring', 'Una habilitación de un agente está por vencer', '/gestion-humana/certifications'],
  ])('%s warns Gestión Humana and opens the documents (2-N25)', (kind, title, path) => {
    const described = describeNotification({ kind, subject: 'Carnet aeroportuario · Riley Ramp (DEV-RA-001) · vence el 2026-11-30' });
    expect(described.title).toBe(title);
    expect(described.target).toEqual({ path });
  });

  it('tells Finanzas that OCC cancelled a charter with a prepayment and opens the charters (3-A)', () => {
    const described = describeNotification({ kind: 'charter_cancelled', subject: 'PUJ-20261105-004', stationCode: 'PUJ' });
    expect(described.title).toBe('OCC canceló un charter con prepago: revise la devolución');
    expect(described.message).toBe('OCC canceló un charter con prepago: revise la devolución: PUJ-20261105-004 · PUJ');
    expect(described.target).toEqual({ moduleId: 'finance-charters' });
  });

  it.each(['agent_released', 'agent_document_not_current', 'flight_cancelled_by_provider', 'flight_diverted_by_provider',
    // Phase 3, block B: a stand change without an eligible agent (3-N05) and a contract out of force (3-N04).
    'stand_change_unassigned', 'contract_not_in_force'])(
    '%s tells OCC in Spanish and opens the planning board', kind => {
    expect(notificationKindLabel(kind)).not.toBe(notificationKindLabel('unknown_kind'));
    expect(notificationKindLabel(kind, 'en')).not.toBe(notificationKindLabel('unknown_kind', 'en'));
    expect(notificationTargetPath({ kind, operationId: 'op-1' })).toBe('/admin-occ/planning');
  });

  it('says in Spanish why OCC has to reassign or hold the flight (3-N05, 3-N04)', () => {
    expect(notificationKindLabel('stand_change_unassigned'))
      .toBe('El cambio de posición dejó la operación sin agente elegible: reasígnela');
    expect(notificationKindLabel('contract_not_in_force'))
      .toBe('El contrato de la aerolínea ya no está vigente: la operación no puede iniciar');
  });

  it('keeps the review and chat destinations of the other notices', () => {
    expect(notificationTargetPath({ kind: 'operation_submitted', operationId: 'op-1' })).toBe('/admin-occ/review?operationId=op-1');
    expect(notificationTargetPath({ kind: 'agent_message', operationId: 'op-1' })).toBe('/admin-occ/chat?operationId=op-1');
  });
});
