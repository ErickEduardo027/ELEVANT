import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ShiftRecordForm from './ShiftRecordForm';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesShiftAssignmentOptions, recordHumanResourcesShift } from
  '../../../services/humanResourcesShiftsReadService';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));
vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getHumanResourcesShiftAssignmentOptions: vi.fn(), recordHumanResourcesShift: vi.fn(),
}));

const agentId = '50000000-0000-7000-8000-000000000001';
const stationId = '20000000-0000-7000-8000-000000000003';
const terminalId = '20000000-0000-7000-8000-000000000004';
const options = { rampProfileId: agentId, workDate: '2026-10-01', hasShift: false,
  stations: [{ id: stationId, code: 'PUJ', terminals: [{ id: terminalId, code: 'A' }] }] };

function catalog() {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }] });
}

async function selectAssignment(user) {
  await user.selectOptions(await screen.findByLabelText('Agente de rampa'), agentId);
  await screen.findByLabelText('Estación');
  await user.selectOptions(screen.getByLabelText('Estación'), stationId);
  await user.selectOptions(screen.getByLabelText('Terminal'), terminalId);
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('records one current agent/date scoped terminal with a client-chosen UUID', async () => {
  catalog();
  getHumanResourcesShiftAssignmentOptions.mockResolvedValue(options);
  recordHumanResourcesShift.mockImplementation(async id => ({ id }));
  const user = userEvent.setup();
  const onRecorded = vi.fn();
  render(<ShiftRecordForm initialWorkDate="2026-10-01" onRecorded={onRecorded}
    onClose={vi.fn()} onDenied={vi.fn()} />);
  await selectAssignment(user);
  expect(getHumanResourcesShiftAssignmentOptions).toHaveBeenCalledWith(
    { rampProfileId: agentId, workDate: '2026-10-01' },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await user.click(screen.getByRole('button', { name: 'Registrar turno' }));
  await waitFor(() => expect(recordHumanResourcesShift).toHaveBeenCalledTimes(1));
  const [id, request] = recordHumanResourcesShift.mock.calls[0];
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(request).toEqual({ rampProfileId: agentId, stationId, terminalId,
    workDate: '2026-10-01', startsAtLocal: '06:00:00', endsAtLocal: '14:00:00',
    notes: null });
  await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ id }));
});

it('retries an uncertain write with the same UUID and payload', async () => {
  catalog();
  getHumanResourcesShiftAssignmentOptions.mockResolvedValue(options);
  recordHumanResourcesShift.mockRejectedValueOnce(new TypeError('network'))
    .mockImplementation(async id => ({ id }));
  const user = userEvent.setup();
  render(<ShiftRecordForm initialWorkDate="2026-10-01" onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={vi.fn()} />);
  await selectAssignment(user);
  await user.click(screen.getByRole('button', { name: 'Registrar turno' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos confirmar/);
  await user.click(screen.getByRole('button', { name: 'Reintentar el mismo registro' }));
  await waitFor(() => expect(recordHumanResourcesShift).toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesShift.mock.calls[1]).toEqual(recordHumanResourcesShift.mock.calls[0]);
});

it('rechecks after a competing shift and prevents another write for that day', async () => {
  catalog();
  getHumanResourcesShiftAssignmentOptions.mockResolvedValueOnce(options)
    .mockResolvedValueOnce({ ...options, hasShift: true });
  recordHumanResourcesShift.mockRejectedValueOnce({ status: 409 });
  const user = userEvent.setup();
  render(<ShiftRecordForm initialWorkDate="2026-10-01" onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={vi.fn()} />);
  await selectAssignment(user);
  await user.click(screen.getByRole('button', { name: 'Registrar turno' }));
  expect(await screen.findByText(/Ya hay un turno registrado/)).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Registrar turno' })).toBeDisabled();
  expect(recordHumanResourcesShift).toHaveBeenCalledTimes(1);
});

it('closes access when exact assignment choices are forbidden', async () => {
  catalog();
  getHumanResourcesShiftAssignmentOptions.mockRejectedValue({ status: 403 });
  const onDenied = vi.fn();
  const user = userEvent.setup();
  render(<ShiftRecordForm initialWorkDate="2026-10-01" onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={onDenied} />);
  await user.selectOptions(await screen.findByLabelText('Agente de rampa'), agentId);
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(403));
  expect(recordHumanResourcesShift).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Registrar turno' })).toBeDisabled();
});
