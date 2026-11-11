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
  // Phase 2, block A (2-N15): a terminated contract, or a version that starts on or after its scheduled termination.
  contract_terminated: 'El contrato está terminado: sus precios ya no se aprueban. Devuélvalo a Contratos.',
  termination_scheduled: 'La versión empieza en la fecha de terminación programada del contrato o después. Devuélvala a Contratos.',
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

/**
 * Invoicing (phase 4, block A): every code of the issuance, «Por facturar» and the no-charge closure, with what
 * resolves it (4-N01, 4-N06, 4-N07, 4-N18, 4-N29). The rows of «Por facturar» name their blocking codes with these
 * same texts.
 */
export const INVOICING_PROBLEM_MESSAGES = Object.freeze({
  invalid_invoice_request: 'La solicitud de factura no es válida. Actualice la lista y vuelva a elegir las operaciones.',
  invalid_pending_query: 'Los filtros de «Por facturar» no son válidos. Revise las fechas y vuelva a buscar.',
  invoice_state_changed: 'La selección cambió mientras se emitía. Actualizamos la lista; revísela y emita de nuevo.',
  zero_total: 'La selección no tiene importe: no se emite una factura de 0. Puede cerrar estas operaciones sin cargo indicando el motivo.',
  operation_has_charge: 'Estas operaciones tienen importe: emita su factura en lugar de cerrarlas sin cargo.',
  too_many_lines: 'La selección supera las 500 líneas de una factura. Emita esta factura con menos operaciones y continúe con las demás.',
  too_many_operations: 'Una factura admite hasta 100 operaciones. Elija menos operaciones.',
  date_window_exceeded: 'Una factura agrupa operaciones de hasta 31 días. Elija operaciones de un período más corto.',
  station_inactive: 'La estación está inactiva: no se emiten facturas en ella.',
  airline_inactive: 'La aerolínea o su organización está inactiva. Pida a Contratos que la reactive y vuelva a emitir.',
  mixed_airline: 'Una factura solo puede incluir operaciones de la misma aerolínea.',
  mixed_currency: 'Una factura solo puede incluir servicios de la misma moneda. Facture cada moneda por separado.',
  nothing_to_invoice: 'Alguna operación no tiene servicios completados para facturar.',
  operation_not_approved: 'Alguna operación aún no está aprobada por OCC.',
  already_invoiced: 'Alguna operación ya fue facturada o cerrada sin cargo. Actualizamos la lista.',
  // 4-N01: an older draft without invoice is released by the issuance itself; only one an invoice issued still blocks.
  pending_preinvoice: 'Un borrador anterior con factura emitida todavía retiene servicios de esta operación. Avise a soporte técnico para que lo revise.',
  exchange_rate_missing: 'Falta la tasa de cambio del día de la operación para valorar un cargo: regístrela en «Tasas de cambio» y vuelva a emitir.',
  contract_charge_rate_missing: 'El contrato no tiene tarifa para un cargo marcado: pida a Contratos que la complete o a OCC que revise el cargo.',
  contract_charge_policy_missing: 'El cargo marcado no tiene su regla en el contrato: pida a Contratos que la revise.',
  contract_charge_policy_invalid: 'La regla del cargo en el contrato no es válida: pida a Contratos que la revise.',
  charge_definition_missing: 'Un cargo marcado ya no existe en el catálogo: pida a OCC que revise los cargos de la operación.',
  charge_rate_missing: 'Falta la tarifa de un cargo marcado: publique el tarifario de cargos de la moneda y vuelva a emitir.',
  charge_measurement_missing: 'Falta la medición en minutos de un cargo por tiempo: pida a OCC que revise los tiempos de la operación.',
  charge_method_unsupported: 'Un cargo usa un cálculo que la factura no admite: revise el tarifario de cargos.',
  package_percentage_basis_required: 'Un cargo porcentual recae en un servicio cubierto por paquete: pida a Contratos que ajuste el cargo.',
  package_contract_mismatch: 'El paquete del contrato no corresponde a la moneda o a la vigencia de la operación: revíselo con Contratos.',
  package_flight_scope_ambiguous: 'El paquete por vuelo no identifica un único vuelo de la escala: revise la escala con OCC.',
  package_measurement_missing: 'Falta la medición de un servicio cubierto por paquete: pida a OCC que revise los tiempos.',
  package_period_missing: 'El paquete del contrato no tiene un período válido: revíselo en «Paquetes».',
  package_scope_has_unissued_preinvoice: 'Un borrador anterior con factura emitida todavía retiene el consumo del paquete en la misma escala, vuelo o período. Avise a soporte técnico para que lo revise.',
  package_unit_mismatch: 'La unidad del servicio no coincide con la del paquete: revísela con Contratos.',
  invalid_package_rule: 'La regla del paquete no es válida: revísela en «Paquetes».',
  ambiguous_package_coverage: 'Un servicio está cubierto por más de un paquete: pida a Contratos que lo corrija.',
  invalid_amount: 'El importe de la factura queda fuera de rango: revise las tarifas y las cantidades.',
  invalid_tax_policy: 'La regla de impuestos de un servicio no es válida: revise la configuración de impuestos.',
  ambiguous_tax_policy: 'Un servicio tiene más de una regla de impuestos: revise la configuración de impuestos.',
  approved_evidence_mismatch: 'El servicio cambió después de la aprobación de OCC: pida a OCC que reabra la revisión.',
  line_not_billable: 'Algún servicio no está listo para facturar: revise los motivos de la operación.',
  excluded_in_review: 'OCC excluyó un servicio de la factura en la revisión.',
  charge_excluded_by_contract: 'Lleva un cargo que el contrato excluye: pida a OCC reabrir la revisión.',
  missing_frozen_rate: 'Un servicio no tiene tarifa congelada: pida a OCC que revise el servicio.',
  service_not_completed: 'Un servicio no está completado.',
  no_executed_quantity: 'Un servicio no tiene cantidad ejecutada.',
  invalid_currency: 'Un servicio tiene una moneda no válida.',
  invalid_billing_unit: 'Un servicio tiene una unidad de cobro no válida.',
  duplicate_service: 'La selección cambió mientras se emitía. Actualizamos la lista.',
  station_mismatch: 'La selección cambió mientras se emitía. Actualizamos la lista.',
  date_out_of_range: 'La selección cambió mientras se emitía. Actualizamos la lista.',
  version_conflict: 'Alguna operación cambió desde que cargó la lista. Actualizamos la lista; revísela y vuelva a intentar.',
  idempotency_conflict: 'Ese envío ya se usó con otras operaciones. Actualizamos la lista; vuelva a intentar.',
  reason_required: 'Indique el motivo (entre 5 y 500 caracteres).',
  not_found: 'Alguna operación ya no está en la estación. Actualizamos la lista.',
});

/**
 * Treasury (phase 4, block A, 4-N10): the business day of the invoice or the receipt, and the default code of each
 * refusal. Block C (4-N09): a card receipt of the portal is neither reversed nor refunded.
 */
export const TREASURY_PROBLEM_MESSAGES = Object.freeze({
  card_payment_not_reversible: 'Los cobros con tarjeta no se revierten ni se devuelven. Corrija con una nota de crédito en la factura.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Recargue el documento antes de preparar otra solicitud.',
  effective_before_invoice: 'La fecha efectiva es anterior al día de emisión de la factura (hora de República Dominicana). Elija ese día o uno posterior.',
  effective_before_receipt: 'La fecha efectiva es anterior a la fecha en que se recibió el cobro. Elija ese día o uno posterior.',
  treasury_conflict: 'El saldo, la versión o la referencia cambió. Recargue el documento antes de preparar otra solicitud.',
  invalid_treasury_request: 'Revise importes, fechas y motivos de la solicitud.',
  version_conflict: 'El documento cambió mientras lo revisaba. Recárguelo antes de preparar otra solicitud.',
  not_found: 'El documento no está disponible en su estación o aerolínea.',
});

/**
 * The simplified Finance (phase 4, block B, 4-N12): a legacy write retired with the preinvoice answers 410. Nothing
 * was written; the message names the way that replaced it.
 */
export const FINANCE_LEGACY_MESSAGES = Object.freeze({
  legacy_finance_route_retired: 'Esta vía se retiró. Emita facturas desde «Por facturar», registre cobros en «Cobros» y corrija con notas de ajuste.',
});

/** «Inicio» of Finance (phase 4, block B, 4-A and 4-N02): the indicators of one station. */
export const FINANCE_HOME_MESSAGES = Object.freeze({
  invalid_finance_home_query: 'La estación elegida no es válida. Elija una estación financiera autorizada.',
  ...FINANCE_LEGACY_MESSAGES,
});

/** The six Finance reports (phase 4, block B, 4-A, 4-N19 and 4-N20) and their exports. */
export const FINANCE_REPORT_MESSAGES = Object.freeze({
  unknown_finance_report: 'Ese reporte ya no existe en Finanzas. Elija uno de la lista.',
  invalid_report_export_format: 'Ese formato de exportación no existe. Exporte en CSV, Excel o PDF.',
  invalid_report_query: 'Revise el período: la fecha final no puede ser anterior a la inicial, el máximo son dos años y la moneda es USD o DOP.',
  ...FINANCE_LEGACY_MESSAGES,
});

/** «Facturas» (phase 4, block B, 4-N21): its pages and its search by e-NCF, number or airline. */
export const INVOICE_LIST_MESSAGES = Object.freeze({
  invalid_invoice_query: 'La búsqueda no es válida. Escriba hasta 40 caracteres del e-NCF, del número o de la aerolínea.',
  not_found: 'La factura ya no está disponible en sus estaciones. Actualizamos la lista.',
  ...FINANCE_LEGACY_MESSAGES,
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeHomeMessage = (error, options) => problemMessage(error, FINANCE_HOME_MESSAGES, {
  forbidden: 'No tiene permiso para ver el resumen de Finanzas en esta estación.',
  fallback: 'No se pudo cargar el resumen financiero. Revise la conexión e intente de nuevo.',
  ...options,
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeReportMessage = (error, options) => problemMessage(error, FINANCE_REPORT_MESSAGES, {
  forbidden: 'No tiene acceso a este reporte en las estaciones elegidas.',
  fallback: 'No se pudo calcular el reporte. Revise la conexión e intente de nuevo.',
  ...options,
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const invoiceListMessage = (error, options) => problemMessage(error, INVOICE_LIST_MESSAGES, {
  forbidden: 'No tiene permiso para consultar las facturas de esta estación.',
  fallback: 'No se pudieron cargar las facturas. Revise la conexión e intente de nuevo.',
  ...options,
});

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeContractApprovalMessage = (error, options) =>
  problemMessage(error, CONTRACT_APPROVAL_MESSAGES, options);

/** @param {unknown} error @param {{ fallback?: string, forbidden?: string }} [options] */
export const financeTariffMessage = (error, options) => problemMessage(error, FINANCE_TARIFF_MESSAGES, options);
