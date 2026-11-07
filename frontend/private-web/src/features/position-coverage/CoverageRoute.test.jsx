import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import CoverageRoute from './CoverageRoute';
import { createOccCoverage, loadOccCoverage, releaseOccCoverage, updateOccStandAttributes } from '../../services/occCoverageService';

const stationId = '20000000-0000-0000-0000-000000000003';
vi.mock('../auth/AuthContext', () => ({ useAuth: () => ({ session: { stationScopes: [{ stationId, stationCode: 'PUJ' }] } }) }));
vi.mock('../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn().mockResolvedValue(undefined), stop: vi.fn().mockResolvedValue(undefined) }),
}));
vi.mock('../../services/occCoverageService', async importOriginal => ({
  ...(await importOriginal()),
  loadOccCoverage: vi.fn(), createOccCoverage: vi.fn(), releaseOccCoverage: vi.fn(), updateOccStandAttributes: vi.fn(),
}));

const terminalA = { terminalId: 't-a', code: 'A', name: 'Terminal A', maxStandsPerAgent: 3, requiresBridgeQualification: false };
const terminalB = { terminalId: 't-b', code: 'B', name: 'Terminal B', maxStandsPerAgent: 2, requiresBridgeQualification: true };
const stand = (code, terminalId, extra = {}) => ({ standId: `s-${code}`, code, terminalId, isActive: true, hasBoardingBridge: false,
  isRemote: false, maxAircraftSize: null, coveredBy: [], version: `v-${code}`, ...extra });
const agent = { agentId: 'ag-1', name: 'Riley Ramp', employeeNumber: 'DEV-RA-001', terminalId: 't-a', terminalCode: 'A',
  shiftStartsAt: '2026-08-19T10:00:00Z', shiftEndsAt: '2026-08-19T18:00:00Z', isJunior: true, hasAirportPermit: true,
  hasDriverLicense: false, hasBridgeQualification: false, isAbsent: false };
const board = { stationId, stationCode: 'PUJ', date: '2026-08-19', canAssign: true, canConfigure: true,
  terminals: [terminalA, terminalB], stands: [stand('A01', 't-a'), stand('A02', 't-a'), stand('B01', 't-b', { hasBoardingBridge: true })],
  constraints: [], agents: [agent], coverages: [] };

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('assigns stands to an agent and explains every broken rule in Spanish', async () => {
  loadOccCoverage.mockResolvedValue(board);
  createOccCoverage.mockRejectedValueOnce(Object.assign(new Error('La cobertura no cumple las reglas de asignación.'),
    { status: 422, reasons: ['mentor_required'] }));
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-1' } });
  expect(within(form).getByText('Menos de 3 meses: va con mentor')).toBeInTheDocument();
  fireEvent.click(within(form).getByRole('button', { name: 'A01' }));
  fireEvent.click(within(form).getByRole('button', { name: 'A02' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  expect(await screen.findByText(/necesita un mentor experimentado/)).toBeInTheDocument();
  expect(createOccCoverage).toHaveBeenCalledWith(expect.objectContaining({ agentId: 'ag-1', terminalId: 't-a',
    standIds: ['s-A01', 's-A02'], isReinforcement: false }));

  const covered = { ...board, stands: [stand('A01', 't-a', { coveredBy: ['Riley Ramp'] }), ...board.stands.slice(1)],
    coverages: [{ id: 'cv-1', agentId: 'ag-1', agentName: 'Riley Ramp', terminalId: 't-a', terminalCode: 'A',
      stands: [{ standId: 's-A01', code: 'A01' }], startsAt: '2026-08-19T10:00:00Z', endsAt: '2026-08-19T18:00:00Z',
      mentorAgentId: null, mentorName: null, vehicleCode: null, isReinforcement: false }] };
  createOccCoverage.mockResolvedValueOnce(covered);
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  const day = await screen.findByRole('region', { name: 'Coberturas del día' });
  expect(await within(day).findByText('Riley Ramp')).toBeInTheDocument();
  releaseOccCoverage.mockResolvedValueOnce(board);
  fireEvent.click(within(day).getByRole('button', { name: 'Liberar' }));
  expect(releaseOccCoverage).toHaveBeenCalledWith('cv-1', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/));
});

it('switches terminals and shows the bridge stands of terminal B', async () => {
  loadOccCoverage.mockResolvedValue(board);
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Terminal B' }));
  const stands = screen.getByRole('region', { name: 'Posiciones de la terminal' });
  expect(within(stands).getByText('B01')).toBeInTheDocument();
  expect(within(stands).getByText('Puente')).toBeInTheDocument();
  expect(screen.getByText(/exige habilitación de puente/)).toBeInTheDocument();
});

it('explains in Configuración why a stand in use stays active, and where new stands are created (2-A)', async () => {
  const { translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  loadOccCoverage.mockResolvedValue(board);
  updateOccStandAttributes.mockRejectedValueOnce(translateCoverageError({ status: 422, code: 'stand_in_use',
    reasons: ['stand_in_use'] }));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const stands = screen.getByRole('region', { name: 'Atributos de las posiciones' });
  const row = within(stands).getByText('A01').closest('li');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('La posición tiene vuelos sin terminar o coberturas abiertas');
  // The change carries the stand's version on the board and the intent's key (2-A).
  expect(updateOccStandAttributes).toHaveBeenCalledWith('s-A01', expect.objectContaining({ isActive: false,
    expectedVersion: 'v-A01' }), expect.stringMatching(/^[0-9a-f-]{36}$/));
});

it('keeps the key of an uncertain stand change and reads the board again when the stand changed meanwhile (2-A)', async () => {
  const { translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  const renamed = { ...board, stands: [stand('A01', 't-a', { version: 'v-A01-b' }), ...board.stands.slice(1)] };
  loadOccCoverage.mockResolvedValueOnce(board).mockResolvedValueOnce(renamed);
  updateOccStandAttributes.mockRejectedValueOnce(Object.assign(new Error('No fue posible completar la acción. Intenta de nuevo.'),
    { status: null, reasons: [] }))
    .mockRejectedValueOnce(translateCoverageError({ status: 409, code: 'version_conflict' }));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const stands = screen.getByRole('region', { name: 'Atributos de las posiciones' });
  const row = within(stands).getByText('A01').closest('li');
  fireEvent.click(within(row).getByLabelText('Remota'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('No fue posible completar la acción');
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  // The stand changed in «Datos maestros»: the message stays while the board is read again with its new version.
  expect(await screen.findByText(/La posición cambió mientras la editabas, aquí o en «Datos maestros»/)).toBeInTheDocument();
  await waitFor(() => expect(loadOccCoverage).toHaveBeenCalledTimes(2));
  const [first, second] = updateOccStandAttributes.mock.calls;
  expect(second[2]).toBe(first[2]);
  expect(second[1]).toEqual({ date: expect.any(String), hasBoardingBridge: false, isRemote: true, maxAircraftSize: null,
    isActive: true, expectedVersion: 'v-A01' });
  expect(screen.queryByText(/data changed/i)).not.toBeInTheDocument();
});

it('explains why a stand of an inactive terminal is not reactivated from Configuración (2-A)', async () => {
  const { translateCoverageError } = await vi.importActual('../../services/occCoverageService');
  loadOccCoverage.mockResolvedValue({ ...board, stands: [stand('A01', 't-a', { isActive: false }), ...board.stands.slice(1)] });
  updateOccStandAttributes.mockRejectedValueOnce(translateCoverageError({ status: 422, code: 'terminal_inactive',
    reasons: ['terminal_inactive'] }));
  render(<CoverageRoute />);
  fireEvent.click(await screen.findByRole('button', { name: 'Configuración' }));
  const row = within(screen.getByRole('region', { name: 'Atributos de las posiciones' })).getByText('A01').closest('li');
  fireEvent.click(within(row).getByLabelText('Activa'));
  fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
  expect(await within(row).findByRole('alert')).toHaveTextContent('La terminal de esta posición está desactivada');
});

it('says where terminals are created when the station has none active', async () => {
  loadOccCoverage.mockResolvedValue({ ...board, terminals: [], stands: [] });
  render(<CoverageRoute />);
  expect(await screen.findByText(/La estación no tiene terminales activas. OCC las crea en «Datos maestros»./)).toBeInTheDocument();
});

it('marks absent or permitless mentors and explains the mentor rules of 2-N23', async () => {
  const absentMentor = { ...agent, agentId: 'ag-2', name: 'Mateo Ramp', isJunior: false, isAbsent: true };
  const permitless = { ...agent, agentId: 'ag-3', name: 'Lucía Ramp', isJunior: false, hasAirportPermit: false };
  const fit = { ...agent, agentId: 'ag-4', name: 'Pedro Ramp', isJunior: false };
  loadOccCoverage.mockResolvedValue({ ...board, agents: [agent, absentMentor, permitless, fit] });
  createOccCoverage.mockRejectedValueOnce(Object.assign(new Error('La cobertura no cumple las reglas de asignación.'),
    { status: 422, reasons: ['mentor_absent', 'mentor_permit_required'] }));
  render(<CoverageRoute />);
  const form = await screen.findByRole('form', { name: 'Asignar posiciones' });
  fireEvent.change(within(form).getByLabelText('Agente'), { target: { value: 'ag-1' } });
  const mentor = within(form).getByLabelText('Mentor');
  expect(within(mentor).getByRole('option', { name: 'Mateo Ramp · ausencia aprobada' })).toBeDisabled();
  expect(within(mentor).getByRole('option', { name: 'Lucía Ramp · carnet vencido' })).toBeDisabled();
  expect(within(mentor).getByRole('option', { name: 'Pedro Ramp' })).not.toBeDisabled();
  fireEvent.change(mentor, { target: { value: 'ag-4' } });
  fireEvent.click(within(form).getByRole('button', { name: 'A01' }));
  fireEvent.click(within(form).getByRole('button', { name: 'Asignar posiciones' }));
  // The server still decides: a mentor who became absent meanwhile is explained in Spanish.
  expect(await screen.findByText('El mentor tiene una ausencia aprobada ese día.')).toBeInTheDocument();
  expect(screen.getByText('El mentor no tiene el carnet aeroportuario vigente.')).toBeInTheDocument();
});
