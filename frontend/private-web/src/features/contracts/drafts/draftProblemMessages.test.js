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
    expect(draftProblemMessage(failure(409, 'made_up'))).toBe('El registro cambió; actualiza e intenta de nuevo.');
    expect(draftProblemMessage(failure(403))).toBe('No tienes permiso para esta acción.');
    expect(draftProblemMessage(new TypeError('offline'))).not.toMatch(/offline|Draft is not ready/);
  });

  it('explains each blocked Finance approval by its code', () => {
    expect(financeContractApprovalMessage(failure(409, 'package_not_eligible'))).toMatch(/Devuélvelo a Contratos/);
    expect(financeContractApprovalMessage(failure(409, 'service_retired'))).toMatch(/dado de baja/);
    expect(financeContractApprovalMessage(failure(404, 'not_found'))).toMatch(/no pertenece a tus estaciones/);
    expect(financeContractApprovalMessage(failure(409))).toBe('El registro cambió; actualiza e intenta de nuevo.');
  });

  it('addresses Contratos as tú in the readiness, the scope, the discard and the amendment (D-N36)', () => {
    expect(DRAFT_PROBLEM_MESSAGES.terms_missing).toBe('Escribe y guarda las condiciones del contrato.');
    expect(DRAFT_PROBLEM_MESSAGES.rates_unconfirmed).toBe('Confirma y guarda todas las tarifas (0 = cortesía).');
    expect(DRAFT_PROBLEM_MESSAGES.finance_reviewer_missing)
      .toBe('Nadie en Finanzas cubre todas las estaciones del borrador. Pide que asignen esas estaciones a un revisor.');
    expect(PORTAL_ACCOUNT_LABELS.Missing).toBe('Sin cuenta del portal: Superadministración debe crearla. Recibirás un aviso cuando esté lista.');
    expect(draftProblemMessage(failure(409, 'service_in_package')))
      .toBe('No puedes quitar un servicio que cubre un paquete vinculado. Quita primero el paquete.');
    expect(draftProblemMessage(failure(409, 'version_conflict')))
      .toBe('El borrador cambió mientras lo editabas. Se actualizó; revisa los datos e intenta de nuevo.');
    expect(draftProblemMessage(failure(401))).toBe('La sesión expiró. Vuelve a iniciar sesión.');
    expect(amendmentProblemMessage(failure(409, 'draft_in_progress')))
      .toBe('El contrato ya tiene un borrador en curso. Complétalo o descártalo en Borradores antes de crear otra enmienda.');
    expect(amendmentProblemMessage(failure(404, 'not_found'))).toBe('El contrato ya no existe o no pertenece a tus estaciones.');
    expect(amendmentProblemMessage(new TypeError('offline')))
      .toBe('No se pudo completar la acción. Revisa la conexión e intenta de nuevo.');
    expect(DRAFT_PROBLEM_MESSAGES).toMatchObject({
      invalid_draft: 'Revisa las condiciones, la vigencia, la moneda y las tarifas del borrador.',
      draft_closed: 'El borrador ya no está en curso: fue aprobado, descartado o el contrato terminó. Actualiza la lista.',
      services_missing: 'Agrega al menos un servicio al borrador.',
      stations_missing: 'Asigna al menos una estación al borrador.',
      service_retired: 'Quita del alcance los servicios dados de baja del catálogo.',
      package_not_eligible: 'Un paquete vinculado no corresponde a la moneda o la vigencia del contrato. Cámbialo o quítalo '
        + 'primero.',
      package_retired: 'Finanzas retiró un paquete vinculado. Quítalo de los paquetes del contrato antes de enviarlo.',
      billing_unit_unknown: 'Elige para cada tarifa una unidad de cobro activa de la lista.',
      service_not_found: 'Un servicio elegido ya no existe en el catálogo. Actualiza el alcance.',
      scope_invalid: 'Elige entre 1 y 100 servicios y entre 1 y 30 estaciones.',
      stations_invalid: 'Elige entre 1 y 30 estaciones activas.',
      comment_required: 'Escribe la observación (hasta 2000 caracteres).',
      reason_required: 'Indica el motivo (entre 5 y 500 caracteres).',
      termination_scheduled: 'El contrato termina antes del inicio de este borrador: cambia la vigencia o descártalo.',
    });
    expect(amendmentProblemMessage(failure(409, 'version_conflict')))
      .toBe('El contrato cambió de estado. Se volvió a cargar; revísalo e intenta de nuevo.');
    expect(amendmentProblemMessage(failure(409, 'version_awaiting_signatures')))
      .toBe('Una versión aprobada por Finanzas espera las firmas. Complétala o retírala antes de crear otra enmienda.');
  });

  it('explains a retired package and an unknown unit of the draft (block C)', () => {
    expect(draftProblemMessage(failure(409, 'package_retired'))).toMatch(/Finanzas retiró un paquete vinculado/);
    expect(draftProblemMessage(failure(400, 'billing_unit_unknown'))).toMatch(/unidad de cobro activa/);
  });

  it('explains why an amendment cannot start (1-C)', () => {
    expect(amendmentProblemMessage(failure(409, 'valid_from_not_after_current'))).toMatch(/después del inicio de la versión aprobada/);
    expect(amendmentProblemMessage(failure(409, 'valid_from_after_current_end'))).toMatch(/usa «Renovar»/);
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
