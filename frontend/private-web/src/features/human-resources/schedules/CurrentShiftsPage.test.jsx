import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurrentShiftsPage from './CurrentShiftsPage';
import { getHumanResourcesShifts, recordHumanResourcesShift } from '../../../services/humanResourcesShiftsReadService';
import { getHumanResourcesAvailabilityRequests } from
  '../../../services/humanResourcesAvailabilityService';

vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getHumanResourcesShifts: vi.fn(),
  recordHumanResourcesShift: vi.fn(),
}));
vi.mock('../../../services/humanResourcesAvailabilityService', () => ({
  getHumanResourcesAvailabilityRequests: vi.fn(),
  recordHumanResourcesAvailabilityRequest: vi.fn(),
  resolveHumanResourcesAvailabilityRequest: vi.fn(),
}));
const observerCallbacks = vi.hoisted(() => []);
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: callback => {
    observerCallbacks.push(callback);
    return ({
    start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined),
    });
  },
}));

const shift = {
  id: '50000000-0000-7000-8000-000000000005',
  rampProfileId: '50000000-0000-7000-8000-000000000001',
  agentName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
  stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ',
  terminalId: '20000000-0000-7000-8000-000000000004', terminalCode: 'A',
  positionId: '20000000-0000-7000-8000-000000000005', positionCode: 'RAMP-AGENT',
  workDate: '2026-08-18', startsAtLocal: '06:00:00', endsAtLocal: '14:00:00', block: 'Morning',
};
const initialDate = new Date(2026, 7, 18, 12);

beforeEach(() => {
  getHumanResourcesAvailabilityRequests.mockImplementation(async query =>
    ({ ...query, hasMore: false, requests: [] }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); observerCallbacks.length = 0; });

it('reads the selected station-local week and navigates without prototype writes', async () => {
  getHumanResourcesShifts
    .mockResolvedValueOnce({ from: '2026-08-17', to: '2026-08-23',
      page: 1, limit: 20, hasMore: false, shifts: [shift] })
    .mockResolvedValueOnce({ from: '2026-08-24', to: '2026-08-30',
      page: 1, limit: 20, hasMore: false, shifts: [] });
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(screen.getByRole('heading', { name: 'Turnos de rampa' })).toBeInTheDocument();
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getByText('PUJ · A')).toBeInTheDocument();
  expect(screen.getByText('06:00–14:00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: /Asignar|Eliminar|Aprobar/ })).not.toBeInTheDocument();
  expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-08-17', to: '2026-08-23', page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await userEvent.click(screen.getByRole('button', { name: 'Semana siguiente' }));
  expect(await screen.findByText(/No hay turnos registrados/)).toBeInTheDocument();
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-08-24', to: '2026-08-30', page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('hides the previous week and private exception after failed revalidation', async () => {
  getHumanResourcesShifts
    .mockResolvedValueOnce({ from: '2026-08-17', to: '2026-08-23',
      page: 1, limit: 20, hasMore: false, shifts: [shift] })
    .mockRejectedValueOnce(new Error('internal SQL trace'));
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await act(async () => window.dispatchEvent(new Event('focus')));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar/);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.queryByText(/internal SQL trace/)).not.toBeInTheDocument();
});

it('distinguishes an empty authorized week from a forbidden response', async () => {
  getHumanResourcesShifts.mockResolvedValueOnce({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [] }).mockRejectedValueOnce({ status: 403 });
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText(/No hay turnos registrados/)).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Actualizar turnos' }));
  await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/No tienes acceso/));
  expect(screen.queryByText(/No hay turnos registrados/)).not.toBeInTheDocument();
});

it('shows assigned shifts without offering OCC-owned shift writes to HR', async () => {
  getHumanResourcesShifts.mockResolvedValue({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [shift] });
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getByRole('heading', { name: 'Ausencias y solicitudes' })).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nuevo turno' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Registrar turno' })).not.toBeInTheDocument();
  expect(recordHumanResourcesShift).not.toHaveBeenCalled();
});

it('shows the canonical availability page and revalidates on a durable HR hint', async () => {
  const request = { id: '50000000-0000-7000-8000-000000000081',
    rampProfileId: shift.rampProfileId, agentName: 'Riley Ramp',
    employeeNumber: 'DEV-RA-001', startsOn: '2026-08-17', endsOn: '2026-08-18',
    type: 'DayOff', status: 'Pending', reason: 'Synthetic planned leave',
    requestedAt: '2026-08-01T12:00:00Z', resolvedAt: null, resolutionNote: null };
  getHumanResourcesShifts.mockResolvedValue({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [] });
  getHumanResourcesAvailabilityRequests.mockResolvedValue({
    from: '2026-08-17', to: '2026-08-23', page: 1, limit: 20,
    hasMore: false, requests: [request],
  });
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
  expect(observerCallbacks).toHaveLength(1);
  await act(async () => observerCallbacks[0](['hr_absences']));
  await waitFor(() => expect(getHumanResourcesAvailabilityRequests)
    .toHaveBeenCalledTimes(2));
});

it('hides shift and request data together if the availability read revokes HR access', async () => {
  getHumanResourcesShifts.mockResolvedValue({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [shift] });
  getHumanResourcesAvailabilityRequests.mockRejectedValue({ status: 403 });
  render(<CurrentShiftsPage initialDate={initialDate} />);
  await waitFor(() => expect(screen.getByRole('alert'))
    .toHaveTextContent(/No tienes acceso a los turnos/));
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nuevo turno' })).not.toBeInTheDocument();
});
