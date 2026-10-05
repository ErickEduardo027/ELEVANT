import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OccShiftPanel from './OccShiftPanel';
import { createPlanningFlight, OPTIONS_STATE_SUCCESS } from '../testing/planningFixtures';
import { programPlanningShift } from '../../../services/planningService';

vi.mock('../../../services/planningService', () => ({ programPlanningShift: vi.fn() }));

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
});

describe('OccShiftPanel', () => {
  it('copies an overnight choice, marks next day, and sends the local clocks unchanged', async () => {
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Agente para turno'), 'agent-1');
    await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'night-2300');
    expect(screen.getByLabelText('Inicio del turno local')).toHaveValue('23:00');
    expect(screen.getByLabelText('Fin del turno local')).toHaveValue('08:00');
    expect(screen.getByText(/fin al día siguiente/i)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Programar turno' }));
    await waitFor(() => expect(programPlanningShift).toHaveBeenCalledWith(flight.turnaroundId,
      { agentId: 'agent-1', startsAtLocal: '23:00:00', endsAtLocal: '08:00:00' },
      expect.objectContaining({ signal: expect.any(AbortSignal) })));
  });

  it('keeps manual edits instead of reverting to a previously chosen preset', async () => {
    render(<OccShiftPanel flight={flight} optionsState={shiftOnlyOptions} />);
    await userEvent.selectOptions(screen.getByLabelText('Horario precargado'), 'morning-0700');
    await userEvent.clear(screen.getByLabelText('Fin del turno local'));
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
});
