import { describe, expect, it } from 'vitest';
import { isUncertain, needsReload, PAYABLES_PROBLEM_MESSAGES, payablesError } from './payablesProblemMessages';

const problem = (status, code) => Object.assign(new Error('Private server title'), { status, code });

describe('payables Problem Details in Spanish (4-N27)', () => {
  it.each([
    ['segregation_of_duties', 403, 'Otra persona de Finanzas debe aprobar o pagar este documento.'],
    ['duplicate_reference', 409, 'Ya existe una factura activa de este proveedor con ese número de documento.'],
    ['supplier_has_open_balance', 409, 'El proveedor tiene facturas en curso, saldo pendiente o pagos sin aplicar: anúlelos o liquídelos antes de retirarlo.'],
    ['supplier_inactive', 409, 'El proveedor está retirado: reactívelo en Proveedores para continuar.'],
    ['expense_date_outside_assignment', 400, 'La fecha del gasto está fuera de su asignación a esta estación.'],
    ['receipt_required', 400, 'Adjunte un comprobante antes de enviar.'],
    ['reason_required', 400, 'Indique el motivo (entre 5 y 500 caracteres).'],
    ['attachment_limit', 400, 'El documento ya tiene 20 comprobantes: quite uno antes de adjuntar otro.'],
  ])('explains %s by its code, never by the server title', (code, status, message) => {
    expect(payablesError(problem(status, code))).toBe(message);
  });

  it('explains every code of the module and never a raw title', () => {
    for (const code of ['forbidden', 'not_found', 'version_conflict', 'idempotency_conflict', 'invalid_state',
      'duplicate_supplier_code', 'invoice_has_applications', 'payment_has_applications', 'payment_voided', 'already_reversed',
      'balance_exceeded', 'invalid', 'invalid_attachment', 'unavailable'])
      expect(PAYABLES_PROBLEM_MESSAGES[code], code).toEqual(expect.any(String));
    expect(Object.isFrozen(PAYABLES_PROBLEM_MESSAGES)).toBe(true);
    expect(Object.values(PAYABLES_PROBLEM_MESSAGES).join(' ')).not.toMatch(/conflict|invalid|Private/);
  });

  it('keeps the session, permission and network fallbacks', () => {
    expect(payablesError(problem(401, 'unauthorized'))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    expect(payablesError(problem(403))).toBe('No tiene permiso para realizar esta acción.');
    expect(payablesError(new Error('fetch failed: ECONNRESET'))).toBe('No se pudo conectar o completar la operación. Intente de nuevo.');
    // A date outside the assignment is not a missing permission any more.
    expect(payablesError(problem(400, 'expense_date_outside_assignment'))).not.toMatch(/permiso/);
  });

  it('re-reads only when the document changed or moved to another status', () => {
    expect(needsReload(problem(409, 'version_conflict'))).toBe(true);
    expect(needsReload(problem(409, 'invalid_state'))).toBe(true);
    expect(needsReload(problem(409, 'already_reversed'))).toBe(true);
    expect(needsReload(problem(409))).toBe(true);
    expect(needsReload(problem(409, 'duplicate_reference'))).toBe(false);
    expect(needsReload(problem(409, 'supplier_has_open_balance'))).toBe(false);
    expect(needsReload(problem(400, 'reason_required'))).toBe(false);
  });

  it('retries only an uncertain result', () => {
    expect(isUncertain(new Error('Lost response'))).toBe(true);
    expect(isUncertain(problem(503, 'unavailable'))).toBe(true);
    expect(isUncertain(problem(500))).toBe(true);
    for (const status of [400, 401, 403, 404, 409]) expect(isUncertain(problem(status))).toBe(false);
  });
});
