import { commercialApi, discardFinancePackage, retireFinancePackage } from './commercialGovernanceApi';
import { newRequestId } from './financeBookService';
import { problemMessage } from './problemMessages';

const json = (method, body) => ({ method, body: JSON.stringify(body) });

export const listFinancePackages = () => commercialApi('/finance/packages');
export const saveFinancePackageDraft = (id, values) => commercialApi(
  id ? `/finance/packages/${id}` : '/finance/packages', json(id ? 'PUT' : 'POST', values));
export const publishFinancePackage = (id, values) => commercialApi(`/finance/packages/${id}/publish`, json('POST', values));
export const listContractPackages = versionId => commercialApi(`/contracts/drafts/${versionId}/packages`);
export const setContractPackages = (versionId, values) => commercialApi(`/contracts/drafts/${versionId}/packages`, json('PUT', values));
/** Discards a draft or retires a published package with a reason (1-N27); the key goes in the header. */
export { discardFinancePackage, retireFinancePackage };

/** Keep the complete command after an uncertain response; editing its payload starts a new command. */
export function createPackageCommand() {
  let pending;
  return async (operation, values, send) => {
    const signature = JSON.stringify([operation, values]);
    if (pending?.signature !== signature) pending = { signature, body: { ...values, requestId: newRequestId() } };
    const result = await send(pending.body);
    pending = null;
    return result;
  };
}

/** Spanish explanation of each package code (Finance and the packages of a contract draft). */
export const FINANCE_PACKAGE_MESSAGES = Object.freeze({
  version_conflict: 'La versión cambió. Actualice la vista y revise los datos antes de guardar de nuevo.',
  idempotency_conflict: 'La solicitud ya se utilizó con otros datos. Actualice la vista antes de continuar.',
  ambiguous_package_coverage: 'Hay servicios cubiertos por más de un paquete. Seleccione una sola cobertura por servicio.',
  package_not_eligible: 'Seleccione versiones publicadas en la moneda del contrato y vigentes durante todo el contrato.',
  package_retired: 'Finanzas retiró ese paquete: ya no se puede asignar. Quite esa selección y elija otro.',
  package_service_not_in_contract: 'Todos los servicios del paquete deben formar parte del contrato.',
  package_reference_invalid: 'Seleccione servicios activos del catálogo.',
  billing_unit_unknown: 'Seleccione unidades de cobro activas.',
  package_identity_locked: 'El código y la moneda de una versión guardada no pueden cambiar.',
  flight_direction_required: 'Seleccione llegada o salida para el alcance por vuelo.',
  invalid_package_period: 'El período debe tener entre 1 y 366 días y solo aplica al alcance por período.',
  invalid_package_scope: 'Revise la dirección del vuelo y los días del alcance seleccionado.',
  invalid_package: 'Revise los datos y componentes del paquete.',
  package_empty: 'Añada al menos un servicio antes de publicar.',
  package_not_draft: 'Solo se descarta un borrador: la versión ya se publicó o se descartó. Actualice la vista.',
  package_not_published: 'Solo se retira la versión publicada vigente. Actualice la vista.',
  reason_required: 'Escriba el motivo (entre 5 y 500 caracteres).',
  not_found: 'La versión ya no está disponible. Actualice la vista.',
});

/** @param {unknown} error */
export const financePackageError = error => problemMessage(error, FINANCE_PACKAGE_MESSAGES, {
  fallback: 'No se pudo completar la operación de paquetes. Intente de nuevo.',
  forbidden: 'No tiene permiso para realizar esta operación de paquetes.',
});
