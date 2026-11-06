import { problemMessage } from './problemMessages';

/**
 * Spanish explanation of each Problem Details code of the Finance approval of contracts (phase 1,
 * block B): one code per cause that blocks the approval (1-N07). The screens never show the server
 * title; block C adds the tariff and package codes of Finance here.
 */
export const CONTRACT_APPROVAL_MESSAGES = Object.freeze({
  version_conflict: 'El contrato cambió o ya fue decidido. Se actualizó la lista.',
  idempotency_conflict: 'Esa decisión ya se envió con otros datos. Se actualizó la lista; revísela e intente de nuevo.',
  package_not_eligible: 'Un paquete del contrato ya no corresponde a su moneda o vigencia. Devuélvalo a Contratos para que lo cambie.',
  service_retired: 'El contrato incluye un servicio dado de baja del catálogo. Devuélvalo a Contratos para que lo quite.',
  valid_from_not_after_current: 'La vigencia empieza antes que la versión aprobada vigente. Devuélvalo a Contratos para que la corrija.',
  ambiguous_package_coverage: 'Un servicio está cubierto por más de un paquete. Devuélvalo a Contratos.',
  package_service_not_in_contract: 'Un paquete cubre un servicio que el contrato no incluye. Devuélvalo a Contratos.',
  invalid_contract_decision: 'Para devolver el contrato escriba un motivo de 3 a 1000 caracteres.',
  not_found: 'El contrato ya no está pendiente o no pertenece a sus estaciones.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeContractApprovalMessage = (error, options) =>
  problemMessage(error, CONTRACT_APPROVAL_MESSAGES, options);
