import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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

beforeEach(() => {
  access = { can: () => true };
  listOccReports.mockResolvedValue({ maxRangeDays: 366, reports: [
    { key: 'operations', title: 'Operaciones del período', description: 'Cada operación.', columns: ['Fecha'] },
    { key: 'turnaround-times', title: 'Tiempos de turnaround', description: 'Planificado frente a real.', columns: ['Operación'] },
  ] });
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
