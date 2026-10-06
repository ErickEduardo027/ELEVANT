import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CurrentShiftsPage from './CurrentShiftsPage';
import { getHumanResourcesShifts, recordHumanResourcesShift } from '../../../services/humanResourcesShiftsReadService';
import { getHumanResourcesAvailabilityRequests } from
  '../../../services/humanResourcesAvailabilityService';
import { getHumanResourcesScheduleWarnings } from
  '../../../services/humanResourcesScheduleWarningsService';

vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getHumanResourcesShifts: vi.fn(),
  recordHumanResourcesShift: vi.fn(),
}));
vi.mock('../../../services/humanResourcesAvailabilityService', () => ({
  getHumanResourcesAvailabilityRequests: vi.fn(),
  recordHumanResourcesAvailabilityRequest: vi.fn(),
  resolveHumanResourcesAvailabilityRequest: vi.fn(),
}));
vi.mock('../../../services/humanResourcesScheduleWarningsService', () => ({
  getHumanResourcesScheduleWarnings: vi.fn(),
}));
const session = vi.hoisted(() => ({ token: 'test-token', stationScopes: [
  { stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ' },
] }));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session }) }));
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
  getHumanResourcesScheduleWarnings.mockImplementation(async query => ({
    ...query, hasMore: false, asOf: '2026-08-18T12:00:00Z',
    ruleVersion: 'dev-2026-10-05', ruleEffectiveOn: '2026-10-05', warnings: [],
  }));
});
afterEach(() => { cleanup(); vi.resetAllMocks(); observerCallbacks.length = 0; session.token = 'test-token'; });

it('removes a former account roster before its pending read completes', async () => {
  let resolveOld;
  getHumanResourcesShifts.mockImplementationOnce(() => new Promise(resolve => {
    resolveOld = resolve;
  })).mockResolvedValue({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [] });
  const view = render(<CurrentShiftsPage initialDate={initialDate} />);
  await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
  session.token = 'next-account';
  view.rerender(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText(/No hay turnos registrados/)).toBeInTheDocument();
  await act(async () => resolveOld({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [shift] }));
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

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

it('reads a fifteen-day window and keeps absence requests on the anchor week', async () => {
  getHumanResourcesShifts.mockImplementation(async query => ({
    ...query, hasMore: false, shifts: [shift],
  }));
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: '15 días' }));

  await waitFor(() => expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-08-18', to: '2026-09-01', page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) })));
  expect(screen.getByText(/Ausencias y solicitudes · semana del/)).toBeInTheDocument();
  expect(getHumanResourcesAvailabilityRequests).toHaveBeenCalledWith(
    { from: '2026-08-17', to: '2026-08-23', page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
});

it('reads the full month, navigates to the next month, and resets pagination on mode change', async () => {
  getHumanResourcesShifts.mockImplementation(async query => ({
    ...query, hasMore: true, shifts: [shift],
  }));
  render(<CurrentShiftsPage initialDate={initialDate} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  await userEvent.click(within(screen.getByRole('navigation', { name: 'Páginas de turnos' }))
    .getByRole('button', { name: 'Siguiente página' }));
  await waitFor(() => expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-08-17', to: '2026-08-23', page: 2, limit: 20 },
    expect.anything()));

  await userEvent.click(screen.getByRole('button', { name: 'Mes' }));
  await waitFor(() => expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-08-01', to: '2026-08-31', page: 1, limit: 20 },
    expect.anything()));
  await userEvent.click(screen.getByRole('button', { name: 'Período siguiente' }));
  await waitFor(() => expect(getHumanResourcesShifts).toHaveBeenCalledWith(
    { from: '2026-09-01', to: '2026-09-30', page: 1, limit: 20 },
    expect.anything()));
});

it('does not repaint an old week after switching to an empty month', async () => {
  let resolveWeek;
  getHumanResourcesShifts.mockImplementation(query => query.from === '2026-08-17'
    ? new Promise(resolve => { resolveWeek = resolve; })
    : Promise.resolve({ ...query, hasMore: false, shifts: [] }));
  render(<CurrentShiftsPage initialDate={initialDate} />);
  await waitFor(() => expect(resolveWeek).toBeTypeOf('function'));
  await userEvent.click(screen.getByRole('button', { name: 'Mes' }));
  expect(await screen.findByText(/No hay turnos registrados/)).toBeInTheDocument();

  await act(async () => resolveWeek({ from: '2026-08-17', to: '2026-08-23',
    page: 1, limit: 20, hasMore: false, shifts: [shift] }));

  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  expect(screen.getByText(/No hay turnos registrados/)).toBeInTheDocument();
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
