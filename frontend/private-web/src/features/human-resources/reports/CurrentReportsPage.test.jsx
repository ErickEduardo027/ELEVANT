import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurrentReportsPage from './CurrentReportsPage';
import { exportHumanResourcesReport, getHumanResourcesReport, listHumanResourcesReports } from
  '../../../services/humanResourcesVerifiedReportsService';
import { downloadFile } from '../../../utils/downloadFile';

const observerFactory = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../../services/humanResourcesVerifiedReportsService', () => ({
  getHumanResourcesReport: vi.fn(), exportHumanResourcesReport: vi.fn(), listHumanResourcesReports: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({ createPrivateWebAccountChangeObserver: observerFactory }));
vi.mock('../permits/usePermitTypeCatalog', () => ({ default: () => ({ names: {}, status: 'ready' }) }));
vi.mock('../../../utils/downloadFile', () => ({ downloadFile: vi.fn() }));

const stationId = '20000000-0000-7000-8000-000000000003';
const otherStation = '20000000-0000-7000-8000-000000000004';
const row = { id: '50000000-0000-7000-8000-000000000001', agentName: 'Agente de prueba', employeeNumber: 'DEV-001',
  kind: 'Qualification', code: 'GPU', expiresOn: '2026-10-20' };
const page = { stationId, from: '2026-10-01', to: '2026-10-05', page: 1, limit: 20, hasMore: true,
  asOf: '2026-10-05T12:00:00Z', rows: [row] };
// 12:00 local on 5 October 2026.
const initialDate = new Date('2026-10-05T16:00:00Z');

beforeEach(() => {
  auth.session = { token: 'session-one', name: 'Lucía Gómez',
    stationScopes: [{ stationId, stationCode: 'PUJ' }, { stationId: otherStation, stationCode: 'SDQ' }] };
  observerFactory.mockReset().mockReturnValue({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) });
  listHumanResourcesReports.mockReset().mockResolvedValue(null);
  getHumanResourcesReport.mockReset().mockResolvedValue(page);
  exportHumanResourcesReport.mockReset().mockResolvedValue(new Blob(['%PDF-1.7\n'], { type: 'application/pdf' }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const renderReport = () => render(<CurrentReportsPage initialDate={initialDate} />);

it('opens on «Este mes» of AVIAM calendar for the first station and says what produced the result', async () => {
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  expect(getHumanResourcesReport).toHaveBeenCalledWith('expirations',
    { stationId, from: '2026-10-01', to: '2026-10-05', page: 1, limit: 20 }, expect.anything());
  const result = screen.getByRole('region', { name: 'Vigencias de habilitaciones y permisos' });
  expect(within(result).getByText('Generado el 05/10/2026 08:00 por Lucía Gómez')).toBeInTheDocument();
  expect(within(result).getByText('Filtros aplicados: Estación PUJ · Período 01/10/2026 – 05/10/2026')).toBeInTheDocument();
  expect(within(result).getByText('Página 1 · 1 fila en esta página')).toBeInTheDocument();
});

it('opens on the station day, not the browser UTC day (3-N16)', async () => {
  render(<CurrentReportsPage initialDate={new Date('2026-11-06T01:30:00Z')} />);
  // 21:30 on 5 November in Punta Cana is already 6 November in UTC.
  await waitFor(() => expect(getHumanResourcesReport).toHaveBeenCalledWith('expirations',
    expect.objectContaining({ from: '2026-11-01', to: '2026-11-05' }), expect.anything()));
  expect(screen.getByLabelText('Hasta')).toHaveValue('2026-11-05');
});

it('shows the codes in Spanish and the account movements at the station local time', async () => {
  getHumanResourcesReport.mockImplementation(async kind => (kind === 'account-movements'
    ? { ...page, hasMore: false, rows: [{ id: 'm1', accountId: row.id, rampProfileId: row.id, agentName: 'Agente de prueba',
      employeeNumber: 'DEV-001', kind: 'Created', occurredAt: '2026-10-06T01:00:00Z' }] }
    : { ...page, hasMore: false, rows: [row, { ...row, id: 'r2', agentName: 'Segundo agente', kind: 'Permit', code: 'AirportId' }] }));
  renderReport();
  expect(await screen.findByText('Segundo agente')).toBeInTheDocument();
  expect(screen.getByText('Habilitación')).toBeInTheDocument();
  expect(screen.getByText('Carnet aeroportuario')).toBeInTheDocument();
  expect(screen.getAllByText('20/10/2026')).toHaveLength(2);
  expect(screen.queryByText('Qualification')).not.toBeInTheDocument();

  await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'account-movements');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(await screen.findByText('Alta de cuenta')).toBeInTheDocument();
  // 01:00Z on 6 October is 21:00 on 5 October in Punta Cana.
  expect(screen.getByText('05/10/2026, 21:00')).toBeInTheDocument();
});

it('filters expirations by class, validity and station, on the page and the whole download', async () => {
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  await userEvent.selectOptions(screen.getByLabelText('Clase de documento'), 'Qualification');
  await userEvent.selectOptions(screen.getByLabelText('Vigencia'), 'Current');
  await userEvent.selectOptions(screen.getByLabelText('Estación autorizada'), otherStation);
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await waitFor(() => expect(getHumanResourcesReport).toHaveBeenLastCalledWith('expirations',
    expect.objectContaining({ stationId: otherStation, documentKind: 'Qualification', validity: 'Current' }), expect.anything()));
  expect(await screen.findByText(/Estación SDQ · Período .* · Clase de documento Habilitaciones · Vigencia Vigentes/))
    .toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  await waitFor(() => expect(exportHumanResourcesReport).toHaveBeenCalledWith('expirations',
    { stationId: otherStation, from: '2026-10-01', to: '2026-10-05', documentKind: 'Qualification', validity: 'Current' }, 'pdf'));
  expect(downloadFile).toHaveBeenCalledWith(expect.any(Blob), 'elevant-gh-expirations-2026-10-01-2026-10-05.pdf');
});

it('reads the qualification coverage at a cut-off date with its share and its base', async () => {
  listHumanResourcesReports.mockResolvedValue({ maxRangeDays: 366, reports: [
    { key: 'expirations', title: 'Vigencias de habilitaciones y permisos', description: 'Vencen en el período.', asOfDate: false },
    { key: 'qualification-coverage', title: 'Cobertura de habilitaciones', description: 'A la fecha de corte.', asOfDate: true },
  ] });
  getHumanResourcesReport.mockImplementation(async kind => (kind === 'qualification-coverage'
    ? { ...page, hasMore: false, rows: [{ equipmentTypeId: 'e1', equipmentCode: 'GPU', equipmentName: 'Planta eléctrica',
      eligibleAgents: 8, qualifiedAgents: 6, stationAgents: 50 }] } : page));
  renderReport();
  await screen.findByText('Agente de prueba');
  await userEvent.selectOptions(screen.getByLabelText('Reporte'), 'qualification-coverage');
  expect(screen.queryByLabelText('Desde')).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  await waitFor(() => expect(getHumanResourcesReport).toHaveBeenLastCalledWith('qualification-coverage',
    expect.objectContaining({ from: '2026-10-05', to: '2026-10-05' }), expect.anything()));
  const result = await screen.findByRole('region', { name: 'Cobertura de habilitaciones' });
  const table = within(result).getByRole('table');
  expect(within(table).getAllByRole('columnheader').map(cell => cell.textContent))
    .toEqual(['Equipo', 'Nombre', 'Elegibles', 'Habilitados', 'Sin habilitación vigente', '% habilitados']);
  expect(within(table).getByRole('cell', { name: '75.0 %' })).toBeInTheDocument();
  expect(within(result).getByLabelText('Resumen del reporte')).toHaveTextContent('Agentes activos de la estación50');
  // «Elegibles» repeat agents across equipment: no totals row.
  expect(table.querySelector('tfoot')).toBeNull();
  expect(within(result).getByText(/Fecha de corte 05\/10\/2026/)).toBeInTheDocument();
});

it('allows a year once the API catalog says so, and 30 dates before it', async () => {
  renderReport();
  await screen.findByText('Agente de prueba');
  await userEvent.clear(screen.getByLabelText('Desde'));
  await userEvent.type(screen.getByLabelText('Desde'), '2026-08-01');
  await userEvent.click(screen.getByRole('button', { name: 'Generar' }));
  expect(screen.getByRole('alert')).toHaveTextContent('El período admite hasta 30 días');
});

it('takes the rows off the screen when the access is revoked and never shows server text', async () => {
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  getHumanResourcesReport.mockRejectedValueOnce(Object.assign(new Error('No tienes acceso a este reporte o estación.'),
    { status: 403 }));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso');
  expect(screen.queryByText('Agente de prueba')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
});

it('explains the 5 000-row limit of a PDF and pages the report', async () => {
  getHumanResourcesReport.mockImplementation(async (kind, query) => (query.page === 1 ? page
    : { ...page, page: 2, hasMore: false, rows: [{ ...row, id: 'r2', agentName: 'Segundo agente' }] }));
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
  expect(await screen.findByText('Segundo agente')).toBeInTheDocument();
  exportHumanResourcesReport.mockRejectedValueOnce(Object.assign(new Error('Narrow'), { status: 422, code: 'report_too_large' }));
  await userEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('El PDF admite hasta 5 000 filas');
  expect(screen.getByRole('button', { name: 'Descargar Excel' })).toBeEnabled();
});

it('starts again with a new session: no row of the previous account survives', async () => {
  const view = renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  getHumanResourcesReport.mockResolvedValue({ ...page, rows: [], hasMore: false });
  auth.session = { ...auth.session, token: 'session-two' };
  view.rerender(<CurrentReportsPage initialDate={initialDate} />);
  expect(await screen.findByText('No hay datos para estos filtros.')).toBeInTheDocument();
  expect(screen.queryByText('Agente de prueba')).not.toBeInTheDocument();
});

it('says when the account has no station for these reports', () => {
  auth.session = { token: 'x', stationScopes: [] };
  renderReport();
  expect(screen.getByRole('alert')).toHaveTextContent('No tienes una estación autorizada');
  expect(getHumanResourcesReport).not.toHaveBeenCalled();
});
