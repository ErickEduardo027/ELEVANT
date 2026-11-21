import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReportFilterBar from './ReportFilterBar';
import ServerReportResult from './ServerReportResult';
import { useServerReport } from '../../features/reports/useServerReport';
import { downloadFile } from '../../utils/downloadFile';

vi.mock('../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));

const catalog = { maxRangeDays: 366, reports: [
  { key: 'revenue', title: 'Ingresos por período', description: 'Facturado por mes.' },
  { key: 'receivables', title: 'Cuentas por cobrar', description: 'Saldo pendiente.', asOfDate: true },
] };
const data = { title: 'Ingresos por período', asOf: '2026-11-21T14:30:00Z', generatedBy: 'Ana Pérez',
  columns: [{ label: 'Aerolínea', type: 'text' }, { label: 'Facturas', type: 'number' },
    { label: 'Total', type: 'money', currencyOf: () => 'USD' }],
  rows: [['Arajet', '3', '1200.5'], ['JetBlue', '5', '800']], page: 1, hasMore: false,
  summary: [{ label: 'Facturas emitidas', value: '8', context: 'de 50 facturas este mes' }],
  appliedFilters: [], notes: ['Consolidado en USD.'] };

let source;
function Screen() {
  const report = useServerReport({ source, initialKey: 'revenue', today: '2026-11-21', initialValues: {},
    describe: () => [{ label: 'Estación', value: 'Todas tus estaciones', base: true }] });
  return <><ReportFilterBar report={report} /><ServerReportResult report={report} /></>;
}

beforeEach(() => {
  source = { paged: false, loadCatalog: vi.fn(async () => catalog), loadPage: vi.fn(async () => data),
    exportReport: vi.fn(async () => new Blob(['x'])), fileName: (key, query, format) => `elevant-${key}.${format}` };
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('generates the report with its context, totals and both downloads in its header', async () => {
  render(<Screen />);
  expect(await screen.findByText('Elige el reporte y los filtros, y pulsa «Generar».')).toBeInTheDocument();
  expect(screen.getByLabelText('Período')).toHaveValue('thisMonth');
  await userEvent.selectOptions(screen.getByLabelText('Período'), 'last7');
  expect(screen.getByLabelText('Desde')).toHaveValue('2026-11-15');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));

  const result = await screen.findByRole('region', { name: 'Ingresos por período' });
  expect(within(result).getByText('Generado el 21/11/2026 10:30 por Ana Pérez')).toBeInTheDocument();
  expect(within(result).getByText(
    'Filtros aplicados: Estación Todas tus estaciones · Período 15/11/2026 – 21/11/2026')).toBeInTheDocument();
  expect(within(result).getByText('2 filas en el período')).toBeInTheDocument();
  const metrics = within(result).getByLabelText('Resumen del reporte');
  expect(metrics).toHaveTextContent('Facturas emitidas8de 50 facturas este mes');
  const table = within(result).getByRole('table', { name: 'Ingresos por período' });
  expect(within(table).getByRole('cell', { name: 'USD 1,200.50' })).toHaveClass('text-right');
  const footer = table.querySelector('tfoot');
  expect([...footer.querySelectorAll('td')].map(cell => cell.textContent)).toEqual(['Total', '8', 'USD 2,000.50']);
  expect(within(result).getByText('Consolidado en USD.')).toBeInTheDocument();

  const downloads = within(result).getByRole('group', { name: 'Descargas del reporte' });
  expect(within(downloads).getAllByRole('button').map(button => button.textContent)).toEqual(['Descargar PDF', 'Descargar Excel']);
  expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
  await userEvent.click(within(downloads).getByRole('button', { name: 'Descargar Excel' }));
  await waitFor(() => expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'elevant-revenue.xlsx'));
});

it('hides «Desde» in a cut-off report and asks only for its date', async () => {
  render(<Screen />);
  await userEvent.selectOptions(await screen.findByLabelText('Reporte'), 'receivables');
  expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  expect(screen.queryByLabelText('Período')).not.toBeInTheDocument();
  expect(screen.getByLabelText('Fecha de corte')).toHaveValue('2026-11-21');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await waitFor(() => expect(source.loadPage).toHaveBeenCalledWith('receivables', { from: '2026-11-21', to: '2026-11-21' },
    expect.anything()));
  expect(await screen.findByText(/Fecha de corte 21\/11\/2026/)).toBeInTheDocument();
});

it('explains an oversized PDF and a refusal without retry', async () => {
  render(<Screen />);
  await userEvent.click(await screen.findByRole('button', { name: 'Generar' }));
  await screen.findByRole('region', { name: 'Ingresos por período' });
  source.exportReport.mockRejectedValueOnce(Object.assign(new Error('x'), { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El PDF admite hasta 5 000 filas');

  source.loadPage.mockRejectedValueOnce(Object.assign(new Error('No tienes acceso a este reporte.'), { status: 403 }));
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso a este reporte.');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('says why the period cannot be generated', async () => {
  render(<Screen />);
  await screen.findByLabelText('Reporte');
  await userEvent.clear(screen.getByLabelText('Desde'));
  await userEvent.type(screen.getByLabelText('Desde'), '2026-11-30');
  expect(screen.getByLabelText('Período')).toHaveValue('custom');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('«Desde» no puede ser posterior a «Hasta».');
  expect(source.loadPage).not.toHaveBeenCalled();
});
