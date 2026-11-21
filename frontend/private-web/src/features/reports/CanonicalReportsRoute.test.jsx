import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import CanonicalReportsRoute, { defaultPeriod } from './CanonicalReportsRoute';
import { exportOccReport, getOccReport, listOccReports } from '../../services/occReportsService';
import { loadOccCoverage } from '../../services/occCoverageService';
import { getManualTurnaroundOptions } from '../../services/planningService';
import { downloadFile } from '../../utils/downloadFile';

const stationId = '20000000-0000-0000-0000-000000000001';
const airlineId = '30000000-0000-7000-8000-000000000001';
let access = null;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: [{ stationId, stationCode: 'PUJ' }] } }) }));
vi.mock('../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: () => access }));
vi.mock('../../services/occReportsService', () => ({ listOccReports: vi.fn(), getOccReport: vi.fn(), exportOccReport: vi.fn(),
  occReportFileName: (key, query, format, code) => `elevant-occ-${key}-${code}-${query.from}-${query.to}.${format}` }));
vi.mock('../../services/occCoverageService', () => ({ loadOccCoverage: vi.fn() }));
vi.mock('../../services/planningService', () => ({ getManualTurnaroundOptions: vi.fn() }));
vi.mock('../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));

const page = (number, hasMore) => ({ key: 'turnaround-times', title: 'Tiempos de turnaround', stationId, stationCode: 'PUJ',
  from: '2026-08-01', to: '2026-08-31', asOf: '2026-10-26T12:00:00Z', columns: ['Operación', 'Minutos reales'],
  rows: [[{ value: `OP-${number}`, type: 'text' }, { value: '1045', type: 'number' }]], page: number, limit: 25, hasMore });
const catalog = { maxRangeDays: 366, reports: [
  { key: 'operations', title: 'Operaciones del período', description: 'Cada operación.', columns: ['Fecha'],
    filters: [
      { key: 'airline', label: 'Aerolínea', parameter: 'airlineId', options: [] },
      { key: 'status', label: 'Estado', parameter: 'status', options: [{ code: 'Approved', label: 'Aprobada' }] },
    ] },
  { key: 'turnaround-times', title: 'Tiempos de turnaround', description: 'Planificado frente a real.', columns: ['Operación'] },
  { key: 'daily-close', title: 'Cierre diario', description: 'Al día.', columns: ['Fecha'], asOfDate: true },
] };
const IDLE = 'Elige el reporte, el período y los filtros, y pulsa «Generar».';

// A read that answers only when the test says so.
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

async function generateDefault() {
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
}

beforeEach(() => {
  access = { can: () => true };
  listOccReports.mockResolvedValue(catalog);
  getOccReport.mockImplementation(async (key, query) => page(query.page, query.page === 1));
  exportOccReport.mockResolvedValue(new Blob(['%PDF']));
  getManualTurnaroundOptions.mockResolvedValue({ airlines: [{ id: airlineId, iataCode: 'DM', name: 'Arajet' }] });
  loadOccCoverage.mockResolvedValue({ agents: [], terminals: [] });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('generates a server report for a custom period, pages it and downloads PDF and Excel', async () => {
  render(<CanonicalReportsRoute />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Reporte' }), 'turnaround-times');
  expect(screen.getByText('Planificado frente a real.')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Desde'));
  await userEvent.type(screen.getByLabelText('Desde'), '2026-08-01');
  await userEvent.clear(screen.getByLabelText('Hasta'));
  await userEvent.type(screen.getByLabelText('Hasta'), '2026-08-31');
  expect(screen.getByRole('button', { name: 'Personalizado' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));

  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Operación', 'Minutos reales']);
  expect(within(table).getByRole('cell', { name: '1,045' })).toHaveClass('text-right', 'tabular-nums');
  expect(getOccReport).toHaveBeenCalledWith('turnaround-times',
    { stationId, from: '2026-08-01', to: '2026-08-31', page: 1, limit: 25 }, expect.anything());
  expect(screen.getByText('Filtros aplicados: Estación PUJ · Período 01/08/2026 – 31/08/2026')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(await screen.findByText('OP-2')).toBeInTheDocument();

  for (const [label, format] of [['Descargar PDF', 'pdf'], ['Descargar Excel', 'xlsx']]) {
    await userEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(exportOccReport).toHaveBeenLastCalledWith('turnaround-times',
      { stationId, from: '2026-08-01', to: '2026-08-31' }, format));
    await waitFor(() => expect(downloadFile).toHaveBeenLastCalledWith(expect.any(Blob),
      `elevant-occ-turnaround-times-PUJ-2026-08-01-2026-08-31.${format}`));
  }
  expect(screen.queryByText(/CSV/)).not.toBeInTheDocument();
});

it('offers the period shortcuts of the station calendar', async () => {
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  const period = screen.getByRole('group', { name: 'Período' });
  expect(within(period).getAllByRole('button').map(button => button.textContent))
    .toEqual(['Hoy', 'Últimos 7 días', 'Este mes', 'Mes anterior', 'Personalizado']);
  expect(within(period).getByRole('button', { name: 'Este mes' })).toHaveAttribute('aria-pressed', 'true');
  await userEvent.click(within(period).getByRole('button', { name: 'Hoy' }));
  expect(screen.getByLabelText('Desde')).toHaveValue(screen.getByLabelText('Hasta').value);
});

it('filters by the report own filters and names them in «Filtros aplicados»', async () => {
  render(<CanonicalReportsRoute />);
  const airline = await screen.findByRole('combobox', { name: 'Aerolínea' });
  await screen.findByRole('option', { name: 'Arajet (DM)' });
  await userEvent.selectOptions(airline, airlineId);
  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Estado' }), 'Approved');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByRole('table');
  expect(getOccReport.mock.calls[0][1]).toMatchObject({ airlineId, status: 'Approved' });
  expect(screen.getByText(/Filtros aplicados: Estación PUJ · Período .* · Aerolínea Arajet \(DM\) · Estado Aprobada/))
    .toBeInTheDocument();
});

it('leaves out a filter whose options the account cannot read', async () => {
  getManualTurnaroundOptions.mockRejectedValue(Object.assign(new Error('Sin acceso'), { status: 403 }));
  render(<CanonicalReportsRoute />);
  await screen.findByRole('combobox', { name: 'Estado' });
  await waitFor(() => expect(getManualTurnaroundOptions).toHaveBeenCalled());
  expect(screen.queryByRole('combobox', { name: 'Aerolínea' })).not.toBeInTheDocument();
});

it('hides «Desde» and the shortcuts in a cut-off report', async () => {
  render(<CanonicalReportsRoute />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Reporte' }), 'daily-close');
  expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  expect(screen.queryByRole('group', { name: 'Período' })).not.toBeInTheDocument();
  expect(screen.getByLabelText('Fecha de corte')).toBeInTheDocument();
});

it('shows the server summary with its context and the totals of the period', async () => {
  getOccReport.mockResolvedValueOnce({ ...page(1, false), generatedBy: 'Ana Pérez', totalRows: 1, columnTypes: ['text', 'duration'],
    summary: [{ label: 'Operaciones', value: '1', context: 'de 40 del mes (2.5 %)' }],
    totals: [{ label: 'Total', cells: [{ value: 'Total', type: 'text' }, { value: '1045', type: 'number' }] }],
    appliedFilters: [] });
  render(<CanonicalReportsRoute />);
  await generateDefault();
  const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
  expect(within(panel).getByText('Generado el 26/10/2026 08:00 por Ana Pérez')).toBeInTheDocument();
  expect(within(panel).getByText('1 fila en el período')).toBeInTheDocument();
  expect(within(panel).getByLabelText('Resumen del reporte')).toHaveTextContent('de 40 del mes (2.5 %)');
  expect(within(panel).getByRole('cell', { name: '17:25' })).toBeInTheDocument();
  expect(within(panel).getByLabelText('Total')).toHaveTextContent('Minutos reales: 17:25');
});

it('hides the downloads without «Exportar» and shows server problems', async () => {
  access = { can: code => code !== 'operations.reports.export' };
  render(<CanonicalReportsRoute />);
  await generateDefault();
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /Descargar/ })).not.toBeInTheDocument();

  getOccReport.mockRejectedValueOnce(Object.assign(new Error('Tu acceso no incluye los reportes de esta estación.'), { status: 403 }));
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no incluye');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('explains an oversized download by its code: a PDF points to Excel (3-N13)', async () => {
  render(<CanonicalReportsRoute />);
  await generateDefault();
  await screen.findByRole('table');
  exportOccReport.mockRejectedValueOnce(Object.assign(new Error('El reporte supera el máximo de filas exportables.'),
    { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El PDF admite hasta 5 000 filas: descarga el Excel o acota el período y los filtros.');
  exportOccReport.mockRejectedValueOnce(Object.assign(new Error('El reporte supera el máximo de filas exportables.'),
    { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar Excel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se pudo descargar: El reporte supera el máximo de filas exportables.');
});

it('says why a period cannot be generated', async () => {
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.clear(screen.getByLabelText('Desde'));
  await userEvent.type(screen.getByLabelText('Desde'), '2025-01-01');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('El período admite hasta 366 días');
  expect(getOccReport).not.toHaveBeenCalled();
});

it('defaults to the current month of the station calendar, not the browser UTC one', () => {
  expect(defaultPeriod(new Date('2026-10-26T16:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-26' });
  // 22:30 on 31 October in Punta Cana is already 1 November in UTC.
  expect(defaultPeriod(new Date('2026-11-01T02:30:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
});

it('says when the report was generated in the station local time (3-N26)', async () => {
  render(<CanonicalReportsRoute />);
  await generateDefault();
  await screen.findByRole('table');
  // asOf is 2026-10-26T12:00:00Z: 08:00 in Punta Cana.
  expect(screen.getByText('Generado el 26/10/2026 08:00')).toBeInTheDocument();
});

it('says the list of reports is on its way until it arrives', async () => {
  const pending = deferred();
  listOccReports.mockReturnValueOnce(pending.promise);
  render(<CanonicalReportsRoute />);
  const loading = screen.getByRole('status');
  expect(loading).toHaveTextContent('Cargando reportes…');
  expect(loading).toHaveAttribute('data-occ-skeleton', 'text');
  const toolbar = screen.getByRole('toolbar', { name: 'Reporte y filtros' });
  expect(toolbar).not.toContainElement(loading);
  expect(screen.queryByText(IDLE)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();

  await act(async () => pending.resolve(catalog));
  expect(await screen.findByText(IDLE)).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeEnabled();
  expect(getOccReport).not.toHaveBeenCalled();
});

it('shows the downloads in the panel header and the pagination in its footer', async () => {
  render(<CanonicalReportsRoute />);
  expect(await screen.findByText(IDLE)).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: 'Reporte' });
  await userEvent.selectOptions(select, 'turnaround-times');
  expect(select).toHaveAccessibleDescription('Planificado frente a real.');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));

  const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
  const table = await within(panel).findByRole('table', { name: 'Tiempos de turnaround' });
  const header = within(panel).getByRole('heading', { level: 2, name: 'Tiempos de turnaround' }).parentElement;
  expect(within(header).getAllByRole('button').map(button => button.textContent)).toEqual(['Descargar PDF', 'Descargar Excel']);
  expect(within(header).getByText('Página 1, 1 fila')).toBeInTheDocument();
  const pages = within(panel).getByRole('navigation', { name: 'Páginas del reporte' });
  expect(table.compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(pages).getByRole('button', { name: 'Anterior' })).toBeDisabled();

  // A download on its way says so on its own button and holds the other until it ends.
  let finish;
  exportOccReport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await userEvent.click(within(header).getByRole('button', { name: 'Descargar Excel' }));
  expect(within(header).getByRole('button', { name: 'Preparando…' })).toHaveAttribute('aria-busy', 'true');
  expect(within(header).getByRole('button', { name: 'Descargar PDF' })).toBeDisabled();
  await act(async () => finish(new Blob(['x'])));
  expect(within(header).getByRole('button', { name: 'Descargar Excel' })).toBeEnabled();
});

it('says an empty page in its body and keeps only the generation time in its header', async () => {
  getOccReport.mockResolvedValueOnce({ ...page(1, false), rows: [] });
  render(<CanonicalReportsRoute />);
  await generateDefault();
  const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
  expect(await within(panel).findByText('No hay datos para este reporte con los filtros aplicados.')).toBeInTheDocument();
  expect(within(panel).getByText(/^Generado el /)).toBeInTheDocument();
  expect(within(panel).queryByText(/^Página/)).not.toBeInTheDocument();
  for (const name of ['Descargar PDF', 'Descargar Excel']) expect(within(panel).getByRole('button', { name })).toBeDisabled();
  expect(within(panel).queryByRole('navigation', { name: 'Páginas del reporte' })).not.toBeInTheDocument();
});

it('offers a retry when the list of reports could not be read', async () => {
  listOccReports.mockRejectedValueOnce(Object.assign(new Error('No se pudo generar el reporte. Intenta nuevamente.'),
    { status: 500 }));
  render(<CanonicalReportsRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el reporte. Intenta nuevamente.');
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeDisabled();
  const pending = deferred();
  listOccReports.mockReturnValueOnce(pending.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(screen.getByRole('status')).toHaveTextContent('Cargando reportes…');
  await act(async () => pending.resolve(catalog));
  expect(await screen.findByText(IDLE)).toBeInTheDocument();
  expect(listOccReports).toHaveBeenCalledTimes(2);
});

describe('CanonicalReportsRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('generates a report in English inside the OCC scope', async () => {
    act(() => resetLanguageForTests('en'));
    render(<LanguageScope><CanonicalReportsRoute /></LanguageScope>);
    expect(screen.getByRole('heading', { level: 1, name: 'Operational reports' })).toBeInTheDocument();
    expect(await screen.findByText('Choose the report, the period and the filters, then press “Generate”.')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Period' })).toHaveTextContent('Last 7 days');
    // The report titles are the server's.
    await screen.findByRole('option', { name: 'Operaciones del período' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
    await within(panel).findByRole('table');
    expect(within(panel).getByText('Page 1, 1 row')).toBeInTheDocument();
    expect(within(panel).getByText('Generated 10/26/2026 08:00')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Download Excel' })).toBeInTheDocument();
    expect(within(panel).getByText(/^Applied filters: Station PUJ · Period /)).toBeInTheDocument();
    expect(screen.queryByText(/Reportes operativos|Generar|Descargar|Página|Anterior|Siguiente/)).toBeNull();
  });
});
