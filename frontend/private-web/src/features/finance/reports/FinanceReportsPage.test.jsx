import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FinanceReportsPage from './FinanceReportsPage';
import { normalizeFinanceReport } from './financeReportSource';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { exportFinanceReport, getFinanceReport, listFinanceReports } from '../../../services/financeBookService';
import { getTreasuryOptions } from '../../../services/financeTreasuryService';
import { downloadFile } from '../../../utils/downloadFile';

vi.mock('../../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  listFinanceReports: vi.fn(),
  getFinanceReport: vi.fn(),
  exportFinanceReport: vi.fn(),
}));
vi.mock('../../../services/financeTreasuryService', () => ({ getTreasuryOptions: vi.fn() }));
vi.mock('../../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));
vi.mock('../../auth/authService', () => ({ readSession: () => ({ name: 'Marta Ruiz',
  stationScopes: [{ stationId: 'st-1', stationCode: 'PUJ' }, { stationId: 'st-2', stationCode: 'SDQ' }] }) }));

const REPORTS = [
  { key: 'revenue', title: 'Ingresos por período', description: 'Facturado por mes.' },
  { key: 'receivables', title: 'Cuentas por cobrar y antigüedad', description: 'Saldo pendiente.', asOfDate: true },
  { key: 'collections', title: 'Cobranza', description: 'Cobros.' },
  { key: 'payables', title: 'Cuentas por pagar', description: 'Proveedores.', asOfDate: true },
  { key: 'charges', title: 'Recargos', description: 'Cargos.' },
  { key: 'sales', title: 'Ventas (e-CF simulado)', description: 'Ventas.' },
];
const revenue = {
  key: 'revenue', title: 'Ingresos por período', description: 'Facturado por mes.', from: '2026-10-01', to: '2026-10-08',
  consolidationCurrency: 'USD',
  summary: [{ label: 'Facturas emitidas', value: '8', type: 'number', context: 'de 50 facturas este mes' },
    { label: '% cobrado', value: '62.5678', type: 'percent' }],
  columns: [{ key: 'month', label: 'Mes', type: 'text' }, { key: 'currency', label: 'Moneda', type: 'text' },
    { key: 'invoices', label: 'Facturas', type: 'number' }, { key: 'total', label: 'Total', type: 'money' },
    { key: 'usd', label: 'Total USD', type: 'money' }],
  rows: [['2026-10', 'DOP', '3', '58500.00', '1000.00'], ['2026-10', 'USD', '5', '500.00', '500.00']],
  notes: ['Nota de prueba.'],
};
const airlineId = '30000000-0000-7000-8000-000000000001';

function renderPage(codes = DepartmentPermissionCodes.finance) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', codes)}>
    <FinanceReportsPage initialStationId="st-1" /></DepartmentAccessProvider>);
}

beforeEach(() => {
  listFinanceReports.mockResolvedValue(REPORTS);
  getFinanceReport.mockResolvedValue(revenue);
  exportFinanceReport.mockResolvedValue(new Blob(['%PDF']));
  getTreasuryOptions.mockResolvedValue({ airlines: [{ id: airlineId, name: 'Arajet' }], stations: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('FinanceReportsPage', () => {
  it('formats money with the row currency, consolidated columns in USD and percentages with one decimal', () => {
    const report = normalizeFinanceReport(revenue);
    expect(report.columns[3].currencyOf(revenue.rows[0])).toBe('DOP');
    expect(report.columns[4].currencyOf(revenue.rows[0])).toBe('USD');
    expect(report.summary).toEqual([{ label: 'Facturas emitidas', value: '8', context: 'de 50 facturas este mes' },
      { label: '% cobrado', value: '62.6 %', context: null }]);
  });

  it('reads the report for the station of the shell and shows it with context, totals and both downloads', async () => {
    renderPage();
    const result = await screen.findByRole('region', { name: 'Ingresos por período' });
    expect(getFinanceReport).toHaveBeenCalledWith('revenue', expect.objectContaining({ stationId: 'st-1' }));
    expect(within(result).getByText(/^Generado el .* por Marta Ruiz$/)).toBeInTheDocument();
    expect(within(result).getByText(/^Filtros aplicados: Estación PUJ · Período /)).toBeInTheDocument();
    expect(within(result).getByText('2 filas en el período')).toBeInTheDocument();
    expect(within(result).getByLabelText('Resumen del reporte')).toHaveTextContent('de 50 facturas este mes');
    const table = within(result).getByRole('table');
    expect(within(table).getByRole('cell', { name: 'DOP 58,500.00' })).toHaveClass('text-right');
    // «Total» mixes DOP and USD: only «Facturas» and «Total USD» add up.
    expect([...table.querySelectorAll('tfoot td')].map(cell => cell.textContent))
      .toEqual(['Total', '', '8', '', 'USD 1,500.00']);
    expect(within(result).getByText('Nota de prueba.')).toBeInTheDocument();
    await userEvent.click(within(result).getByRole('button', { name: 'Descargar PDF' }));
    await waitFor(() => expect(exportFinanceReport).toHaveBeenCalledWith('revenue', 'pdf', expect.objectContaining({ stationId: 'st-1' })));
    expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), expect.stringMatching(/^elevant-revenue-.*\.pdf$/));
    expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
  });

  it('filters by airline, station and currency, and names them as the server does', async () => {
    getFinanceReport.mockResolvedValue({ ...revenue, filters: [{ label: 'Aerolínea', value: 'Arajet' }, { label: 'Moneda', value: 'USD' }] });
    renderPage();
    await screen.findByRole('region', { name: 'Ingresos por período' });
    await userEvent.selectOptions(await screen.findByLabelText('Aerolínea'), airlineId);
    await userEvent.selectOptions(screen.getByLabelText('Estación'), 'st-2');
    await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'USD');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await waitFor(() => expect(getFinanceReport).toHaveBeenLastCalledWith('revenue',
      expect.objectContaining({ stationId: 'st-2', airlineId, currency: 'USD' })));
    expect(await screen.findByText(/Estación SDQ · Período .* · Aerolínea Arajet · Moneda USD$/)).toBeInTheDocument();
  });

  it('leaves out the airline filter when the account cannot read the airlines', async () => {
    getTreasuryOptions.mockRejectedValue(Object.assign(new Error('x'), { status: 403 }));
    renderPage();
    await screen.findByRole('region', { name: 'Ingresos por período' });
    expect(screen.queryByLabelText('Aerolínea')).not.toBeInTheDocument();
  });

  it('asks a cut-off report only for its date', async () => {
    renderPage();
    await screen.findByRole('region', { name: 'Ingresos por período' });
    await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'receivables');
    expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
    const date = screen.getByLabelText('Fecha de corte').value;
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await waitFor(() => expect(getFinanceReport).toHaveBeenLastCalledWith('receivables',
      expect.objectContaining({ from: date, to: date })));
  });

  it('offers exactly the six reports of the simplified Finance (4-A)', async () => {
    renderPage();
    const select = await screen.findByLabelText('Reporte');
    await waitFor(() => expect(within(select).getAllByRole('option')).toHaveLength(6));
    expect(within(select).getAllByRole('option').map(option => option.textContent)).toEqual(REPORTS.map(item => item.title));
  });

  it('hides the downloads without the export permission and shows a refused read without retry', async () => {
    getFinanceReport.mockRejectedValue(Object.assign(new Error('Finance report access is forbidden.'), { status: 403, code: 'forbidden' }));
    renderPage(['finance.reports.read']);
    expect(await screen.findByRole('alert')).toHaveTextContent('No tiene acceso a este reporte en las estaciones elegidas.');
    expect(screen.queryByText(/forbidden/)).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();
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
  });

  it('explains a refused download and keeps the report on screen', async () => {
    exportFinanceReport.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 403 }));
    renderPage();
    await screen.findByText('Nota de prueba.');
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo descargar el Excel: No tienes permiso para descargar este reporte.');
    expect(screen.getByText('Nota de prueba.')).toBeInTheDocument();
  });

  it('ignores a stale answer after another report is generated', async () => {
    let resolveOld;
    getFinanceReport.mockImplementation(key => (key === 'revenue' ? Promise.resolve(revenue)
      : key === 'payables' ? new Promise(resolve => { resolveOld = resolve; })
        : Promise.resolve({ ...revenue, key: 'sales', title: 'Ventas (e-CF simulado)', notes: ['Sales separate'] })));
    renderPage();
    await screen.findByText('Nota de prueba.');
    await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'payables');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'sales');
    await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
    expect(await screen.findByText('Sales separate')).toBeInTheDocument();
    resolveOld({ ...revenue, key: 'payables', notes: ['Stale payable response'] });
    await waitFor(() => expect(screen.queryByText('Stale payable response')).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
    await waitFor(() => expect(exportFinanceReport).toHaveBeenLastCalledWith('sales', 'xlsx', expect.any(Object)));
  });
});
