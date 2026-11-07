import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AvailabilityRequestsPanel from './AvailabilityRequestsPanel';
import { amendHumanResourcesAvailabilityRequest, getHumanResourcesAvailabilityRequests,
  recordHumanResourcesAvailabilityRequest,
  resolveHumanResourcesAvailabilityRequest } from
  '../../../services/humanResourcesAvailabilityService';
import { addDays, businessToday } from '../../../services/businessDay';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';

vi.mock('../../../services/humanResourcesAvailabilityService', () => ({
  amendHumanResourcesAvailabilityRequest: vi.fn(),
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
  requestedAt: '2026-09-30T12:00:00Z', resolvedAt: null, resolutionNote: null, version: 'AAAAAAAAB9E=' };
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
  // The decision carries the version on screen and the intent's key (2-N08).
  await waitFor(() => expect(resolveHumanResourcesAvailabilityRequest)
    .toHaveBeenCalledWith(id, { decision: 'Approve', note: null, expectedVersion: 'AAAAAAAAB9E=' },
      expect.stringMatching(/^[0-9a-f-]{36}$/)));
  // The answer does not say what was released: OCC hears only of each released operation, never "the" notice.
  const approved = await screen.findByText(/Solicitud aprobada\. Si el agente tenía coberturas/);
  expect(approved).toHaveTextContent('se liberaron; OCC recibe un aviso por cada operación liberada.');
  expect(approved).not.toHaveTextContent(/OCC recibió el aviso/);
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
  resolveHumanResourcesAvailabilityRequest.mockRejectedValueOnce({ status: 409, code: 'agent_has_operation_in_progress' });
  const user = userEvent.setup();
  const { rerender } = render(<AvailabilityRequestsPanel from={from} to={to}
    revision={0} onDenied={onDenied} />);
  await screen.findByText('Synthetic planned leave');
  await user.click(screen.getByRole('button', { name: 'Aprobar' }));
  // Only the agent unblocks it by sending the operation from the tablet; OCC has no action that closes it.
  const refusal = await screen.findByText(/tiene una operación en curso o devuelta/);
  expect(refusal).toHaveTextContent('Debe enviarla desde la tablet (si fue devuelta, corregirla y reenviarla)');
  expect(refusal).not.toHaveTextContent(/OCC/);
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
    { decision: 'Cancel', note: 'El agente desistió', expectedVersion: 'AAAAAAAAB9E=' }, expect.any(String));
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

it('retries an uncertain decision with the same key and body', async () => {
  getHumanResourcesAvailabilityRequests.mockResolvedValue(page([row]));
  resolveHumanResourcesAvailabilityRequest.mockRejectedValueOnce(new Error('timeout'))
    .mockResolvedValueOnce({ id, status: 'Approved' });
  const user = userEvent.setup();
  render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
  await user.click(await screen.findByRole('button', { name: 'Aprobar' }));
  await user.click(await screen.findByRole('button', { name: 'Reintentar misma decisión' }));
  await waitFor(() => expect(resolveHumanResourcesAvailabilityRequest).toHaveBeenCalledTimes(2));
  expect(resolveHumanResourcesAvailabilityRequest.mock.calls[1]).toEqual(resolveHumanResourcesAvailabilityRequest.mock.calls[0]);
});

describe('approved absences (2-N22)', () => {
  const today = businessToday();
  const approved = (startsIn, endsIn, type = 'DayOff') => ({ ...row, status: 'Approved', type,
    startsOn: addDays(today, startsIn), endsOn: addDays(today, endsIn), resolvedAt: '2026-09-30T13:00:00Z' });

  it('cancels one that has not started with a reason, its version and a key, and re-reads the week', async () => {
    const onChanged = vi.fn();
    const future = approved(3, 5);
    getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([future]))
      .mockResolvedValueOnce(page([{ ...future, status: 'Cancelled' }]));
    amendHumanResourcesAvailabilityRequest.mockResolvedValue({ id, status: 'Cancelled', endsOn: future.endsOn,
      version: 'AAAAAAAAB9I=' });
    const user = userEvent.setup();
    render(<AvailabilityRequestsPanel from={from} to={to} revision={0} onChanged={onChanged} />);
    await user.click(await screen.findByRole('button', { name: 'Cancelar ausencia' }));
    const form = screen.getByRole('form', { name: 'Cancelar la ausencia de Riley Ramp' });
    await user.type(within(form).getByRole('textbox', { name: 'Motivo del cambio' }), '  Se pospone a enero ');
    await user.click(within(form).getByRole('button', { name: 'Confirmar cancelación de la ausencia' }));
    await waitFor(() => expect(amendHumanResourcesAvailabilityRequest).toHaveBeenCalledWith(id,
      { action: 'Cancel', endsOn: null, reason: 'Se pospone a enero', expectedVersion: 'AAAAAAAAB9E=' },
      expect.stringMatching(/^[0-9a-f-]{36}$/)));
    expect(await screen.findByText(/Ausencia cancelada\. Lo que su aprobación liberó no vuelve/)).toBeInTheDocument();
    expect(await screen.findByText('Cancelada')).toBeInTheDocument();
    expect(onChanged).toHaveBeenCalledTimes(1);
  });

  it('shortens one in progress to a day no earlier than yesterday and explains a refusal by its code', async () => {
    const running = approved(-2, 4, 'Restriction');
    getHumanResourcesAvailabilityRequests.mockResolvedValue(page([running]));
    amendHumanResourcesAvailabilityRequest.mockRejectedValueOnce({ status: 400, code: 'absence_end_invalid' })
      .mockResolvedValueOnce({ id, status: 'Approved', endsOn: today, version: 'AAAAAAAAB9I=' });
    const user = userEvent.setup();
    render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
    // It already started: it is shortened, never cancelled.
    expect(await screen.findByRole('button', { name: 'Acortar ausencia' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar ausencia' })).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Acortar ausencia' }));
    const form = screen.getByRole('form', { name: 'Acortar la ausencia de Riley Ramp' });
    const day = within(form).getByLabelText('Nuevo último día');
    expect(day).toHaveAttribute('min', addDays(today, -1));
    expect(day).toHaveAttribute('max', addDays(today, 3));
    await user.clear(day);
    await user.type(day, today);
    await user.type(within(form).getByRole('textbox', { name: 'Motivo del cambio' }), 'Alta médica anticipada');
    await user.click(within(form).getByRole('button', { name: 'Confirmar nuevo último día' }));
    expect(await screen.findByText(/El nuevo último día debe ser anterior al actual/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Confirmar nuevo último día' }));
    await waitFor(() => expect(amendHumanResourcesAvailabilityRequest).toHaveBeenCalledTimes(2));
    expect(amendHumanResourcesAvailabilityRequest.mock.calls[1][1]).toEqual({ action: 'Shorten', endsOn: today,
      reason: 'Alta médica anticipada', expectedVersion: 'AAAAAAAAB9E=' });
    // A 4xx settled the first intent: the second attempt is a new one.
    expect(amendHumanResourcesAvailabilityRequest.mock.calls[1][2]).not.toBe(amendHumanResourcesAvailabilityRequest.mock.calls[0][2]);
    expect(await screen.findByText(/Ausencia acortada/)).toBeInTheDocument();
  });

  it('offers nothing on an absence that ended, on a shift change or without the decide permission', async () => {
    getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([approved(-5, -1),
      { ...approved(3, 4, 'ShiftChange'), id: '50000000-0000-7000-8000-000000000082' }]));
    render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
    await screen.findAllByText('Aprobada');
    expect(screen.queryByRole('button', { name: 'Acortar ausencia' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Cancelar ausencia' })).not.toBeInTheDocument();
    cleanup();
    useOptionalDepartmentAccess.mockReturnValue({ can: () => false });
    getHumanResourcesAvailabilityRequests.mockResolvedValueOnce(page([approved(3, 5)]));
    render(<AvailabilityRequestsPanel from={from} to={to} revision={0} />);
    await screen.findByText('Aprobada');
    expect(screen.queryByRole('button', { name: 'Cancelar ausencia' })).not.toBeInTheDocument();
  });
});
