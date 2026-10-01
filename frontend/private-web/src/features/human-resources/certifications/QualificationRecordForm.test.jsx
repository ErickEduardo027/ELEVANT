import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import QualificationRecordForm from './QualificationRecordForm';
import { getRampProfiles } from '../../../services/commercialGovernanceApi';
import { getHumanResourcesQualificationEquipmentTypes, getHumanResourcesQualifications,
  recordHumanResourcesQualification } from '../../../services/humanResourcesQualificationsReadService';

vi.mock('../../../services/commercialGovernanceApi', () => ({ getRampProfiles: vi.fn() }));
vi.mock('../../../services/humanResourcesQualificationsReadService', () => ({
  getHumanResourcesQualificationEquipmentTypes: vi.fn(),
  getHumanResourcesQualifications: vi.fn(),
  recordHumanResourcesQualification: vi.fn(),
}));

const agentId = '50000000-0000-7000-8000-000000000001';
const equipmentId = '20000000-0000-7000-8000-000000000007';
const currentId = '50000000-0000-7000-8000-000000000002';
const current = { id: currentId, rampProfileId: agentId, equipmentTypeId: equipmentId,
  agentName: 'Riley Ramp', equipmentName: 'Ground power unit', cycleNumber: 1 };

function catalogs() {
  getRampProfiles.mockResolvedValue({ profiles: [{ id: agentId, firstName: 'Riley',
    lastName: 'Ramp', employeeNumber: 'DEV-RA-001', isActive: true }], availableStations: [] });
  getHumanResourcesQualificationEquipmentTypes.mockResolvedValue([
    { id: equipmentId, code: 'GPU', name: 'Ground power unit' },
  ]);
}

async function fillDatesAndIssuer(user) {
  await user.type(screen.getByLabelText('Fecha de formación'), '2026-01-02');
  await user.type(screen.getByLabelText('Fecha de obtención'), '2026-01-03');
  await user.type(screen.getByLabelText('Fecha de vencimiento'), '2099-12-31');
  await user.type(screen.getByLabelText('Entidad certificadora'), 'Synthetic Training Center');
  await user.type(screen.getByLabelText('Instructor'), 'Development Instructor');
}

afterEach(() => { cleanup(); vi.resetAllMocks(); });

it('records the first real cycle only after an exact empty lookup', async () => {
  catalogs();
  getHumanResourcesQualifications.mockResolvedValue({ page: 1, limit: 1,
    hasMore: false, qualifications: [] });
  recordHumanResourcesQualification.mockImplementation(async id => ({ id, cycleNumber: 1 }));
  const onRecorded = vi.fn();
  const user = userEvent.setup();
  render(<QualificationRecordForm onRecorded={onRecorded} onClose={vi.fn()} onDenied={vi.fn()} />);
  await user.selectOptions(await screen.findByLabelText('Agente de rampa'), agentId);
  await user.selectOptions(screen.getByLabelText('Equipo'), equipmentId);
  expect(await screen.findByText(/Primer ciclo para este agente y equipo/)).toBeInTheDocument();
  await fillDatesAndIssuer(user);
  await user.click(screen.getByRole('button', { name: 'Registrar habilitación' }));
  await waitFor(() => expect(recordHumanResourcesQualification).toHaveBeenCalledTimes(1));
  const [id, request] = recordHumanResourcesQualification.mock.calls[0];
  expect(id).toMatch(/^[0-9a-f-]{36}$/i);
  expect(request).toMatchObject({ rampProfileId: agentId, equipmentTypeId: equipmentId,
    expectedCurrentId: null, obtainedOn: '2026-01-03' });
  expect(getHumanResourcesQualifications).toHaveBeenCalledWith({ page: 1, limit: 1,
    rampProfileId: agentId, equipmentTypeId: equipmentId },
  expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await waitFor(() => expect(onRecorded).toHaveBeenCalledWith({ id, cycleNumber: 1 }));
});

it('renews the observed cycle and reuses its UUID after an uncertain response', async () => {
  catalogs();
  getHumanResourcesQualifications.mockResolvedValue({ page: 1, limit: 1,
    hasMore: false, qualifications: [current] });
  recordHumanResourcesQualification.mockRejectedValueOnce(new TypeError('network')).mockImplementation(
    async id => ({ id, cycleNumber: 2 }));
  const user = userEvent.setup();
  render(<QualificationRecordForm initialQualification={current}
    onRecorded={vi.fn()} onClose={vi.fn()} onDenied={vi.fn()} />);
  expect(await screen.findByText(/Renovará el ciclo 1/)).toBeInTheDocument();
  await fillDatesAndIssuer(user);
  await user.click(screen.getByRole('button', { name: 'Guardar renovación' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No pudimos confirmar/);
  await user.click(screen.getByRole('button', { name: 'Reintentar el mismo registro' }));
  await waitFor(() => expect(recordHumanResourcesQualification).toHaveBeenCalledTimes(2));
  expect(recordHumanResourcesQualification.mock.calls[1][0])
    .toBe(recordHumanResourcesQualification.mock.calls[0][0]);
  expect(recordHumanResourcesQualification.mock.calls[1][1])
    .toMatchObject({ expectedCurrentId: currentId });
});
