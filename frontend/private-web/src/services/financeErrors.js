import { problemMessage } from './problemMessages';

/**
 * Spanish explanation of each Problem Details code of Finance (phase 1). Block B wrote the codes of the
 * contract approval (one per blocking cause, 1-N07); block C adds the tariff books, billing units,
 * exchange rates and packages (1-E, 1-N27). The screens never show the server title.
 */
export const CONTRACT_APPROVAL_MESSAGES = Object.freeze({
  version_conflict: 'El contrato cambió o ya fue decidido. Se actualizó la lista.',
  idempotency_conflict: 'Esa decisión ya se envió con otros datos. Se actualizó la lista; revísela e intente de nuevo.',
  package_not_eligible: 'Un paquete del contrato ya no corresponde a su moneda o vigencia. Devuélvalo a Contratos para que lo cambie.',
  package_retired: 'Finanzas retiró un paquete que el contrato incluye. Devuélvalo a Contratos para que lo quite.',
  service_retired: 'El contrato incluye un servicio dado de baja del catálogo. Devuélvalo a Contratos para que lo quite.',
  valid_from_not_after_current: 'La vigencia empieza antes que la versión aprobada vigente. Devuélvalo a Contratos para que la corrija.',
  ambiguous_package_coverage: 'Un servicio está cubierto por más de un paquete. Devuélvalo a Contratos.',
  package_service_not_in_contract: 'Un paquete cubre un servicio que el contrato no incluye. Devuélvalo a Contratos.',
  invalid_contract_decision: 'Para devolver el contrato escriba un motivo de 3 a 1000 caracteres.',
  not_found: 'El contrato ya no está pendiente o no pertenece a sus estaciones.',
});

/** Billing units, the service and charge tariffs, the charge catalog and the exchange rates (1-E). */
export const FINANCE_TARIFF_MESSAGES = Object.freeze({
  billing_unit_unknown: 'La unidad de cobro no existe o está inactiva. Elija una unidad de la lista.',
  billing_unit_required: 'Los cargos por unidad necesitan una unidad de cobro.',
  invalid_billing_unit: 'Revise el código (2 a 32 letras minúsculas, dígitos o guiones), el nombre y los decimales.',
  billing_unit_exists: 'Ya existe una unidad con ese código.',
  billing_unit_code_locked: 'El código de una unidad no cambia: lo usan las tarifas y los servicios. Cree otra unidad.',
  invalid_tariff: 'Revise la vigencia, la nota y los precios de la tarifa.',
  tariff_draft_exists: 'Ya hay un borrador en esa moneda. Ábralo para continuar.',
  tariff_not_found: 'La versión de origen ya no existe. Actualice la vista.',
  tariff_empty: 'Añada al menos un precio y guarde antes de publicar.',
  tariff_start_not_after_current: 'La vigencia debe empezar después de la versión vigente. Cambie «Vigente desde» y guarde.',
  service_not_found: 'Un servicio de la tarifa ya no existe en el catálogo. Actualice la vista.',
  stations_invalid: 'Una estación de la tarifa ya no existe. Actualice la vista.',
  invalid_charge: 'Revise el código, el nombre, el cálculo y la cantidad del cargo.',
  charge_code_exists: 'Ya existe un cargo con ese código.',
  charge_not_found: 'Un cargo de la tarifa ya no existe. Actualice la vista.',
  invalid_exchange_rate: 'Revise la fecha, la tasa y la fuente.',
  exchange_rate_exists: 'Ya hay una tasa vigente para esa fecha. Corríjala en lugar de registrar otra.',
  invalid_finance_data: 'Revise los datos e intente de nuevo.',
  version_conflict: 'El registro cambió mientras lo editaba. Se actualizó la vista; revise los datos e intente de nuevo.',
  not_found: 'El registro ya no existe. Actualice la vista.',
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeContractApprovalMessage = (error, options) =>
  problemMessage(error, CONTRACT_APPROVAL_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeTariffMessage = (error, options) => problemMessage(error, FINANCE_TARIFF_MESSAGES, options);
