import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PermitRecordForm from './PermitRecordForm';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesPermits, recordHumanResourcesPermit } from
  '../../../services/humanResourcesPermitsReadService';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));
vi.mock('../../../services/humanResourcesPermitsReadService', () => ({
  getHumanResourcesPermits: vi.fn(), recordHumanResourcesPermit: vi.fn(),
}));

const agentId = '50000000-0000-7000-8000-000000000001';
const currentId = '50000000-0000-7000-8000-000000000003';
const current = { id: currentId, rampProfileId: agentId, documentType: 'AirportId',
  agentName: 'Riley Ramp', cycleNumber: 1 };

function catalog() {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }] });
}

async function fillPermit(user) {
  await user.type(screen.getByLabelText('Número de documento'), 'DEV-AIRPORT-NEW');
  await user.type(screen.getByLabelText('Fecha de emisión'), '2026-02-01');
  await user.type(screen.getByLabelText('Fecha de vencimiento'), '2099-12-31');
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('records a first permit only after the exact agent and type lookup is empty', async () => {
  catalog();
  getHumanResourcesPermits.mockResolvedValue({ page: 1, limit: 1, hasMore: false, permits: [] });
  recordHumanResourcesPermit.mockImplementation(async id => ({ id, cycleNumber: 1 }));
  const user = userEvent.setup();
  const onRecorded = vi.fn();
  render(<PermitRecordForm onRecorded={onRecorded} onClose={vi.fn()} onDenied={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('Agente de rampa'), agentId);
  await user.selectOptions(screen.getByLabelText('Tipo de documento'), 'AirportId');
  expect(await screen.findByText(/Primer ciclo para este agente y documento/)).toBeInTheDocument();
  await fillPermit(user);
  await user.click(screen.getByRole('button', { name: 'Registrar permiso' }));
  await waitFor(() => expect(recordHumanResourcesPermit).toHaveBeenCalledTimes(1));
  const [id, request] = recordHumanResourcesPermit.mock.calls[0];
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(request).toMatchObject({ rampProfileId: agentId, documentType: 'AirportId',
    expectedCurrentId: null, documentNumber: 'DEV-AIRPORT-NEW' });
  expect(getHumanResourcesPermits).toHaveBeenCalledWith({ page: 1, limit: 1,
    rampProfileId: agentId, documentType: 'AirportId' },
  expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ id, cycleNumber: 1 }));
});

it('renews the observed permit and retries an uncertain response with the same UUID', async () => {
  catalog();
  getHumanResourcesPermits.mockResolvedValue({ page: 1, limit: 1,
    hasMore: false, permits: [current] });
  recordHumanResourcesPermit.mockRejectedValueOnce(new TypeError('network'))
    .mockImplementation(async id => ({ id, cycleNumber: 2 }));
  const user = userEvent.setup();
  render(<PermitRecordForm initialPermit={current} onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={vi.fn()} />);
  expect(await screen.findByText(/Renovará el ciclo 1/)).toBeInTheDocument();
  await fillPermit(user);
  await user.click(screen.getByRole('button', { name: 'Guardar renovación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos confirmar/);
  await user.click(screen.getByRole('button', { name: 'Reintentar el mismo registro' }));
  await waitFor(() => expect(recordHumanResourcesPermit).toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesPermit.mock.calls[1]).toEqual(recordHumanResourcesPermit.mock.calls[0]);
  expect(recordHumanResourcesPermit.mock.calls[1][1].expectedCurrentId).toBe(currentId);
});

it('re-reads the exact pair after 409 before allowing another intent', async () => {
  catalog();
  const nextCurrent = { ...current, id: '50000000-0000-7000-8000-000000000044', cycleNumber: 2 };
  let resolveRecheck;
  getHumanResourcesPermits.mockResolvedValueOnce({ page: 1, limit: 1,
    hasMore: false, permits: [current] })
    .mockImplementationOnce(() => new Promise(resolve => { resolveRecheck = resolve; }));
  recordHumanResourcesPermit.mockRejectedValueOnce({ status: 409 })
    .mockImplementation(async id => ({ id, cycleNumber: 3 }));
  const user = userEvent.setup();
  render(<PermitRecordForm initialPermit={current} onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={vi.fn()} />);
  expect(await screen.findByText(/Renovará el ciclo 1/)).toBeInTheDocument();
  await fillPermit(user);
  await user.click(screen.getByRole('button', { name: 'Guardar renovación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/ciclo cambió/);
  expect(screen.getByRole('button', { name: 'Registrar permiso' })).toBeDisabled();
  resolveRecheck({ page: 1, limit: 1, hasMore: false, permits: [nextCurrent] });
  expect(await screen.findByText(/Renovará el ciclo 2/)).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Guardar renovación' }));
  await waitFor(() => expect(recordHumanResourcesPermit).toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesPermit.mock.calls[1][0]).not.toBe(recordHumanResourcesPermit.mock.calls[0][0]);
  expect(recordHumanResourcesPermit.mock.calls[1][1].expectedCurrentId).toBe(nextCurrent.id);
});

it('closes access on a denied exact lookup without sending a write', async () => {
  catalog();
  getHumanResourcesPermits.mockRejectedValue({ status: 403 });
  const onDenied = vi.fn();
  render(<PermitRecordForm initialPermit={current} onRecorded={vi.fn()}
    onClose={vi.fn()} onDenied={onDenied} />);
  await waitFor(() => expect(onDenied).toHaveBeenCalledWith(403));
  expect(recordHumanResourcesPermit).not.toHaveBeenCalled();
  expect(screen.getByRole('button', { name: 'Registrar permiso' })).toBeDisabled();
});