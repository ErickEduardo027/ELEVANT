import { describe, expect, it } from 'vitest';
import {
  CONTRACT_APPROVAL_MESSAGES, FINANCE_HOME_MESSAGES, FINANCE_LEGACY_MESSAGES, FINANCE_REPORT_MESSAGES, FINANCE_TARIFF_MESSAGES,
  INVOICE_LIST_MESSAGES, TARIFF_BOOK_MESSAGES, financeContractApprovalMessage, financeHomeMessage, financeReportMessage,
  financeTariffMessage, invoiceListMessage, tariffBookMessage,
} from './financeErrors';
import {
  CONTRACT_PACKAGE_MESSAGES, FINANCE_PACKAGE_MESSAGES, contractPackageError, financePackageError,
} from './financePackagesService';

const failure = (status, code) => Object.assign(new Error('Invalid finance data.'), { status, code });

describe('Finance problem messages (1-E, 1-N27)', () => {
  it('explains the tariff books, units, charges and exchange rates by their code', () => {
    expect(financeTariffMessage(failure(400, 'billing_unit_unknown'))).toMatch(/unidad de cobro no existe o está inactiva/);
    expect(financeTariffMessage(failure(409, 'tariff_start_not_after_current'))).toMatch(/después de la versión vigente/);
    expect(financeTariffMessage(failure(409, 'tariff_draft_exists'))).toMatch(/Ya hay un borrador en esa moneda/);
    expect(financeTariffMessage(failure(409, 'exchange_rate_exists'))).toMatch(/Corríjala en lugar de registrar otra/);
    expect(financeTariffMessage(failure(409, 'billing_unit_exists'))).toMatch(/Ya existe una unidad con ese código/);
    for (const text of Object.values(FINANCE_TARIFF_MESSAGES)) expect(text).toMatch(/\S/);
  });

  it('falls back by status and never shows the server title', () => {
    expect(financeTariffMessage(failure(400))).toBe('Revise los datos e intente de nuevo.');
    expect(financeTariffMessage(failure(403), { forbidden: 'Sin permiso para tarifas.' })).toBe('Sin permiso para tarifas.');
    expect(financeTariffMessage(new TypeError('offline'), { fallback: 'Sin conexión.' })).toBe('Sin conexión.');
    expect(financeTariffMessage(failure(400, 'invalid_finance_data'))).not.toMatch(/Invalid finance data/);
  });

  it('explains a retired package in the approval and in the package screens', () => {
    expect(financeContractApprovalMessage(failure(409, 'package_retired'))).toMatch(/Devuélvelo a Contratos para que lo quite/);
    // 2-N15: nothing is approved for a terminated contract or on or after its scheduled termination.
    expect(financeContractApprovalMessage(failure(409, 'contract_terminated'))).toMatch(/El contrato está terminado/);
    expect(financeContractApprovalMessage(failure(409, 'termination_scheduled'))).toMatch(/terminación programada/);
    expect(financePackageError(failure(409, 'package_retired'))).toMatch(/Finanzas retiró ese paquete/);
    expect(financePackageError(failure(409, 'package_not_draft'))).toMatch(/Solo se descarta un borrador/);
    expect(financePackageError(failure(409, 'package_not_published'))).toMatch(/Solo se retira la versión publicada/);
    expect(financePackageError(failure(400, 'reason_required'))).toMatch(/entre 5 y 500 caracteres/);
    expect(financePackageError(failure(403))).toBe('No tiene permiso para realizar esta operación de paquetes.');
    expect(financePackageError(failure(401))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    expect(financePackageError(new TypeError('offline'))).toBe('No se pudo completar la operación de paquetes. Intente de nuevo.');
    for (const text of Object.values(FINANCE_PACKAGE_MESSAGES)) expect(text).toMatch(/\S/);
  });
});

describe('Finance messages of the screens that address the user as tú (D-N36)', () => {
  it('explains the contract approval as tú', () => {
    expect(financeContractApprovalMessage(failure(409, 'idempotency_conflict')))
      .toBe('Esa decisión ya se envió con otros datos. Se actualizó la lista; revísala e intenta de nuevo.');
    expect(financeContractApprovalMessage(failure(400, 'invalid_contract_decision')))
      .toBe('Para devolver el contrato escribe un motivo de 3 a 1000 caracteres.');
    expect(financeContractApprovalMessage(failure(409, 'termination_scheduled')))
      .toBe('La versión empieza en la fecha de terminación programada del contrato o después. Devuélvela a Contratos.');
    expect(financeContractApprovalMessage(failure(401))).toBe('La sesión expiró. Vuelve a iniciar sesión.');
    expect(financeContractApprovalMessage(failure(403))).toBe('No tienes permiso para esta acción.');
    expect(CONTRACT_APPROVAL_MESSAGES).toMatchObject({
      package_not_eligible: 'Un paquete del contrato ya no corresponde a su moneda o vigencia. Devuélvelo a Contratos para que '
        + 'lo cambie.',
      service_retired: 'El contrato incluye un servicio dado de baja del catálogo. Devuélvelo a Contratos para que lo quite.',
      valid_from_not_after_current: 'La vigencia empieza antes que la versión aprobada vigente. Devuélvelo a Contratos para que '
        + 'la corrija.',
      ambiguous_package_coverage: 'Un servicio está cubierto por más de un paquete. Devuélvelo a Contratos.',
      package_service_not_in_contract: 'Un paquete cubre un servicio que el contrato no incluye. Devuélvelo a Contratos.',
      not_found: 'El contrato ya no está pendiente o no pertenece a tus estaciones.',
      contract_terminated: 'El contrato está terminado: sus precios ya no se aprueban. Devuélvelo a Contratos.',
    });
  });

  it('explains the tariff books and the charge catalog as tú, by their code', () => {
    expect(tariffBookMessage(failure(409, 'tariff_start_not_after_current')))
      .toBe('La vigencia debe empezar después de la versión vigente. Cambia «Vigente desde» y guarda.');
    expect(tariffBookMessage(failure(409, 'tariff_draft_exists'))).toBe('Ya hay un borrador en esa moneda. Ábrelo para continuar.');
    expect(tariffBookMessage(failure(400, 'tariff_empty'))).toBe('Añade al menos un precio y guarda antes de publicar.');
    expect(tariffBookMessage(failure(400, 'billing_unit_unknown')))
      .toBe('La unidad de cobro no existe o está inactiva. Elige una unidad de la lista.');
    expect(tariffBookMessage(failure(400, 'invalid_charge'))).toBe('Revisa el código, el nombre, el cálculo y la cantidad del cargo.');
    expect(tariffBookMessage(failure(409, 'charge_code_exists'))).toBe('Ya existe un cargo con ese código.');
    expect(tariffBookMessage(failure(409, 'version_conflict')))
      .toBe('El registro cambió mientras lo editabas. Se actualizó la vista; revisa los datos e intenta de nuevo.');
    expect(tariffBookMessage(failure(400, 'invalid_finance_data'))).toBe('Revisa los datos e intenta de nuevo.');
    expect(tariffBookMessage(failure(401))).toBe('La sesión expiró. Vuelve a iniciar sesión.');
    expect(tariffBookMessage(failure(403), { forbidden: 'Sin permiso para tarifas.' })).toBe('Sin permiso para tarifas.');
    expect(tariffBookMessage(new TypeError('offline'))).toBe('No se pudo completar la acción. Revisa la conexión e intenta de nuevo.');
    expect(tariffBookMessage(failure(400, 'invalid_finance_data'))).not.toMatch(/Invalid finance data/);
    for (const text of Object.values(TARIFF_BOOK_MESSAGES)) expect(text).toMatch(/\S/);
    expect(TARIFF_BOOK_MESSAGES).toMatchObject({
      billing_unit_required: 'Los cargos por unidad necesitan una unidad de cobro.',
      invalid_tariff: 'Revisa la vigencia, la nota y los precios de la tarifa.',
      tariff_not_found: 'La versión de origen ya no existe. Actualiza la vista.',
      service_not_found: 'Un servicio de la tarifa ya no existe en el catálogo. Actualiza la vista.',
      stations_invalid: 'Una estación de la tarifa ya no existe. Actualiza la vista.',
      charge_not_found: 'Un cargo de la tarifa ya no existe. Actualiza la vista.',
      not_found: 'El registro ya no existe. Actualiza la vista.',
    });
    // Billing units and exchange rates, not converted yet, keep their texts in usted.
    expect(financeTariffMessage(failure(409, 'tariff_start_not_after_current'))).toMatch(/Cambie «Vigente desde» y guarde\.$/);
    expect(financeTariffMessage(failure(401))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
  });

  it('explains the packages of a contract draft as tú, and keeps usted in Finanzas › Paquetes', () => {
    expect(contractPackageError(failure(409, 'package_retired')))
      .toBe('Finanzas retiró ese paquete: ya no se puede asignar. Quita esa selección y elige otro.');
    expect(contractPackageError(failure(400, 'ambiguous_package_coverage')))
      .toBe('Hay servicios cubiertos por más de un paquete. Selecciona una sola cobertura por servicio.');
    expect(contractPackageError(failure(409, 'package_not_eligible')))
      .toBe('Selecciona versiones publicadas en la moneda del contrato y vigentes durante todo el contrato.');
    expect(contractPackageError(failure(409, 'version_conflict')))
      .toBe('La versión cambió. Actualiza la vista y revisa los datos antes de guardar de nuevo.');
    expect(contractPackageError(failure(409, 'idempotency_conflict')))
      .toBe('La solicitud ya se utilizó con otros datos. Actualiza la vista antes de continuar.');
    expect(contractPackageError(failure(409, 'package_service_not_in_contract')))
      .toBe('Todos los servicios del paquete deben formar parte del contrato.');
    expect(contractPackageError(failure(404, 'not_found'))).toBe('La versión ya no está disponible. Actualiza la vista.');
    expect(contractPackageError(failure(400, 'invalid_selection'))).toBe('Revisa los datos e intenta de nuevo.');
    expect(contractPackageError(failure(403))).toBe('No tienes permiso para realizar esta operación de paquetes.');
    expect(contractPackageError(failure(401))).toBe('La sesión expiró. Vuelve a iniciar sesión.');
    expect(contractPackageError(new TypeError('offline'))).toBe('No se pudo completar la operación de paquetes. Intenta de nuevo.');
    for (const text of Object.values(CONTRACT_PACKAGE_MESSAGES)) expect(text).toMatch(/\S/);
    expect(financePackageError(failure(409, 'package_retired'))).toMatch(/Quite esa selección y elija otro\.$/);
  });
});

describe('the simplified Finance of phase 4 (block B)', () => {
  it('explains a retired legacy write by its code, wherever it shows (4-N12)', () => {
    for (const message of [financeHomeMessage, financeReportMessage, invoiceListMessage])
      expect(message(failure(410, 'legacy_finance_route_retired'))).toBe(FINANCE_LEGACY_MESSAGES.legacy_finance_route_retired);
    expect(FINANCE_LEGACY_MESSAGES.legacy_finance_route_retired).toMatch(/«Por facturar»/);
  });

  it('explains the reports, «Facturas» and «Inicio» by their codes (4-A, 4-N21)', () => {
    expect(financeReportMessage(failure(400, 'unknown_finance_report'))).toMatch(/Ese reporte ya no existe/);
    expect(financeReportMessage(failure(400, 'invalid_report_export_format'))).toMatch(/PDF o Excel/);
    expect(financeReportMessage(failure(400, 'invalid_report_export_format'))).not.toMatch(/CSV/);
    expect(financeReportMessage(failure(400, 'invalid_report_query'))).toMatch(/máximo son dos años/);
    expect(financeReportMessage(failure(403, 'forbidden'))).toBe('No tiene acceso a este reporte en las estaciones elegidas.');
    expect(invoiceListMessage(failure(400, 'invalid_invoice_query'))).toMatch(/hasta 40 caracteres/);
    expect(invoiceListMessage(failure(403, 'forbidden'))).toBe('No tiene permiso para consultar las facturas de esta estación.');
    expect(financeHomeMessage(failure(400, 'invalid_finance_home_query'))).toMatch(/estación elegida no es válida/);
    expect(financeHomeMessage(failure(403, 'forbidden'))).toMatch(/No tiene permiso para ver el resumen de Finanzas/);
    for (const map of [FINANCE_HOME_MESSAGES, FINANCE_REPORT_MESSAGES, INVOICE_LIST_MESSAGES])
      for (const text of Object.values(map)) expect(text).toMatch(/\S/);
  });

  it('never shows the server title of a failed report, list or home read', () => {
    for (const message of [financeHomeMessage, financeReportMessage, invoiceListMessage]) {
      expect(message(failure(500))).not.toMatch(/Invalid finance data/);
      expect(message(new TypeError('offline'))).toMatch(/Revise la conexión/);
      expect(message(failure(401))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    }
  });
});
