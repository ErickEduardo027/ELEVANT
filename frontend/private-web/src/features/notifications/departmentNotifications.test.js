import { describe, expect, it } from 'vitest';
import { CONTRACT_MODULE_IDS } from '../contracts/shell/modules';
import { describeNotification } from './departmentNotifications';

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
