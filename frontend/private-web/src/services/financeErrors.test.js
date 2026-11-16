import { describe, expect, it } from 'vitest';
import {
  FINANCE_HOME_MESSAGES, FINANCE_LEGACY_MESSAGES, FINANCE_REPORT_MESSAGES, FINANCE_TARIFF_MESSAGES, INVOICE_LIST_MESSAGES,
  financeContractApprovalMessage, financeHomeMessage, financeReportMessage, financeTariffMessage, invoiceListMessage,
} from './financeErrors';
import { FINANCE_PACKAGE_MESSAGES, financePackageError } from './financePackagesService';

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
    expect(financeContractApprovalMessage(failure(409, 'package_retired'))).toMatch(/Devuélvalo a Contratos para que lo quite/);
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

describe('the simplified Finance of phase 4 (block B)', () => {
  it('explains a retired legacy write by its code, wherever it shows (4-N12)', () => {
    for (const message of [financeHomeMessage, financeReportMessage, invoiceListMessage])
      expect(message(failure(410, 'legacy_finance_route_retired'))).toBe(FINANCE_LEGACY_MESSAGES.legacy_finance_route_retired);
    expect(FINANCE_LEGACY_MESSAGES.legacy_finance_route_retired).toMatch(/«Por facturar»/);
  });

  it('explains the reports, «Facturas» and «Inicio» by their codes (4-A, 4-N21)', () => {
    expect(financeReportMessage(failure(400, 'unknown_finance_report'))).toMatch(/Ese reporte ya no existe/);
    expect(financeReportMessage(failure(400, 'invalid_report_export_format'))).toMatch(/CSV, Excel o PDF/);
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
