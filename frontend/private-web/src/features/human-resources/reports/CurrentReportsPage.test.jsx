import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import CurrentReportsPage from './CurrentReportsPage';
import { getHumanResourcesQualifications } from '../../../services/humanResourcesQualificationsReadService';
import { getHumanResourcesPermits } from '../../../services/humanResourcesPermitsReadService';
import { getHumanResourcesShifts } from '../../../services/humanResourcesShiftsReadService';

const observerFactory = vi.hoisted(() => vi.fn());

vi.mock('../../../services/humanResourcesQualificationsReadService', () => ({
  getHumanResourcesQualifications: vi.fn(),
}));
vi.mock('../../../services/humanResourcesPermitsReadService', () => ({
  getHumanResourcesPermits: vi.fn(),
}));
vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getHumanResourcesShifts: vi.fn(),
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: observerFactory,
}));

const initialDate = new Date(2026, 8, 28, 12);
const qualification = { id: 'qual-1', agentName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
  equipmentName: 'GPU', obtainedOn: '2026-01-01', expiresOn: '2026-10-05' };
const permit = { id: 'permit-1', agentName: 'Ana Rivas', employeeNumber: 'DEV-RA-002',
  documentType: 'AirportId', issuedOn: '2026-01-01', expiresOn: '2026-09-29' };
const shift = { id: 'shift-1', agentName: 'Riley Ramp', workDate: '2026-09-28',
  stationCode: 'PUJ', terminalCode: 'A', startsAtLocal: '06:00:00', endsAtLocal: '14:00:00' };

beforeEach(() => {
  observerFactory.mockReset();
  observerFactory.mockReturnValue({ start: vi.fn().mockResolvedValue(undefined),
    stop: vi.fn().mockResolvedValue(undefined) });
  getHumanResourcesQualifications.mockReset().mockResolvedValue({ qualifications: [qualification], hasMore: false });
  getHumanResourcesPermits.mockReset().mockResolvedValue({ permits: [permit], hasMore: false });
  getHumanResourcesShifts.mockReset().mockResolvedValue({ shifts: [shift], hasMore: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

function renderReport() {
  return render(<MemoryRouter><CurrentReportsPage initialDate={initialDate} /></MemoryRouter>);
}

it('reports only authorized API records, with source limits and no prototype export', async () => {
  renderReport();
  expect(await screen.findByText('Ana Rivas')).toBeInTheDocument();
  expect(screen.getAllByText('Riley Ramp').length).toBeGreaterThan(0);
  expect(screen.getByText(/Carnet aeroportuario/)).toBeInTheDocument();
  expect(screen.getByText(/GPU/)).toBeInTheDocument();
  expect(screen.getByText(/primeros 100 registros por fuente/i)).toBeInTheDocument();
  expect(screen.queryByText(/historial completo/i)).not.toBeInTheDocument();
  expect(getHumanResourcesQualifications).toHaveBeenCalledWith({ page: 1, limit: 100 }, expect.anything());
  expect(getHumanResourcesPermits).toHaveBeenCalledWith({ page: 1, limit: 100 }, expect.anything());
  expect(getHumanResourcesShifts).toHaveBeenCalledWith({ from: '2026-09-28', to: '2026-10-04', page: 1, limit: 100 }, expect.anything());
  expect(screen.queryByRole('button', { name: /Exportar|Descargar/i })).not.toBeInTheDocument();
  expect(screen.queryByText(/datos sintéticos|demo/i)).not.toBeInTheDocument();
});

it('uses an honest empty state and flags an incomplete source page', async () => {
  getHumanResourcesQualifications.mockResolvedValue({ qualifications: [], hasMore: true });
  getHumanResourcesPermits.mockResolvedValue({ permits: [], hasMore: false });
  getHumanResourcesShifts.mockResolvedValue({ shifts: [], hasMore: false });
  renderReport();
  expect(await screen.findByText(/No hay vigencias registradas en las páginas consultadas/)).toBeInTheDocument();
  expect(screen.getByText(/Hay más habilitaciones fuera de esta muestra/)).toBeInTheDocument();
  expect(screen.getByText(/No hay turnos registrados en la semana seleccionada/)).toBeInTheDocument();
});

it('hides stale personnel after a failed revalidation and does not expose server text', async () => {
  getHumanResourcesPermits.mockResolvedValueOnce({ permits: [permit], hasMore: false })
    .mockRejectedValueOnce(new Error('internal SQL trace'));
  renderReport();
  expect(await screen.findByText('Ana Rivas')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo cargar el reporte');
  expect(screen.queryByText('Ana Rivas')).not.toBeInTheDocument();
  expect(screen.queryByText('internal SQL trace')).not.toBeInTheDocument();
});

it.each([[401, /La sesión expiró/], [403, /No tienes acceso/]])(
  'shows a safe authorization state for HTTP %s', async (status, message) => {
    getHumanResourcesPermits.mockRejectedValue({ status, detail: 'internal SQL trace' });
    renderReport();
    expect(await screen.findByRole('alert')).toHaveTextContent(message);
    expect(screen.queryByText('internal SQL trace')).not.toBeInTheDocument();
    expect(screen.queryByText('Ana Rivas')).not.toBeInTheDocument();
  },
);

it('refreshes when a durable qualification hint arrives', async () => {
  renderReport();
  expect(await screen.findByText(/GPU/)).toBeInTheDocument();
  getHumanResourcesQualifications.mockResolvedValue({ qualifications: [{ ...qualification,
    id: 'qual-2', equipmentName: 'Escalera' }], hasMore: false });
  await act(async () => observerFactory.mock.calls[0][0](['hr_qualifications']));
  expect(await screen.findByText(/Escalera/)).toBeInTheDocument();
  expect(screen.queryByText(/GPU/)).not.toBeInTheDocument();
});

it('labels future-effective current cycles as not yet started', async () => {
  getHumanResourcesQualifications.mockResolvedValue({ qualifications: [{ ...qualification,
    obtainedOn: '2026-10-01' }], hasMore: false });
  getHumanResourcesPermits.mockResolvedValue({ permits: [{ ...permit,
    issuedOn: '2026-10-01' }], hasMore: false });
  renderReport();
  expect(await screen.findAllByText(/Aún no inicia/)).toHaveLength(2);
});

it('follows the current week after midnight on Monday but preserves a manually selected week', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(2026, 8, 27, 23, 59));
  render(<MemoryRouter><CurrentReportsPage initialDate={new Date()} /></MemoryRouter>);
  expect(await screen.findByText('Ana Rivas')).toBeInTheDocument();
  expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-09-21', to: '2026-09-27', page: 1, limit: 100 }, expect.anything());

  vi.setSystemTime(new Date(2026, 8, 28, 0, 1));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-09-28', to: '2026-10-04', page: 1, limit: 100 }, expect.anything());

  await act(async () => screen.getByRole('button', { name: 'Semana anterior' }).click());
  expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-09-21', to: '2026-09-27', page: 1, limit: 100 }, expect.anything());
  const callsBeforeFocus = getHumanResourcesShifts.mock.calls.length;
  vi.setSystemTime(new Date(2026, 9, 5, 0, 1));
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(getHumanResourcesShifts.mock.calls).toHaveLength(callsBeforeFocus + 1);
  expect(getHumanResourcesShifts.mock.lastCall[0]).toEqual(
    { from: '2026-09-21', to: '2026-09-27', page: 1, limit: 100 });
});
