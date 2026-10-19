import { commercialApi } from './commercialGovernanceApi';
import { newRequestId } from './financeBookService';

const json = body => ({ method: 'POST', body: JSON.stringify(body) });
export const listTaxPolicies = () => commercialApi('/finance/tax-policies');
export const getTaxContext = () => commercialApi('/finance/tax-policies/context');
export const createTaxPolicy = values => commercialApi('/finance/tax-policies', json(values));
export const publishTaxPolicy = (id, values) => commercialApi(`/finance/tax-policies/${id}/publish`, json(values));
export const getPreinvoiceTaxes = id => commercialApi(`/finance/preinvoices/${id}/taxes`);
export const applyPreinvoiceTaxes = (id, values) => commercialApi(`/finance/preinvoices/${id}/taxes`, json(values));

export function createTaxCommand() {
  let pending;
  return async (action, values, send) => {
    const signature = JSON.stringify([action, values]);
    if (pending?.signature !== signature) pending = { signature, body: { ...values, requestId: newRequestId() } };
    const result = await send(pending.body); pending = null; return result;
  };
}
const errors = {
  ambiguous_tax_policy: 'Hay más de una política aplicable. Revise el contexto y las vigencias antes de continuar.',
  version_conflict: 'La versión cambió. Actualice la vista y revise los datos antes de continuar.',
  idempotency_conflict: 'La solicitud ya se utilizó con otros datos. Actualice la vista.',
  invalid_tax_policy: 'Revise el tratamiento, la tasa y el fundamento obligatorio de exención o no sujeción.',
  invalid_tax_context: 'Seleccione una aerolínea y una estación autorizada activas.',
  invalid_tax_replacement: 'La nueva política debe conservar el contexto y concepto de la política que reemplaza.',
  not_found: 'El registro ya no está disponible en su alcance. Actualice la vista.',
};
export function financeTaxError(error) {
  if (error?.status === 401) return 'La sesión expiró. Vuelva a iniciar sesión.';
  if (error?.status === 403) return 'No tiene permiso para realizar esta operación de impuestos.';
  return errors[error?.code] ?? (error?.status === 409 ? errors.version_conflict : 'No se pudo completar la operación de impuestos. Intente de nuevo.');
}
export const taxTreatmentLabel = value => ({ Taxable: 'Gravado', Exempt: 'Exento', NotSubject: 'No sujeto', Unconfigured: 'Sin configurar' })[value] ?? 'Sin configurar';
export const taxMoney = (value, currency) => value == null ? 'Sin configurar' : new Intl.NumberFormat('es-DO', {
  style: 'currency', currency, minimumFractionDigits: 4, maximumFractionDigits: 4,
}).format(value);
