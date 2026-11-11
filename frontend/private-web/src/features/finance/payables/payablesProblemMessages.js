import { problemMessage } from '../../../services/problemMessages';

/**
 * Suppliers, supplier invoices, supplier payments and employee expenses (phase 4, block D, 4-N27): the Spanish
 * explanation of every Problem Details code of the module, with what resolves it. The screens never show the server
 * title nor the text of an exception.
 */
export const PAYABLES_PROBLEM_MESSAGES = Object.freeze({
  forbidden: 'No tiene permiso para realizar esta acción.',
  segregation_of_duties: 'Otra persona de Finanzas debe aprobar o pagar este documento.',
  not_found: 'El documento ya no está disponible en su estación.',
  version_conflict: 'El documento, su versión o el saldo cambió. Revise los datos actualizados antes de continuar.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Revise los datos actualizados y vuelva a intentarlo.',
  invalid_state: 'El documento ya no está en un estado que admita esta acción. Revise los datos actualizados.',
  duplicate_reference: 'Ya existe una factura activa de este proveedor con ese número de documento.',
  duplicate_supplier_code: 'Ya existe un proveedor con ese código en la estación.',
  supplier_inactive: 'El proveedor está retirado: reactívelo en Proveedores para continuar.',
  supplier_has_open_balance: 'El proveedor tiene facturas en curso, saldo pendiente o pagos sin aplicar: anúlelos o liquídelos en Facturas de proveedores antes de retirarlo.',
  invoice_has_applications: 'La factura tiene pagos aplicados: revierta esas aplicaciones antes de anularla.',
  payment_has_applications: 'El pago tiene aplicaciones activas: reviértalas antes de anular el pago.',
  payment_voided: 'El pago está anulado: ya no se puede aplicar.',
  already_reversed: 'Ese movimiento ya se revirtió o se anuló. Revise los datos actualizados.',
  balance_exceeded: 'El importe supera el saldo de la factura o el disponible del pago.',
  invalid: 'Revise los campos, la tasa de cambio y las fechas.',
  reason_required: 'Indique el motivo (entre 5 y 500 caracteres).',
  receipt_required: 'Adjunte un comprobante antes de enviar.',
  expense_date_outside_assignment: 'La fecha del gasto está fuera de su asignación a esta estación.',
  attachment_limit: 'El documento ya tiene 20 comprobantes: quite uno antes de adjuntar otro.',
  invalid_attachment: 'Use un PDF, PNG o JPEG válido de hasta 8 MB.',
  unavailable: 'El comprobante no está disponible en este momento. Intente de nuevo más tarde.',
});

/** Codes after which the screen re-reads the document before a new attempt: it changed or moved to another status. */
export const PAYABLES_RELOAD_CODES = Object.freeze(['version_conflict', 'invalid_state', 'already_reversed']);

/** Spanish message of a failed payables call, by its code; a network failure gets the module's own fallback. */
export function payablesError(error) {
  return problemMessage(error, PAYABLES_PROBLEM_MESSAGES, {
    forbidden: PAYABLES_PROBLEM_MESSAGES.forbidden,
    fallback: 'No se pudo conectar o completar la operación. Intente de nuevo.',
  });
}

/** The document must be re-read: it changed, moved to another status, or a 409 came without a code (an older API). */
export function needsReload(error) {
  if (error?.status !== 409) return false;
  return typeof error.code !== 'string' || PAYABLES_RELOAD_CODES.includes(error.code);
}

/** Only an uncertain result (no answer, or a 5xx) is retried, with the same request id and the same body. */
export const isUncertain = error => typeof error?.status !== 'number' || error.status >= 500;
