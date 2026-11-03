import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import WeeklyShiftEditor from './WeeklyShiftEditor';
import {
  getAllHumanResourcesShifts, getHumanResourcesShiftAssignmentOptions, listRampAgentReadiness,
  recordHumanResourcesShift, removeHumanResourcesShift,
} from '../../../services/humanResourcesShiftsReadService';

vi.mock('../../../services/humanResourcesShiftsReadService', () => ({
  getAllHumanResourcesShifts: vi.fn(), getHumanResourcesShiftAssignmentOptions: vi.fn(), listRampAgentReadiness: vi.fn(),
  recordHumanResourcesShift: vi.fn(), removeHumanResourcesShift: vi.fn(),
}));

const agent = { rampProfileId: 'p-1', agentName: 'Ana Ramp', employeeNumber: 'E-1', ready: true, items: [] };
const station = { id: 's-1', code: 'PUJ', terminals: [{ id: 't-1', code: 'T1' }] };
// A week fully in the future so every day is editable.
const weekStart = new Date(2099, 0, 5);
const existing = { id: 'sh-1', rampProfileId: 'p-1', agentName: 'Ana Ramp', employeeNumber: 'E-1', stationId: 's-1',
  stationCode: 'PUJ', terminalId: 't-1', terminalCode: 'T1', workDate: '2099-01-06', startsAtLocal: '07:00:00',
  endsAtLocal: '16:00:00', block: 'Morning', positionId: null, positionCode: null };

beforeEach(() => {
  listRampAgentReadiness.mockResolvedValue([agent, { ...agent, rampProfileId: 'p-2', agentName: 'Luis Ramp', ready: false }]);
  getAllHumanResourcesShifts.mockResolvedValue([existing]);
  getHumanResourcesShiftAssignmentOptions.mockResolvedValue({ rampProfileId: 'p-1', workDate: '2099-01-05', hasShift: false,
    stations: [station] });
  recordHumanResourcesShift.mockResolvedValue({ id: 'new' });
  removeHumanResourcesShift.mockResolvedValue(undefined);
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
  expect(removeHumanResourcesShift).toHaveBeenCalledWith('sh-1');
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
