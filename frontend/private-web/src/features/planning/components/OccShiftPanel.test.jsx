import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OccShiftPanel from './OccShiftPanel';
import { createPlanningFlight, OPTIONS_STATE_SUCCESS } from '../testing/planningFixtures';
import { getOccAgentShift, programPlanningShift } from '../../../services/planningService';
import { adjustHumanResourcesShift } from '../../../services/humanResourcesShiftsReadService';

vi.mock('../../../services/planningService', () => ({ programPlanningShift: vi.fn(), getOccAgentShift: vi.fn() }));
vi.mock('../../../services/humanResourcesShiftsReadService', () => ({ adjustHumanResourcesShift: vi.fn() }));

const noShift = () => Object.assign(new Error('HTTP 404'), { status: 404, code: 'shift_not_found' });
const SHIFT = { shiftId: 'shift-1', agentId: 'agent-1', workDate: '2026-08-19', startsAtLocal: '08:00:00',
  endsAtLocal: '12:00:00', terminalCode: 'A', version: 'AAAAAAAAB9E=' };

const flight = createPlanningFlight({
  assignedAgents: [], agents: [], hasAssignmentGap: true,
  operationCode: 'MAN-TEST',
});

const shiftOnlyOptions = { ...OPTIONS_STATE_SUCCESS, data: {
  ...OPTIONS_STATE_SUCCESS.data,
  agents: [{ id: 'agent-1', displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001',
    eligible: false, eligibilityReasons: ['shift_not_compatible'] }],
} };

beforeEach(() => {
  vi.mocked(programPlanningShift).mockReset();
  vi.mocked(programPlanningShift).mockResolvedValue({ shiftId: 'shift-1', replayed: false });
  // Without a shift that day the panel programs one, as before 3-E.
  vi.mocked(getOccAgentShift).mockReset();
  vi.mocked(getOccAgentShift).mockRejectedValue(noShift());
  vi.mocked(adjustHumanResourcesShift).mockReset();
});

describe('OccShiftPanel', () => {
  it('copies an overnight choice, marks next day, and sends the local clocks unchanged', async () => {
    const overnightFlight = createPlanningFlight({
      assignedAgents: [], agents: [], hasAssignmentGap: true,
      operationCode: 'MAN-NIGHT',
      operation: { ...flight.operation, plannedStartAt: '2026-08-19T23:15:00-04:00',
        plannedEndAt: '2026-08-20T07:30:00-04:00' },
    });
    render(<OccShiftPanel flight={overnightFlight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'night-2300');
    expect(screen.getByLabelText('Inicio del turno local')).toHaveValue('23:00');
    expect(screen.getByLabelText('Fin del turno local')).toHaveValue('08:00');
    expect(screen.getByText(/fin al día siguiente/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));
    await waitFor(() => expect(programPlanningShift).toHaveBeenCalledWith(overnightFlight.turnaroundId,
      { agentId: 'agent-1', startsAtLocal: '23:00:00', endsAtLocal: '08:00:00' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it('keeps manual edits instead of reverting to a previously chosen preset', async () => {
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'morning-0700');
    await userEvent.clear(screen.getByLabelText('Fin del turno local'));
    expect(screen.queryByText(/fin al día siguiente/i)).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Fin del turno local'), '16:30');
    expect(screen.getByLabelText('Horario precargado')).toHaveValue('');
    expect(screen.getByLabelText('Fin del turno local')).toHaveValue('16:30');
  });

  it('drops the old preset when a different flight replaces the drawer content', async () => {
    const { rerender } = render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'evening-1500');
    const nextFlight = createPlanningFlight({
      turnaroundId: '91000000-0000-0000-0000-000000000099',
      assignedAgents: [], agents: [], hasAssignmentGap: true,
      operation: { ...flight.operation, plannedStartAt: '2026-08-19T18:00:00-04:00',
        plannedEndAt: '2026-08-19T19:00:00-04:00' },
    });
    rerender(<OccShiftPanel flight={nextFlight} optionsState={shiftOnlyOptions} />);
    expect(screen.getByLabelText('Horario precargado')).toHaveValue('');
    expect(screen.getByLabelText('Inicio del turno local')).toHaveValue('18:00');
    expect(screen.getByLabelText('Fin del turno local')).toHaveValue('19:00');
  });

  it('offers only otherwise-qualified agents missing a shift and refreshes options after success', async () => {
    const onProgrammed = vi.fn();
    const optionsState = { ...OPTIONS_STATE_SUCCESS, data: {
      ...OPTIONS_STATE_SUCCESS.data,
      agents: [
        { id: 'agent-1', displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001', eligible: false,
          eligibilityReasons: ['shift_not_compatible'] },
        { id: 'agent-2', displayName: 'No Permit', employeeNumber: 'DEV-RA-002', eligible: false,
          eligibilityReasons: ['shift_not_compatible', 'airport_id_not_current'] },
      ],
    } };
    render(<OccShiftPanel flight={flight} optionsState={optionsState} onProgrammed={onProgrammed} />);

    expect(screen.getByRole('option', { name: /Riley Ramp/ })).toBeInTheDocument();
    expect(screen.queryByRole('option', { name: /No Permit/ })).not.toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await userEvent.clear(screen.getByLabelText('Inicio del turno local'));
    await userEvent.type(screen.getByLabelText('Inicio del turno local'), '08:00');
    await userEvent.clear(screen.getByLabelText('Fin del turno local'));
    await userEvent.type(screen.getByLabelText('Fin del turno local'), '16:00');
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));

    await waitFor(() => expect(programPlanningShift).toHaveBeenCalledWith(flight.turnaroundId,
      { agentId: 'agent-1', startsAtLocal: '08:00:00', endsAtLocal: '16:00:00' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
    expect(onProgrammed).toHaveBeenCalledTimes(1);
  });

  it('does not offer scheduling when no candidate is otherwise qualified', () => {
    const optionsState = { ...OPTIONS_STATE_SUCCESS, data: {
      ...OPTIONS_STATE_SUCCESS.data,
      agents: [{ id: 'agent-2', displayName: 'No Permit', eligible: false,
        eligibilityReasons: ['shift_not_compatible', 'airport_id_not_current'] }],
    } };
    const { container } = render(<OccShiftPanel flight={flight} optionsState={optionsState} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps a recoverable conflict visible without refreshing a stale ETag', async () => {
    vi.mocked(programPlanningShift).mockRejectedValue({ status: 409, message: 'conflict' });
    const optionsState = { ...OPTIONS_STATE_SUCCESS, data: {
      ...OPTIONS_STATE_SUCCESS.data,
      agents: [{ id: 'agent-1', displayName: 'Riley Ramp', eligible: false,
        eligibilityReasons: ['shift_not_compatible'] }],
    } };
    const onProgrammed = vi.fn();
    render(<OccShiftPanel flight={flight} optionsState={optionsState} onProgrammed={onProgrammed} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));
    await waitFor(() => expect(screen.getByRole('alert')).toHaveTextContent(/cambiaron/i));
    expect(onProgrammed).not.toHaveBeenCalled();
  });

  it('re-reads the options when the flight or the agent changed meanwhile', async () => {
    vi.mocked(programPlanningShift).mockRejectedValue({ status: 409, message: 'conflict' });
    const onStale = vi.fn();
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} onStale={onStale} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));
    await waitFor(() => expect(onStale).toHaveBeenCalledTimes(1));
  });
});

describe('OccShiftPanel adjusts the shift the agent already has that day (3-E)', () => {
  it('proposes the shift widened to cover the flight and sends it with the reason, the version and a key', async () => {
    vi.mocked(getOccAgentShift).mockResolvedValue(SHIFT);
    vi.mocked(adjustHumanResourcesShift).mockResolvedValue({ id: 'shift-1', startsAtLocal: '08:00:00',
      endsAtLocal: '14:30:00', version: 'AAAAAAAAB9I=' });
    const onProgrammed = vi.fn();
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} onProgrammed={onProgrammed} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');

    const form = await screen.findByRole('form', { name: 'Ajustar turno del día' });
    expect(getOccAgentShift).toHaveBeenCalledWith(flight.turnaroundId, 'agent-1',
      expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(within(form).getByText('Turno actual: 08:00–12:00 · Terminal A')).toBeInTheDocument();
    // The flight runs 12:15–14:30 local: the proposal keeps the morning and covers the flight.
    expect(within(form).getByLabelText('Inicio del turno local')).toHaveValue('08:00');
    expect(within(form).getByLabelText('Fin del turno local')).toHaveValue('14:30');
    expect(within(form).queryByLabelText('Horario precargado')).not.toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Ajustar turno' });
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Motivo del ajuste'), '  Cubre el vuelo de la tarde  ');
    await userEvent.click(submit);

    await waitFor(() => expect(onProgrammed).toHaveBeenCalledWith('adjusted'));
    expect(adjustHumanResourcesShift).toHaveBeenCalledWith('shift-1', { startsAtLocal: '08:00:00',
      endsAtLocal: '14:30:00', reason: 'Cubre el vuelo de la tarde', expectedVersion: 'AAAAAAAAB9E=' },
      expect.any(String));
    expect(programPlanningShift).not.toHaveBeenCalled();
  });

  it('turns «Programar turno» into the adjustment when the agent already has a shift that day', async () => {
    vi.mocked(getOccAgentShift).mockRejectedValueOnce(noShift()).mockResolvedValueOnce(SHIFT);
    vi.mocked(programPlanningShift).mockRejectedValueOnce({ status: 409, problemCode: 'shift_day_taken' });
    const onStale = vi.fn();
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} onStale={onStale} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await waitFor(() => expect(getOccAgentShift).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));

    expect(await screen.findByRole('form', { name: 'Ajustar turno del día' })).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('El agente ya tiene turno ese día: ajústelo para cubrir el vuelo.');
    expect(getOccAgentShift).toHaveBeenCalledTimes(2);
    expect(onStale).not.toHaveBeenCalled();
  });

  it('reads the shift again on a version conflict and keeps the form on a broken rule', async () => {
    vi.mocked(getOccAgentShift).mockResolvedValue(SHIFT);
    vi.mocked(adjustHumanResourcesShift)
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { status: 409, code: 'shift_uncovers_work' }))
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { status: 409, code: 'version_conflict' }));
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    const form = await screen.findByRole('form', { name: 'Ajustar turno del día' });
    await userEvent.type(within(form).getByLabelText('Motivo del ajuste'), 'Cubre el vuelo de la tarde');
    await userEvent.click(within(form).getByRole('button', { name: 'Ajustar turno' }));
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'El nuevo horario deja sin cubrir posiciones u operaciones ya asignadas al agente.');
    expect(getOccAgentShift).toHaveBeenCalledTimes(1);

    await userEvent.click(within(form).getByRole('button', { name: 'Ajustar turno' }));
    expect(await screen.findByText('El turno cambió mientras lo revisaba. Se actualizó; revise e intente de nuevo.'))
      .toBeInTheDocument();
    await waitFor(() => expect(getOccAgentShift).toHaveBeenCalledTimes(2));
    // The reason OCC typed survives the new read.
    expect(within(screen.getByRole('form', { name: 'Ajustar turno del día' })).getByLabelText('Motivo del ajuste'))
      .toHaveValue('Cubre el vuelo de la tarde');
  });

  it('shows the read in flight, a recoverable error, the missing access and another terminal', async () => {
    let resolve;
    vi.mocked(getOccAgentShift).mockReturnValueOnce(new Promise(done => { resolve = done; }));
    const view = render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    expect(screen.getByRole('status')).toHaveTextContent('Consultando el turno del agente…');
    resolve({ ...SHIFT, terminalCode: 'B' });
    // The shift is in another terminal: adjusting its hours would not make the agent available for this flight.
    expect(await screen.findByText(/Terminal B y el vuelo es de la Terminal A/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Motivo del ajuste'), 'Cubre el vuelo de la tarde');
    expect(screen.getByRole('button', { name: 'Ajustar turno' })).toBeDisabled();
    view.unmount();

    vi.mocked(getOccAgentShift).mockRejectedValueOnce(Object.assign(new Error('HTTP 503'), { status: 503 }))
      .mockResolvedValueOnce(SHIFT);
    const failing = render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('No fue posible consultar el turno del agente.');
    expect(screen.queryByRole('button', { name: 'Programar turno' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('form', { name: 'Ajustar turno del día' })).toBeInTheDocument();
    failing.unmount();

    vi.mocked(getOccAgentShift).mockRejectedValueOnce(Object.assign(new Error('HTTP 403'), { status: 403 }));
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    expect(await screen.findByRole('alert')).toHaveTextContent('Ya no tiene permiso para programar turnos.');
    expect(screen.queryByRole('button', { name: /turno/ })).not.toBeInTheDocument();
  });
});
