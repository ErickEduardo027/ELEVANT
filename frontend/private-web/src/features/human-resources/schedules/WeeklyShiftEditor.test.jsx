import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WeeklyShiftEditor from './WeeklyShiftEditor';
import {
  adjustHumanResourcesShift, getAllHumanResourcesShifts, getHumanResourcesShiftAssignmentOptions,
  listRampAgentReadiness, recordHumanResourcesShift, removeHumanResourcesShift,
} from '../../../services/humanResourcesShiftsReadService';

import { getApprovedAbsences } from '../../../services/humanResourcesAvailabilityService';

vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getAllHumanResourcesShifts: vi.fn(), getHumanResourcesShiftAssignmentOptions: vi.fn(), listRampAgentReadiness: vi.fn(),
  recordHumanResourcesShift: vi.fn(), removeHumanResourcesShift: vi.fn(), adjustHumanResourcesShift: vi.fn(),
}));
vi.mock('../../../services/humanResourcesAvailabilityService', () => ({ getApprovedAbsences: vi.fn() }));

const agent = { rampProfileId: 'p-1', agentName: 'Ana Ramp', employeeNumber: 'E-1', ready: true, items: [] };
const station = { id: 's-1', code: 'PUJ', terminals: [{ id: 't-1', code: 'T1' }] };
// A week fully in the future so every day is editable.
const weekStart = new Date(2099, 0, 5);
const existing = { id: 'sh-1', rampProfileId: 'p-1', agentName: 'Ana Ramp', employeeNumber: 'E-1', stationId: 's-1',
  stationCode: 'PUJ', terminalId: 't-1', terminalCode: 'T1', workDate: '2099-01-06', startsAtLocal: '07:00:00',
  endsAtLocal: '16:00:00', block: 'Morning', positionId: null, positionCode: null, version: 'AAAAAAAAB9E=' };

beforeEach(() => {
  listRampAgentReadiness.mockResolvedValue([agent, { ...agent, rampProfileId: 'p-2', agentName: 'Luis Ramp', ready: false }]);
  getAllHumanResourcesShifts.mockResolvedValue([existing]);
  getHumanResourcesShiftAssignmentOptions.mockResolvedValue({ rampProfileId: 'p-1', workDate: '2099-01-05', hasShift: false,
    stations: [station] });
  recordHumanResourcesShift.mockResolvedValue({ id: 'new' });
  removeHumanResourcesShift.mockResolvedValue(undefined);
  getApprovedAbsences.mockResolvedValue([]);
  vi.stubGlobal('crypto', { randomUUID: () => '00000000-0000-4000-8000-000000000001' });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); });

it('shows each agent with readiness, assigns a template and removes a future shift', async () => {
  const onChanged = vi.fn();
  render(<WeeklyShiftEditor weekStart={weekStart} onChanged={onChanged} />);
  const editor = await screen.findByRole('region', { name: 'Editor semanal de turnos' });
  expect(within(editor).getByText('Puede operar')).toBeInTheDocument();
  expect(within(editor).getByText('Le falta algo')).toBeInTheDocument();
  expect(within(editor).getByText('07:00–16:00')).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Asignar turno a Ana Ramp el 2099-01-05' }));
  const form = await screen.findByRole('form', { name: 'Asignar turno' });
  await userEvent.selectOptions(within(form).getByLabelText('Plantilla'), 'night-2300');
  await userEvent.click(within(form).getByRole('button', { name: 'Asignar turno' }));
  expect(recordHumanResourcesShift).toHaveBeenCalledWith('00000000-0000-4000-8000-000000000001', { rampProfileId: 'p-1',
    stationId: 's-1', terminalId: 't-1', workDate: '2099-01-05', startsAtLocal: '23:00:00', endsAtLocal: '08:00:00', notes: null });
  expect(await screen.findByText(/Turno 23:00–08:00 asignado a Ana Ramp/)).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Quitar turno de Ana Ramp el 2099-01-06' }));
  // The removal carries the shift's version and the intent's key (2-N11).
  expect(removeHumanResourcesShift).toHaveBeenCalledWith('sh-1', 'AAAAAAAAB9E=', '00000000-0000-4000-8000-000000000001');
  expect(onChanged).toHaveBeenCalledTimes(2);
});

it('copies last week onto the free days only', async () => {
  getAllHumanResourcesShifts.mockResolvedValueOnce([existing])
    .mockResolvedValueOnce([{ ...existing, id: 'old-1', workDate: '2098-12-30' }, { ...existing, id: 'old-2', workDate: '2098-12-29' }]);
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Copiar semana anterior' }));
  // 12-29 → 01-05 is free; 12-30 → 01-06 already has a shift.
  expect(recordHumanResourcesShift).toHaveBeenCalledTimes(1);
  expect(recordHumanResourcesShift.mock.calls[0][1]).toMatchObject({ workDate: '2099-01-05', startsAtLocal: '07:00:00', endsAtLocal: '16:00:00' });
  expect(await screen.findByText(/1 turnos creados, 1 omitidos/)).toBeInTheDocument();
});

it('explains a forbidden editor', async () => {
  listRampAgentReadiness.mockRejectedValueOnce({ status: 403 });
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  expect(await screen.findByRole('alert')).toHaveTextContent('No tienes acceso al editor de turnos.');
});

it('marks approved absences, never copies onto them and counts why each shift was skipped (2-N24)', async () => {
  getApprovedAbsences.mockResolvedValue([{ id: 'r-1', rampProfileId: 'p-2', type: 'DayOff', status: 'Approved',
    startsOn: '2099-01-05', endsOn: '2099-01-07' }]);
  getAllHumanResourcesShifts.mockResolvedValueOnce([existing]).mockResolvedValueOnce([
    { ...existing, id: 'old-1', rampProfileId: 'p-2', agentName: 'Luis Ramp', workDate: '2098-12-29' },
    { ...existing, id: 'old-2', workDate: '2098-12-31' },
    { ...existing, id: 'old-3', workDate: '2099-01-01' },
    // An agent who left the ramp gets no copy: skipped without asking the server.
    { ...existing, id: 'old-4', rampProfileId: 'p-9', agentName: 'Pérez Baja', workDate: '2099-01-02' },
  ]);
  recordHumanResourcesShift.mockResolvedValueOnce({ id: 'new' })
    .mockRejectedValueOnce({ status: 409, code: 'shift_on_approved_absence' });
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  const editor = await screen.findByRole('region', { name: 'Editor semanal de turnos' });
  expect(within(editor).getAllByText('Ausencia aprobada')).toHaveLength(3);
  // A day of the absence takes no new shift from the grid.
  expect(screen.queryByRole('button', { name: 'Asignar turno a Luis Ramp el 2099-01-05' })).toBeNull();
  expect(screen.getByRole('button', { name: 'Asignar turno a Luis Ramp el 2099-01-08' })).toBeInTheDocument();

  await userEvent.click(screen.getByRole('button', { name: 'Copiar semana anterior' }));
  // Luis is off on 01-05: skipped before asking; the server refuses another absence it knows about.
  expect(recordHumanResourcesShift).toHaveBeenCalledTimes(2);
  expect(recordHumanResourcesShift.mock.calls.map(call => call[1].workDate)).toEqual(['2099-01-07', '2099-01-08']);
  expect(await screen.findByText('Semana copiada: 1 turnos creados, 3 omitidos (2 por ausencia aprobada, 1 sin acceso, sin alcance o agente inactivo).'))
    .toBeInTheDocument();
});

it('explains a shift still worked, reads the week again and lets former agents lose their shifts', async () => {
  const former = { ...existing, id: 'sh-9', rampProfileId: 'p-9', agentName: 'Pérez Baja', workDate: '2099-01-08',
    version: 'AAAAAAAAB9Z=' };
  getAllHumanResourcesShifts.mockResolvedValue([existing, former]);
  removeHumanResourcesShift.mockRejectedValueOnce({ status: 409, code: 'shift_in_use' });
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Quitar turno de Ana Ramp el 2099-01-06' }));
  expect(await screen.findByText(/ya cubre posiciones o tiene operaciones asignadas/)).toBeInTheDocument();
  await vi.waitFor(() => expect(getAllHumanResourcesShifts).toHaveBeenCalledTimes(2));

  // A shift of an agent who left the ramp before the release path stays removable.
  const editor = await screen.findByRole('region', { name: 'Editor semanal de turnos' });
  expect(within(editor).getByText('Ya no trabaja en rampa')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Asignar turno a Pérez Baja el 2099-01-09' })).toBeNull();
  await userEvent.click(screen.getByRole('button', { name: 'Quitar turno de Pérez Baja el 2099-01-08' }));
  expect(removeHumanResourcesShift).toHaveBeenLastCalledWith('sh-9', 'AAAAAAAAB9Z=', '00000000-0000-4000-8000-000000000001');
});

it('keeps working when the absences cannot be read and offers a retry when the week fails', async () => {
  getApprovedAbsences.mockRejectedValueOnce({ status: 403 });
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  expect(await screen.findByText(/No pudimos leer las ausencias aprobadas/)).toBeInTheDocument();
  cleanup();
  listRampAgentReadiness.mockRejectedValueOnce(new Error('network'));
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByRole('region', { name: 'Editor semanal de turnos' })).toBeInTheDocument();
});

it('adjusts the hours of a future shift with a reason, its version and the intent key (3-E)', async () => {
  const onChanged = vi.fn();
  adjustHumanResourcesShift
    .mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { status: 409, code: 'shift_uncovers_work' }))
    .mockResolvedValueOnce({ id: 'sh-1', startsAtLocal: '06:00:00', endsAtLocal: '17:30:00', version: 'AAAAAAAAB9I=' });
  render(<WeeklyShiftEditor weekStart={weekStart} onChanged={onChanged} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ajustar horario de Ana Ramp el 2099-01-06' }));
  const form = await screen.findByRole('form', { name: 'Ajustar horario' });
  expect(within(form).getByText(/Turno actual 07:00–16:00/)).toBeInTheDocument();
  expect(within(form).getByLabelText('Inicio')).toHaveValue('07:00');
  const save = within(form).getByRole('button', { name: 'Guardar horario' });
  expect(save).toBeDisabled();
  await userEvent.clear(within(form).getByLabelText('Inicio'));
  await userEvent.type(within(form).getByLabelText('Inicio'), '06:00');
  await userEvent.clear(within(form).getByLabelText('Fin'));
  await userEvent.type(within(form).getByLabelText('Fin'), '17:30');
  await userEvent.type(within(form).getByLabelText('Motivo del ajuste'), '  Refuerzo por vuelos retrasados  ');
  await userEvent.click(save);

  // A broken rule keeps the form with the reason in Spanish.
  expect(await within(form).findByRole('alert')).toHaveTextContent(
    'El nuevo horario deja sin cubrir posiciones u operaciones que el agente ya tiene en ese turno.');
  await userEvent.click(save);
  expect(await screen.findByText('Horario del 2099-01-06 de Ana Ramp ajustado a 06:00–17:30.')).toBeInTheDocument();
  const command = { startsAtLocal: '06:00:00', endsAtLocal: '17:30:00', reason: 'Refuerzo por vuelos retrasados',
    expectedVersion: 'AAAAAAAAB9E=' };
  expect(adjustHumanResourcesShift).toHaveBeenNthCalledWith(1, 'sh-1', command, '00000000-0000-4000-8000-000000000001');
  expect(adjustHumanResourcesShift).toHaveBeenNthCalledWith(2, 'sh-1', command, '00000000-0000-4000-8000-000000000001');
  expect(onChanged).toHaveBeenCalledTimes(1);
  expect(screen.queryByRole('form', { name: 'Ajustar horario' })).not.toBeInTheDocument();
});

it('reads the week again when the shift changed meanwhile (3-E)', async () => {
  adjustHumanResourcesShift.mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { status: 409,
    code: 'version_conflict' }));
  render(<WeeklyShiftEditor weekStart={weekStart} />);
  await userEvent.click(await screen.findByRole('button', { name: 'Ajustar horario de Ana Ramp el 2099-01-06' }));
  const form = await screen.findByRole('form', { name: 'Ajustar horario' });
  await userEvent.type(within(form).getByLabelText('Motivo del ajuste'), 'Refuerzo por vuelos retrasados');
  await userEvent.clear(within(form).getByLabelText('Fin'));
  await userEvent.type(within(form).getByLabelText('Fin'), '18:00');
  await userEvent.click(within(form).getByRole('button', { name: 'Guardar horario' }));
  expect(await screen.findByText('El turno cambió mientras lo editabas. Actualizamos la semana; revisa e intenta de nuevo.'))
    .toBeInTheDocument();
  await vi.waitFor(() => expect(getAllHumanResourcesShifts).toHaveBeenCalledTimes(2));
});

