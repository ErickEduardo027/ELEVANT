import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from '../../../../tests/MemoryRouter.jsx';
import CurrentReportsPage from './CurrentReportsPage';
import { getHumanResourcesReport, exportHumanResourcesReport } from
  '../../../services/humanResourcesVerifiedReportsService';

const observerFactory = vi.hoisted(() => vi.fn());
const auth = vi.hoisted(() => ({ session: null }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session: auth.session }) }));
vi.mock('../../../services/humanResourcesVerifiedReportsService', () => ({
  getHumanResourcesReport: vi.fn(), exportHumanResourcesReport: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const row = { id: '50000000-0000-7000-8000-000000000001',
  agentName: 'Agente de prueba', employeeNumber: 'DEV-001',
  kind: 'Qualification', code: 'GPU', expiresOn: '2026-10-20' };
const page = { stationId, from: '2026-10-01', to: '2026-10-30',
  page: 1, limit: 20, hasMore: true, asOf: '2026-10-05T12:00:00Z', rows: [row] };

beforeEach(() => {
  auth.session = { token: 'session-one', stationScopes: [{ stationId, stationCode: 'PUJ' }] };
  observerFactory.mockReset().mockReturnValue({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
  });
  getHumanResourcesReport.mockReset().mockResolvedValue(page);
  exportHumanResourcesReport.mockReset().mockResolvedValue(new Blob(['%PDF-1.7\n'],
    { type: 'application/pdf' }));
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

function renderReport() {
  return render(<MemoryRouter initialEntries={[
    '/gestion-humana/reports?from=2026-10-01&to=2026-10-30',
  ]}><CurrentReportsPage initialDate={new Date(2026, 9, 5, 12)} /></MemoryRouter>);
}

it('shows a station-scoped page without inventing a global total and follows pagination', async () => {
  getHumanResourcesReport.mockImplementation(async (_, query) =>
    query.page === 1 ? page : { ...page, page: 2, hasMore: false,
      rows: [{ ...row, id: '50000000-0000-7000-8000-000000000002',
        agentName: 'Segundo agente' }] });
  renderReport();
  expect(screen.getByLabelText('Estación autorizada')).toHaveValue(stationId);
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  expect(screen.getByText(/1 fila en esta página/)).toBeInTheDocument();
  expect(screen.queryByText(/total global/i)).not.toBeInTheDocument();
  expect(getHumanResourcesReport).toHaveBeenCalledWith('expirations',
    expect.objectContaining({ stationId, page: 1, limit: 20 }), expect.anything());
  fireEvent.click(screen.getByRole('button', { name: 'Página siguiente' }));
  expect(await screen.findByText('Segundo agente')).toBeInTheDocument();
  expect(screen.queryByText('Agente de prueba')).not.toBeInTheDocument();
});

it('switches among all four server report kinds and shows an honest empty state', async () => {
  getHumanResourcesReport.mockResolvedValue({ ...page, hasMore: false, rows: [] });
  renderReport();
  expect(await screen.findByText(/No hay filas para estos filtros/)).toBeInTheDocument();
  for (const kind of ['account-movements', 'staff-distribution',
    'qualification-coverage']) {
    fireEvent.change(screen.getByLabelText('Tipo de reporte'), { target: { value: kind } });
    await waitFor(() => expect(getHumanResourcesReport).toHaveBeenCalledWith(kind,
      expect.objectContaining({ stationId }), expect.anything()));
  }
});

it('applies expiration filters to both the page and the full export', async () => {
  vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:filtered-report');
  vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Clase de documento'),
    { target: { value: 'Qualification' } });
  fireEvent.change(screen.getByLabelText('Vigencia'),
    { target: { value: 'Current' } });
  await waitFor(() => expect(getHumanResourcesReport).toHaveBeenCalledWith(
    'expirations', expect.objectContaining({ documentKind: 'Qualification',
      validity: 'Current' }), expect.anything()));
  fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  await waitFor(() => expect(exportHumanResourcesReport).toHaveBeenCalledWith(
    'expirations', expect.objectContaining({ stationId,
      documentKind: 'Qualification', validity: 'Current' }), 'pdf'));
});

it('removes private rows on a revoked role and never renders server exception text', async () => {
  getHumanResourcesReport.mockResolvedValueOnce(page).mockRejectedValueOnce(
    Object.assign(new Error('private SQL trace'), { status: 403 }));
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso');
  expect(screen.queryByText('Agente de prueba')).not.toBeInTheDocument();
  expect(screen.queryByText('private SQL trace')).not.toBeInTheDocument();
});

it('does not restore old rows when an earlier request completes after a filter change', async () => {
  let resolveEarlier;
  getHumanResourcesReport.mockImplementationOnce(() => new Promise(resolve => {
    resolveEarlier = resolve;
  })).mockResolvedValueOnce({ ...page, rows: [], hasMore: false });
  renderReport();
  await waitFor(() => expect(resolveEarlier).toBeTypeOf('function'));
  fireEvent.change(screen.getByLabelText('Tipo de reporte'),
    { target: { value: 'account-movements' } });
  expect(await screen.findByText(/No hay filas para estos filtros/)).toBeInTheDocument();
  await act(async () => resolveEarlier(page));
  expect(screen.queryByText('Agente de prueba')).not.toBeInTheDocument();
});

it('exports a complete server PDF and explains the 5 000-row limit', async () => {
  const objectUrl = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:report');
  const revoke = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
  const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
  renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  await waitFor(() => expect(exportHumanResourcesReport).toHaveBeenCalledWith(
    'expirations', { stationId, from: '2026-10-01', to: '2026-10-30' },
    'pdf'));
  await waitFor(() => expect(click).toHaveBeenCalled());
  expect(objectUrl).toHaveBeenCalled();
  expect(revoke).not.toHaveBeenCalled();
  await waitFor(() => expect(revoke).toHaveBeenCalledWith('blob:report'),
    { timeout: 1_500 });

  exportHumanResourcesReport.mockRejectedValueOnce(
    Object.assign(new Error('internal'), { status: 422 }));
  fireEvent.click(screen.getByRole('button', { name: 'Descargar XLSX' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Acota el intervalo');
});

it('re-enables exports when the session changes during an older download', async () => {
  let finishOldDownload;
  exportHumanResourcesReport.mockImplementationOnce(() => new Promise(resolve => {
    finishOldDownload = resolve;
  }));
  const view = renderReport();
  expect(await screen.findByText('Agente de prueba')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Descargar PDF' }));
  expect(screen.getByRole('button', { name: 'Descargar XLSX' })).toBeDisabled();
  auth.session = { ...auth.session, token: 'session-two' };
  view.rerender(<MemoryRouter initialEntries={[
    '/gestion-humana/reports?from=2026-10-01&to=2026-10-30',
  ]}><CurrentReportsPage initialDate={new Date(2026, 9, 5, 12)} /></MemoryRouter>);
  await waitFor(() => expect(getHumanResourcesReport).toHaveBeenCalledTimes(2));
  await act(async () => finishOldDownload(new Blob(['old session'],
    { type: 'application/pdf' })));
  expect(screen.getByRole('button', { name: 'Descargar XLSX' })).toBeEnabled();
});
