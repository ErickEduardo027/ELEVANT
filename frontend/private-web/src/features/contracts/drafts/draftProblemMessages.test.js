import { describe, expect, it } from 'vitest';
import { CONTRACT_DRAFT_ISSUES } from '@elevant/api-client';
import { DRAFT_PROBLEM_MESSAGES, PORTAL_ACCOUNT_LABELS, READINESS_CHECKS, amendmentProblemMessage,
  draftProblemMessage } from './draftProblemMessages';
import { financeContractApprovalMessage } from '../../../services/financeErrors';
import { describeNotification } from '../../notifications/departmentNotifications';

const failure = (status, code) => Object.assign(new Error('Draft is not ready for activation.'), { status, code });

describe('contract draft problem messages', () => {
  it('explains every readiness cause, in the order the server reports them', () => {
    expect(READINESS_CHECKS.map(([code]) => code)).toEqual([...CONTRACT_DRAFT_ISSUES]);
    for (const code of CONTRACT_DRAFT_ISSUES) expect(DRAFT_PROBLEM_MESSAGES[code]).toMatch(/\S/);
    expect(Object.keys(PORTAL_ACCOUNT_LABELS).sort()).toEqual(['Active', 'Invited', 'Missing']);
  });

  it('uses the code, then the status, and never the server title', () => {
    expect(draftProblemMessage(failure(409, 'portal_account_missing'))).toMatch(/todavía no tiene cuenta en el portal/);
    expect(draftProblemMessage(failure(409, 'idempotency_conflict'))).toMatch(/ya se usó con otros datos/);
    expect(draftProblemMessage(failure(409, 'made_up'))).toBe('El registro cambió; actualice e intente de nuevo.');
    expect(draftProblemMessage(failure(403))).toBe('No tiene permiso para esta acción.');
    expect(draftProblemMessage(new TypeError('offline'))).not.toMatch(/offline|Draft is not ready/);
  });

  it('explains each blocked Finance approval by its code', () => {
    expect(financeContractApprovalMessage(failure(409, 'package_not_eligible'))).toMatch(/Devuélvalo a Contratos/);
    expect(financeContractApprovalMessage(failure(409, 'service_retired'))).toMatch(/dado de baja/);
    expect(financeContractApprovalMessage(failure(404, 'not_found'))).toMatch(/no pertenece a sus estaciones/);
    expect(financeContractApprovalMessage(failure(409))).toBe('El registro cambió; actualice e intente de nuevo.');
  });

  it('explains a retired package and an unknown unit of the draft (block C)', () => {
    expect(draftProblemMessage(failure(409, 'package_retired'))).toMatch(/Finanzas retiró un paquete vinculado/);
    expect(draftProblemMessage(failure(400, 'billing_unit_unknown'))).toMatch(/unidad de cobro activa/);
  });

  it('explains why an amendment cannot start (1-C)', () => {
    expect(amendmentProblemMessage(failure(409, 'valid_from_not_after_current'))).toMatch(/después del inicio de la versión aprobada/);
    expect(amendmentProblemMessage(failure(409, 'valid_from_after_current_end'))).toMatch(/use «Renovar»/);
    expect(amendmentProblemMessage(failure(409, 'draft_in_progress'))).toMatch(/ya tiene un borrador en curso/);
    expect(amendmentProblemMessage(failure(409, 'contract_not_amendable'))).toMatch(/activo o suspendido/);
    expect(amendmentProblemMessage(failure(409, 'version_conflict'))).toMatch(/cambió de estado/);
    expect(amendmentProblemMessage(new TypeError('offline'))).not.toMatch(/offline/);
  });

  it('names the new Contratos notices and opens the right screen', () => {
    expect(describeNotification({ kind: 'portal_account_ready', subject: 'DRAFT-1 · Demo' }).target)
      .toEqual({ moduleId: expect.any(String) });
    expect(describeNotification({ kind: 'contract_returned', subject: 'DRAFT-1 · Demo' }).title)
      .toBe('Finanzas devolvió un borrador');
    expect(describeNotification({ kind: 'contract_approved', subject: null }).message)
      .toMatch(/Finanzas aprobó los precios de un contrato/);
  });
});
