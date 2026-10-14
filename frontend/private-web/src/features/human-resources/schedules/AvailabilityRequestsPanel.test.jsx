import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AvailabilityRequestsPanel from './AvailabilityRequestsPanel';
import { getHumanResourcesAvailabilityRequests,
  recordHumanResourcesAvailabilityRequest,
  resolveHumanResourcesAvailabilityRequest } from
  '../../../services/humanResourcesAvailabilityService';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';

vi.mock('../../../services/humanResourcesAvailabilityService', () => ({
  getHumanResourcesAvailabilityRequests: vi.fn(),
  recordHumanResourcesAvailabilityRequest: vi.fn(),
  resolveHumanResourcesAvailabilityRequest: vi.fn(),
}));
vi.mock('../../../services/commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));
vi.mock('../../access/DepartmentAccessContext', () => ({ useOptionalDepartmentAccess: vi.fn() }));

const id = '50000000-0000-7000-8000-000000000081';
const agentId = '50000000-0000-7000-8000-000000000001';
const from = '2026-10-05';
const to = '2026-10-11';
const row = { id, rampProfileId: agentId, agentName: 'Riley Ramp',
  employeeNumber: 'DEV-RA-001', startsOn: from, endsOn: '2026-10-06',
  type: 'DayOff', status: 'Pending', reason: 'Synthetic planned leave',
  requestedAt: '2026-09-30T12:00:00Z', resolvedAt: null, resolutionNote: null };
const page = (requests, number = 1, hasMore = false) =>
  ({ from, to, page: number, limit: 20, hasMore, requests });

beforeEach(() => {
  useOptionalDepartmentAccess.mockReturnValue({ can: code => code === 'human_resources.availability.decide' });
});

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('reads only the selected week and pages real HR requests without prototype rows', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row], 1, true))
    .mockResolvedValueOnce(page([], 2));
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
  expect(screen.getByText('Riley Ramp')).toBeInTheDocument();
  expect(getHumanResourcesAvailabilityRequests).toHaveBeenCalledWith(
    { from, to, page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await userEvent.click(screen.getByRole('button', { name: 'Siguiente página de solicitudes' }));
  expect(await screen.findByText(/No hay solicitudes en esta semana/)).toBeInTheDocument();
  expect(screen.queryByText('Synthetic planned leave')).not.toBeInTheDocument();
});

it('records and decides a request, then re-reads the authoritative page', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }] });
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([row]))
    .mockResolvedValueOnce(page([{ ...row, status: 'Approved',
      resolvedAt: '2026-09-30T13:00:00Z' }]));
  recordHumanResourcesAvailabilityRequest.mockImplementation(async requestId =>
    ({ id: requestId, status: 'Pending' }));
  resolveHumanResourcesAvailabilityRequest.mockResolvedValue({ id, status: 'Approved' });
  const user = userEvent.setup();
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await screen.findByText(/No hay solicitudes en esta semana/);
  await user.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
  await user.selectOptions(await screen.findByLabelText('Agente'), agentId);
  await user.type(screen.getByLabelText('Motivo'), 'Synthetic planned leave');
  await user.click(screen.getByRole('button', { name: 'Registrar solicitud' }));
  await waitFor(() => expect(recordHumanResourcesAvailabilityRequest)
    .toHaveBeenCalledWith(expect.any(String), {
      rampProfileId: agentId, startsOn: from, endsOn: from,
      type: 'DayOff', reason: 'Synthetic planned leave',
    }));
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Aprobar' }));
  await waitFor(() => expect(resolveHumanResourcesAvailabilityRequest)
    .toHaveBeenCalledWith(id, { decision: 'Approve', note: null }));
  expect(await screen.findByText('Aprobada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
});

it('hides stale private rows and error details after a failed revalidation', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row]))
    .mockRejectedValueOnce(new Error('private SQL trace'));
  const { rerender } = render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
  rerender(<AvailabilityRequestsPanel from={from} to={to} revision={1} />);
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudieron cargar las solicitudes/);
  expect(screen.queryByText('Synthetic planned leave')).not.toBeInTheDocument();
  expect(screen.queryByText('private SQL trace')).not.toBeInTheDocument();
});

it('retries an uncertain record with the same UUID and locked intention', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }] });
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([]))
    .mockResolvedValueOnce(page([row]));
  recordHumanResourcesAvailabilityRequest.mockRejectedValueOnce(new Error('timeout'))
    .mockImplementationOnce(async requestId => ({ id: requestId, status: 'Pending' }));
  const user = userEvent.setup();
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await screen.findByText(/No hay solicitudes en esta semana/);
  await user.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
  await user.selectOptions(await screen.findByLabelText('Agente'), agentId);
  await user.type(screen.getByLabelText('Motivo'), 'Synthetic planned leave');
  await user.click(screen.getByRole('button', { name: 'Registrar solicitud' }));
  expect(await screen.findByText(/No pudimos confirmar el resultado/)).toBeInTheDocument();
  expect(screen.getByLabelText('Motivo')).toBeDisabled();
  await user.click(screen.getByRole('button', { name: 'Reintentar la misma solicitud' }));
  await waitFor(() => expect(recordHumanResourcesAvailabilityRequest)
    .toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesAvailabilityRequest.mock.calls[1])
    .toEqual(recordHumanResourcesAvailabilityRequest.mock.calls[0]);
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
});

it('keeps an uncertain UUID through a live revalidation before retry', async () => {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }] });
  getHumanResourcesAvailabilityRequests.mockResolvedValue(page([]));
  recordHumanResourcesAvailabilityRequest.mockRejectedValueOnce(new Error('timeout'))
    .mockImplementationOnce(async requestId => ({ id: requestId, status: 'Pending' }));
  const user = userEvent.setup();
  const { rerender } = render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await screen.findByText(/No hay solicitudes en esta semana/);
  await user.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
  await user.selectOptions(await screen.findByLabelText('Agente'), agentId);
  await user.type(screen.getByLabelText('Motivo'), 'Synthetic planned leave');
  await user.click(screen.getByRole('button', { name: 'Registrar solicitud' }));
  expect(await screen.findByRole('button', { name: 'Reintentar la misma solicitud' }))
    .toBeInTheDocument();
  rerender(<AvailabilityRequestsPanel from={from} to={to} revision={1} />);
  expect(await screen.findByText(/No hay solicitudes en esta semana/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reintentar la misma solicitud' }));
  await waitFor(() => expect(recordHumanResourcesAvailabilityRequest)
    .toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesAvailabilityRequest.mock.calls[1])
    .toEqual(recordHumanResourcesAvailabilityRequest.mock.calls[0]);
});

it('fails closed on role loss and rechecks a colliding resolution', async () => {
  const onDenied = vi.fn();
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row]))
    .mockResolvedValueOnce(page([{ ...row, status: 'Approved',
      resolvedAt: '2026-09-30T13:00:00Z' }]))
    .mockRejectedValueOnce({ status: 403 });
  resolveHumanResourcesAvailabilityRequest.mockRejectedValueOnce({ status: 409 });
  const user = userEvent.setup();
  const { rerender } = render(<AvailabilityRequestsPanel from={from} to={to}
    revision={0} onDenied={onDenied} />);
  await screen.findByText('Synthetic planned leave');
  await user.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(await screen.findByText(/conserva una asignación activa/)).toBeInTheDocument();
  expect(screen.getByText('Aprobada')).toBeInTheDocument();
  rerender(<AvailabilityRequestsPanel from={from} to={to}
    revision={1} onDenied={onDenied} />);
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(403));
  expect(screen.queryByText('Synthetic planned leave')).not.toBeInTheDocument();
});

it('closes a request form when the live ramp profile catalog denies HR access', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValue(page([]));
  getRampProfiles.mockRejectedValue({ status: 403 });
  const onDenied = vi.fn();
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0}
    onDenied={onDenied} />);
  await screen.findByText(/No hay solicitudes en esta semana/);
  await userEvent.click(screen.getByRole('button', { name: 'Nueva solicitud' }));
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(403));
  expect(screen.queryByLabelText('Motivo')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Registrar solicitud' }))
    .not.toBeInTheDocument();
});

it('reconciles an uncertain decision when a later read confirms approval', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row]))
    .mockResolvedValueOnce(page([{ ...row, status: 'Approved',
      resolvedAt: '2026-09-30T13:00:00Z' }]));
  resolveHumanResourcesAvailabilityRequest.mockRejectedValue(new Error('timeout'));
  const { rerender } = render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await screen.findByText('Synthetic planned leave');
  await userEvent.click(screen.getByRole('button', { name: 'Aprobar' }));
  expect(await screen.findByRole('button', { name: 'Reintentar misma decisión' }))
    .toBeInTheDocument();
  rerender(<AvailabilityRequestsPanel from={from} to={to} revision={1} />);
  expect(await screen.findByText('Aprobada')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Reintentar misma decisión' }))
    .not.toBeInTheDocument();
});
it('cancels a pending request with a reason and hides decisions without the decide permission', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row]))
    .mockResolvedValueOnce(page([{ ...row, status: 'Cancelled', resolutionNote: 'El agente desistió' }]));
  resolveHumanResourcesAvailabilityRequest.mockResolvedValue({ id, status: 'Cancelled' });
  const user = userEvent.setup();
  const { unmount } = render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await user.click(await screen.findByRole('button', { name: 'Cancelar solicitud' }));
  const form = screen.getByRole('form', { name: 'Cancelar solicitud de Riley Ramp' });
  await user.type(within(form).getByRole('textbox', { name: 'Motivo de la cancelación' }), '  El agente desistió ');
  await user.click(within(form).getByRole('button', { name: 'Confirmar cancelación' }));
  expect(resolveHumanResourcesAvailabilityRequest).toHaveBeenCalledWith(id,
    { decision: 'Cancel', note: 'El agente desistió' });
  expect(await screen.findByText('Solicitud cancelada.')).toBeInTheDocument();
  expect(await screen.findByText('Cancelada')).toBeInTheDocument();
  unmount();

  useOptionalDepartmentAccess.mockReturnValue({ can: () => false });
  getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([row]));
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  expect(await screen.findByText('Synthetic planned leave')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Aprobar' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Cancelar solicitud' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Nueva solicitud' })).not.toBeInTheDocument();
});
