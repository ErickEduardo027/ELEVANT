import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanonicalReportsRoute, { defaultPeriod } from './CanonicalReportsRoute';
import { downloadOccReport, getOccReport, listOccReports } from '../../services/occReportsService';

const stationId = '20000000-0000-0000-0000-000000000001';
let access = null;
let session;
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session }) }));
vi.mock('../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: () => access }));
vi.mock('../../services/occReportsService', () => ({ listOccReports: vi.fn(), getOccReport: vi.fn(), downloadOccReport: vi.fn() }));

const page = (number, hasMore) => ({ key: 'turnaround-times', title: 'Tiempos de turnaround', stationId, stationCode: 'PUJ',
  from: '2026-08-01', to: '2026-08-31', asOf: '2026-10-26T12:00:00Z', columns: ['Operación', 'Minutos reales'],
  rows: [[{ value: `OP-${number}`, type: 'text' }, { value: '45', type: 'number' }]], page: number, limit: 25, hasMore });

beforeEach(() => {
  vi.resetAllMocks();
  access = { can: () => true };
  session = { accountId: '40000000-0000-0000-0000-000000000001', token: 'qa-token-a', stationScopes: [{ stationId, stationCode: 'PUJ' }] };
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
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-08-31' } });
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

  await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Reporte' }), 'operations');
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-08-05' } });
  expect(screen.getByText('Período aplicado: 2026-08-01 — 2026-08-31 · PUJ')).toBeInTheDocument();
  expect(getOccReport).toHaveBeenCalledTimes(2);
  await userEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
  expect(downloadOccReport).toHaveBeenLastCalledWith('turnaround-times',
    { stationId, from: '2026-08-01', to: '2026-08-31' }, 'xlsx', 'PUJ');
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

it('defaults to the current month', () => {
  expect(defaultPeriod(new Date(2026, 9, 26))).toEqual({ from: '2026-10-01', to: '2026-10-26' });
});

it('recovers a failed report catalogue without exposing internal error text', async () => {
  listOccReports.mockRejectedValueOnce(new Error('internal-database-detail'));
  render(<CanonicalReportsRoute />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudieron cargar');
  expect(screen.queryByText('internal-database-detail')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  await screen.findByRole('option', { name: 'Operaciones del período' });
  expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled();
});

it('hides the previous station report and exports while the next station loads', async () => {
  const nextStationId = '20000000-0000-0000-0000-000000000002';
  let resolveNext;
  getOccReport.mockImplementation((key, query) => query.stationId === nextStationId
    ? new Promise(resolve => { resolveNext = resolve; }) : Promise.resolve(page(1, false)));
  const view = render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByText('OP-1');

  session = { ...session, stationScopes: [{ stationId: nextStationId, stationCode: 'PUJ' }] };
  view.rerender(<CanonicalReportsRoute />);
  await waitFor(() => expect(getOccReport).toHaveBeenLastCalledWith('operations', expect.objectContaining({ stationId: nextStationId }), expect.anything()));
  expect(screen.queryByText('OP-1')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Exportar Excel' })).not.toBeInTheDocument();
  await act(async () => { resolveNext({ ...page(2, false), stationId: nextStationId, stationCode: 'PUJ' }); });
  expect(await screen.findByText('OP-2')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Exportar Excel' }));
  expect(downloadOccReport).toHaveBeenLastCalledWith('operations', expect.objectContaining({ stationId: nextStationId }), 'xlsx', 'PUJ');
});

it('ignores an old account response after the new account generates a report', async () => {
  let resolveOld;
  getOccReport.mockImplementationOnce(() => new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce(page(2, false));
  const view = render(<CanonicalReportsRoute />);
  await screen.findByRole('option', { name: 'Operaciones del período' });
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await waitFor(() => expect(getOccReport).toHaveBeenCalledTimes(1));

  session = { ...session, accountId: '40000000-0000-0000-0000-000000000002', token: 'qa-token-b' };
  view.rerender(<CanonicalReportsRoute />);
  await waitFor(() => expect(listOccReports).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByRole('button', { name: 'Generar' })).toBeEnabled());
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await screen.findByText('OP-2');
  await act(async () => { resolveOld(page(1, false)); });
  expect(screen.queryByText('OP-1')).not.toBeInTheDocument();
  expect(screen.getByText('OP-2')).toBeInTheDocument();
});
