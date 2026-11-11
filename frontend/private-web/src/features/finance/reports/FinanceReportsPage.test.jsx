import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceReportsPage, { formatCell } from './FinanceReportsPage';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { downloadFinanceReport, getFinanceReport } from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  getFinanceReport: vi.fn(),
  downloadFinanceReport: vi.fn().mockResolvedValue(undefined),
}));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }] }) }));

const revenue = {
  key: 'revenue', title: 'Ingresos por período', description: 'Facturado por mes.', from: '2026-10-01', to: '2026-10-08',
  consolidationCurrency: 'USD', summary: [{ label: 'Consolidado USD', value: '1500.00', type: 'money', currencyCode: 'USD' }],
  columns: [{ key: 'month', label: 'Mes', type: 'text' }, { key: 'currency', label: 'Moneda', type: 'text' },
    { key: 'total', label: 'Total', type: 'money' }, { key: 'usd', label: 'Total USD', type: 'money' }],
  rows: [['2026-10', 'DOP', '58500.00', '1000.00']], notes: ['Nota de prueba.'],
};

function renderPage(codes = DepartmentPermissionCodes.finance) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>
    <FinanceReportsPage initialStationId="st-1" /></DepartmentAccessProvider>);
}

afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FinanceReportsPage', () => {
  it('formats money with the row currency and consolidated columns in USD', () => {
    expect(formatCell('58500.00', revenue.columns[2], revenue.rows[0], revenue.columns)).toMatch(/^DOP 58[.,]500/);
    expect(formatCell('1000.00', revenue.columns[3], revenue.rows[0], revenue.columns)).toMatch(/^USD 1[.,]000/);
    expect(formatCell(null, revenue.columns[2], revenue.rows[0], revenue.columns)).toBe('—');
  });

  it('reads the selected server report with the filters and exports it', async () => {
    getFinanceReport.mockResolvedValue(revenue);
    renderPage();
    expect(await screen.findByText('Nota de prueba.')).toBeInTheDocument();
    expect(getFinanceReport).toHaveBeenCalledWith('revenue', expect.objectContaining({ stationId: 'st-1' }));
    expect(within(screen.getByRole('table')).getByText('2026-10')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
    expect(downloadFinanceReport).toHaveBeenCalledWith('revenue', 'pdf', expect.objectContaining({ stationId: 'st-1' }));
    getFinanceReport.mockResolvedValue({ ...revenue, key: 'receivables', rows: [], notes: [] });
    await userEvent.click(screen.getByRole('tab', { name: 'Cuentas por cobrar y antigüedad' }));
    expect(await screen.findByText('Sin datos')).toBeInTheDocument();
    expect(getFinanceReport).toHaveBeenLastCalledWith('receivables', expect.any(Object));
  });

  it('hides export without the export permission and shows a forbidden read as unauthorized, without retry', async () => {
    getFinanceReport.mockRejectedValue(Object.assign(new Error('Finance report access is forbidden.'), { status: 403, code: 'forbidden' }));
    renderPage(['finance.reports.read']);
    expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso a este reporte en las estaciones elegidas.');
    expect(screen.queryByText(/forbidden/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Exportar CSV' })).not.toBeInTheDocument();
  });

  it('offers exactly the six reports of the simplified Finance (4-A)', async () => {
    getFinanceReport.mockResolvedValue(revenue);
    renderPage(); await screen.findByText('Nota de prueba.');
    expect(screen.getAllByRole('tab').map(tab => tab.textContent)).toEqual(['Ingresos por período',
      'Cuentas por cobrar y antigüedad', 'Cobranza', 'Cuentas por pagar', 'Recargos', 'Ventas (e-CF simulado)']);
    for (const retired of ['Pipeline de facturación', 'Disputas', 'Estado fiscal', 'Simulación fiscal', 'Notas de crédito'])
      expect(screen.queryByRole('tab', { name: retired })).not.toBeInTheDocument();
  });

  it('explains a refused report by its code in Spanish and retries it', async () => {
    getFinanceReport.mockRejectedValueOnce(Object.assign(new Error('Unknown finance report.'), { status: 400, code: 'unknown_finance_report' }))
      .mockResolvedValueOnce(revenue);
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese reporte ya no existe en Finanzas. Elija uno de la lista.');
    expect(screen.queryByText('Unknown finance report.')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Nota de prueba.')).toBeInTheDocument();
    expect(getFinanceReport).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('explains a refused export by its code and keeps the report on screen', async () => {
    getFinanceReport.mockResolvedValue(revenue);
    downloadFinanceReport.mockRejectedValueOnce(Object.assign(new Error('Unknown export format.'), { status: 400, code: 'invalid_report_export_format' }));
    renderPage(); await screen.findByText('Nota de prueba.');
    await userEvent.click(screen.getByRole('button', { name: 'Exportar CSV' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Ese formato de exportación no existe. Exporte en CSV, Excel o PDF.');
    expect(screen.getByText('Nota de prueba.')).toBeInTheDocument();
  });

  it.each([
    ['revenue', 'Ingresos por período'], ['receivables', 'Cuentas por cobrar y antigüedad'], ['collections', 'Cobranza'],
    ['payables', 'Cuentas por pagar'], ['charges', 'Recargos'], ['sales', 'Ventas (e-CF simulado)'],
  ])('loads and exports %s through the CSV, Excel and PDF pipeline', async (key, label) => {
    getFinanceReport.mockImplementation(async selected => ({ ...revenue, key: selected }));
    renderPage(); await screen.findByText('Nota de prueba.');
    await userEvent.click(screen.getByRole('tab', { name: label }));
    await waitFor(() => expect(getFinanceReport).toHaveBeenLastCalledWith(key, expect.objectContaining({ stationId: 'st-1' })));
    await screen.findByText('Nota de prueba.');
    for (const [format, button] of [['csv', 'Exportar CSV'], ['xlsx', 'Exportar Excel'], ['pdf', 'Exportar PDF']]) {
      await userEvent.click(screen.getByRole('button', { name: button }));
      expect(downloadFinanceReport).toHaveBeenLastCalledWith(key, format, expect.objectContaining({ stationId: 'st-1' }));
    }
  });

  it('formats invoice applications in invoice currency and frozen payable totals in DOP', () => {
    const columns = [{ key: 'currency', type: 'text' }, { key: 'invoiceCurrency', type: 'text' },
      { key: 'invoiceAmount', type: 'money' }, { key: 'dop', type: 'money' }];
    const row = ['USD', 'DOP', '6000', '30000'];
    expect(formatCell(row[2], columns[2], row, columns)).toMatch(/^DOP 6[.,]000/);
    expect(formatCell(row[3], columns[3], row, columns)).toMatch(/^DOP 30[.,]000/);
  });

  it('disables export while a report is loading and ignores stale responses', async () => {
    let resolveOld;
    let resolveLatest;
    getFinanceReport.mockImplementation(key => key === 'revenue' ? Promise.resolve(revenue)
      : key === 'payables' ? new Promise(resolve => { resolveOld = resolve; })
        : new Promise(resolve => { resolveLatest = resolve; }));
    renderPage(); await screen.findByText('Nota de prueba.');
    await userEvent.click(screen.getByRole('tab', { name: 'Cuentas por pagar' }));
    expect(screen.getByRole('button', { name: 'Exportar Excel' })).toBeDisabled();
    await userEvent.click(screen.getByRole('tab', { name: 'Ventas (e-CF simulado)' }));
    resolveOld({ ...revenue, key: 'payables', notes: ['Stale payable response'] });
    resolveLatest({ ...revenue, key: 'sales', notes: ['Sales separate'] });
    await screen.findByText('Sales separate');
    expect(screen.queryByText('Stale payable response')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
    expect(downloadFinanceReport).toHaveBeenLastCalledWith('sales', 'xlsx', expect.any(Object));
  });
});
