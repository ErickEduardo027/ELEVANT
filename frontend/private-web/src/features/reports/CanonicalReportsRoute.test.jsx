import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { LanguageScope } from '../../i18n/LanguageScope';
import { resetLanguageForTests } from '../../i18n/languageStore';
import CanonicalReportsRoute, { defaultPeriod } from './CanonicalReportsRoute';
import { downloadOccReport, getOccReport, listOccReports } from '../../services/occReportsService';

const stationId = '20000000-0000-0000-0000-000000000001';
let access = null;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: [{ stationId, stationCode: 'PUJ' }] } }) }));
vi.mock('../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: () => access }));
vi.mock('../../services/occReportsService', () => ({ listOccReports: vi.fn(), getOccReport: vi.fn(), downloadOccReport: vi.fn() }));

const page = (number, hasMore) => ({ key: 'turnaround-times', title: 'Tiempos de turnaround', stationId, stationCode: 'PUJ',
  from: '2026-08-01', to: '2026-08-31', asOf: '2026-10-26T12:00:00Z', columns: ['Operación', 'Minutos reales'],
  rows: [[{ value: `OP-${number}`, type: 'text' }, { value: '45', type: 'number' }]], page: number, limit: 25, hasMore });
const catalog = { maxRangeDays: 366, reports: [
  { key: 'operations', title: 'Operaciones del período', description: 'Cada operación.', columns: ['Fecha'] },
  { key: 'turnaround-times', title: 'Tiempos de turnaround', description: 'Planificado frente a real.', columns: ['Operación'] },
] };
const IDLE = 'Elige el reporte y el período, y pulsa «Generar».';

// A read that answers only when the test says so.
function deferred() {
  let resolve;
  const promise = new Promise(done => { resolve = done; });
  return { promise, resolve };
}

beforeEach(() => {
  access = { can: () => true };
  listOccReports.mockResolvedValue(catalog);
  getOccReport.mockImplementation(async (key, query) => page(query.page, query.page === 1));
  downloadOccReport.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('generates a server report for the period, pages it and exports every format', async () => {
  render(<CanonicalReportsRoute />);
  await userEvent.selectOptions(await screen.findByRole('combobox', { name: 'Reporte' }), 'turnaround-times');
  expect(screen.getByText('Planificado frente a real.')).toBeInTheDocument();
  await userEvent.clear(screen.getByLabelText('Desde'));
  await userEvent.type(screen.getByLabelText('Desde'), '2026-08-01');
  await userEvent.clear(screen.getByLabelText('Hasta'));
  await userEvent.type(screen.getByLabelText('Hasta'), '2026-08-31');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));

  const table = await screen.findByRole('table');
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent)).toEqual(['Operación', 'Minutos reales']);
  expect(getOccReport).toHaveBeenCalledWith('turnaround-times',
    { stationId, from: '2026-08-01', to: '2026-08-31', page: 1, limit: 25 }, expect.anything());
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(await screen.findByText('OP-2')).toBeInTheDocument();

  for (const [label, format] of [['Exportar Excel', 'xlsx'], ['Exportar PDF', 'pdf'], ['Exportar CSV', 'csv']]) {
    await userEvent.click(screen.getByRole('button', { name: label }));
    await waitFor(() => expect(downloadOccReport).toHaveBeenLastCalledWith('turnaround-times',
      { stationId, from: '2026-08-01', to: '2026-08-31' }, format, 'PUJ'));
  }
});

it('hides the export buttons without «Exportar» and shows server problems', async () => {
  access = { can: code => code !== 'operations.reports.export' };
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByRole('table');
  expect(screen.queryByRole('button', { name: /Exportar/ })).not.toBeInTheDocument();

  getOccReport.mockRejectedValueOnce(Object.assign(new Error('Tu acceso no incluye los reportes de esta estación.'), { status: 403 }));
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Tu acceso no incluye');
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('explains an oversized export by its code: a PDF points to Excel or CSV (3-N13)', async () => {
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByRole('table');
  downloadOccReport.mockRejectedValueOnce(Object.assign(new Error('El reporte supera el máximo de filas exportables.'),
    { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Exportar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'El PDF admite hasta 5 000 filas: exporte a Excel o CSV, o acote el período.');
  downloadOccReport.mockRejectedValueOnce(Object.assign(new Error('El reporte supera el máximo de filas exportables.'),
    { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'No se pudo exportar: El reporte supera el máximo de filas exportables.');
});

it('defaults to the current month of the station calendar, not the browser UTC one', () => {
  expect(defaultPeriod(new Date('2026-10-26T16:00:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-26' });
  // 22:30 on 31 October in Punta Cana is already 1 November in UTC.
  expect(defaultPeriod(new Date('2026-11-01T02:30:00Z'))).toEqual({ from: '2026-10-01', to: '2026-10-31' });
});

it('says when the report was generated in the station local time (3-N26)', async () => {
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByRole('table');
  // asOf is 2026-10-26T12:00:00Z: 08:00 in Punta Cana.
  expect(screen.getByText(/Generado 26\/10\/2026, 08:00/)).toBeInTheDocument();
});

it('says the list of reports is on its way until it arrives', async () => {
  const pending = deferred();
  listOccReports.mockReturnValueOnce(pending.promise);
  render(<CanonicalReportsRoute />);
  // Under the toolbar, where the result goes, a skeleton in the shape of the two lines to come says it in words for
  // assistive technology; the page does not invite to choose a report yet, and the list cannot be used.
  const loading = screen.getByRole('status');
  expect(loading).toHaveTextContent('Cargando reportes…');
  expect(loading).toHaveAttribute('data-occ-skeleton', 'text');
  const toolbar = screen.getByRole('toolbar', { name: 'Reporte y período' });
  expect(toolbar).not.toContainElement(loading);
  expect(toolbar.compareDocumentPosition(loading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(screen.queryByText(IDLE)).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();

  await act(async () => pending.resolve(catalog));
  expect(await screen.findByText(IDLE)).toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeEnabled();
  expect(getOccReport).not.toHaveBeenCalled();
});

it('shows the export actions in the panel header and the pagination in its footer', async () => {
  render(<CanonicalReportsRoute />);
  // Before the first report the page says what to do, and the chosen report's description describes the list.
  expect(await screen.findByText(IDLE)).toBeInTheDocument();
  const select = screen.getByRole('combobox', { name: 'Reporte' });
  expect(screen.getByRole('toolbar', { name: 'Reporte y período' })).toContainElement(select);
  await userEvent.selectOptions(select, 'turnaround-times');
  expect(select).toHaveAccessibleDescription('Planificado frente a real.');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));

  const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
  const table = await within(panel).findByRole('table', { name: 'Tiempos de turnaround' });
  const header = within(panel).getByRole('heading', { level: 2, name: 'Tiempos de turnaround' }).parentElement;
  expect(within(header).getAllByRole('button').map(button => button.textContent))
    .toEqual(['Exportar Excel', 'Exportar PDF', 'Exportar CSV']);
  expect(within(header).getByText('Página 1, 1 fila')).toBeInTheDocument();
  // The column of numbers, header included, sits on the right with tabular figures; text stays on the left.
  expect(within(table).getAllByRole('columnheader')[1]).toHaveClass('text-right');
  expect(within(table).getByRole('cell', { name: '45' })).toHaveClass('text-right', 'tabular-nums');
  expect(within(table).getByRole('cell', { name: 'OP-1' })).not.toHaveClass('text-right');
  // The pages sit at the foot of the panel, after the rows.
  const pages = within(panel).getByRole('navigation', { name: 'Páginas del reporte' });
  expect(table.compareDocumentPosition(pages) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  expect(within(pages).getByRole('button', { name: 'Anterior' })).toBeDisabled();

  // An export on its way says so on its own button and holds the other two until it ends.
  let finish;
  downloadOccReport.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
  await userEvent.click(within(header).getByRole('button', { name: 'Exportar CSV' }));
  expect(within(header).getByRole('button', { name: 'Exportando…' })).toHaveAttribute('aria-busy', 'true');
  expect(within(header).getByRole('button', { name: 'Exportar Excel' })).toBeDisabled();
  await act(async () => finish());
  expect(within(header).getByRole('button', { name: 'Exportar CSV' })).toBeEnabled();

  // The next page keeps the panel and its name; its pages come back with the rows.
  await userEvent.click(within(pages).getByRole('button', { name: 'Siguiente' }));
  expect(await within(panel).findByText('OP-2')).toBeInTheDocument();
  expect(within(panel).getByRole('button', { name: 'Anterior' })).toBeEnabled();
  expect(within(panel).getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('says an empty page in its body and keeps only the generation time in its header', async () => {
  getOccReport.mockResolvedValueOnce({ ...page(1, false), rows: [] });
  render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
  expect(await within(panel).findByText('No hay datos para este reporte en el período seleccionado.')).toBeInTheDocument();
  expect(within(panel).getByText(/^Generado /)).toBeInTheDocument();
  expect(within(panel).queryByText(/^Página/)).not.toBeInTheDocument();
  // Nothing to export and a single page: the exports cannot act and there are no pages to turn.
  for (const name of ['Exportar Excel', 'Exportar PDF', 'Exportar CSV']) {
    expect(within(panel).getByRole('button', { name })).toBeDisabled();
  }
  expect(within(panel).queryByRole('navigation', { name: 'Páginas del reporte' })).not.toBeInTheDocument();
});

it('offers a retry when the list of reports could not be read', async () => {
  listOccReports.mockRejectedValueOnce(Object.assign(new Error('No se pudo generar el reporte. Intenta nuevamente.'),
    { status: 500 }));
  render(<CanonicalReportsRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo generar el reporte. Intenta nuevamente.');
  expect(screen.getByRole('combobox', { name: 'Reporte' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Generar' })).toBeDisabled();
  // While the list is read again, the failure gives way to its loading.
  const pending = deferred();
  listOccReports.mockReturnValueOnce(pending.promise);
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(screen.getByRole('status')).toHaveTextContent('Cargando reportes…');
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  await act(async () => pending.resolve(catalog));
  expect(await screen.findByRole('option', { name: 'Operaciones del período' })).toBeInTheDocument();
  expect(screen.getByText(IDLE)).toBeInTheDocument();
  expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  expect(screen.queryByRole('status')).not.toBeInTheDocument();
  expect(listOccReports).toHaveBeenCalledTimes(2);
});

describe('CanonicalReportsRoute in English', () => {
  afterEach(() => act(() => resetLanguageForTests('es')));

  it('generates a report in English inside the OCC scope', async () => {
    act(() => resetLanguageForTests('en'));
    const pending = deferred();
    listOccReports.mockReturnValueOnce(pending.promise);
    render(<LanguageScope><CanonicalReportsRoute /></LanguageScope>);
    expect(screen.getByRole('heading', { level: 1, name: 'Operational reports' })).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('Loading reports…');
    await act(async () => pending.resolve(catalog));
    expect(await screen.findByText('Choose the report and the period, then press “Generate”.')).toBeInTheDocument();
    expect(screen.getByRole('toolbar', { name: 'Report and period' })).toBeInTheDocument();
    expect(screen.getByLabelText('From')).toBeInTheDocument();
    expect(screen.getByLabelText('To')).toBeInTheDocument();
    // The report titles are the server's.
    await screen.findByRole('option', { name: 'Operaciones del período' });
    await userEvent.click(screen.getByRole('button', { name: 'Generate' }));
    const panel = await screen.findByRole('region', { name: 'Tiempos de turnaround' });
    await within(panel).findByRole('table');
    expect(within(panel).getByText('Page 1, 1 row')).toBeInTheDocument();
    expect(within(panel).getByText('Generated 10/26/2026, 08:00')).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Export Excel' })).toBeInTheDocument();
    expect(within(panel).getByRole('navigation', { name: 'Report pages' })).toBeInTheDocument();
    expect(within(panel).getByRole('button', { name: 'Next' })).toBeEnabled();
    expect(screen.queryByText(/Reportes operativos|Generar|Exportar|Página|Anterior|Siguiente/)).toBeNull();
  });
});
