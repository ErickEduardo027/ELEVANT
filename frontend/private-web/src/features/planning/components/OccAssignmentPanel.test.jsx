import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OccAssignmentPanel from './OccAssignmentPanel';
import { OPTIONS_STATE_SUCCESS, PLANNING_OPTIONS } from '../testing/planningFixtures';

const IDLE_ASSIGNMENT = {
  status: 'idle',
  data: null,
  error: null,
  reason: null,
  refreshRequired: false,
};

function renderPanel(overrides = {}) {
  const props = {
    optionsState: OPTIONS_STATE_SUCCESS,
    assignmentState: IDLE_ASSIGNMENT,
    assignable: true,
    onAssign: vi.fn(),
    onRetryOptions: vi.fn(),
    ...overrides,
  };
  return { ...render(<OccAssignmentPanel {...props} />), props };
}

describe('OccAssignmentPanel', () => {
  it('renders the server-controlled dispatch manifest', () => {
    renderPanel();

    expect(screen.getByText('Manifiesto de despacho')).toBeInTheDocument();
    expect(screen.getByText(/DEV-CONTRACT/)).toHaveTextContent('versión 1 · USD');
    expect(screen.getByText('BAGGAGE').parentElement).toHaveTextContent('Baggage handling');
    expect(screen.getByText(/Se incluirán automáticamente/)).toBeInTheDocument();
    expect(screen.getByText(/servidor valida el alcance/)).toBeInTheDocument();
  });

  it('allows selecting only an eligible agent and explains every known ineligibility', () => {
    renderPanel({
      optionsState: {
        ...OPTIONS_STATE_SUCCESS,
        data: {
          ...PLANNING_OPTIONS,
          agents: [
            PLANNING_OPTIONS.agents[0],
            {
              ...PLANNING_OPTIONS.agents[1],
              eligibilityReasons: [
                'shift_not_compatible',
                'operational_position_unavailable',
                'assignment_conflict',
              ],
            },
          ],
        },
      },
    });

    expect(screen.getByRole('radio', { name: /Riley Ramp/ })).toBeEnabled();
    expect(screen.getByRole('radio', { name: /Morgan Ramp/ })).toBeDisabled();
    expect(screen.getByText(/Turno no compatible/)).toHaveTextContent(
      'Sin posición operativa compatible'
    );
    expect(screen.getByText(/Turno no compatible/)).toHaveTextContent(
      'Conflicto con otra asignación activa'
    );
  });

  it('requires an explicit agent selection before sending one assignment', async () => {
    const { props } = renderPanel();
    const submit = screen.getByRole('button', { name: 'Asignar operación' });

    expect(submit).toBeDisabled();
    await userEvent.click(screen.getByRole('radio', { name: /Riley Ramp/ }));
    expect(submit).toBeEnabled();
    await userEvent.click(submit);

    expect(props.onAssign).toHaveBeenCalledTimes(1);
    expect(props.onAssign).toHaveBeenCalledWith('agent-1');
  });

  it.each([
    ['missing contract', { contract: null }, 'necesita un contrato aplicable'],
    ['missing services', { services: [] }, 'no contiene servicios operativos'],
    ['no eligible agents', { agents: PLANNING_OPTIONS.agents.map(agent => ({ ...agent, eligible: false })) }, 'No hay agentes elegibles'],
  ])('blocks assignment for %s', (_label, dataOverride, expectedMessage) => {
    const { props } = renderPanel({
      optionsState: {
        ...OPTIONS_STATE_SUCCESS,
        data: { ...PLANNING_OPTIONS, ...dataOverride },
      },
    });

    expect(screen.getByRole('status')).toHaveTextContent(expectedMessage);
    expect(screen.getByRole('button', { name: 'Asignar operación' })).toBeDisabled();
    expect(props.onAssign).not.toHaveBeenCalled();
  });

  it('blocks assignment when the operation is already assigned or the ETag is unavailable', () => {
    const { rerender } = render(
      <OccAssignmentPanel
        optionsState={OPTIONS_STATE_SUCCESS}
        assignmentState={IDLE_ASSIGNMENT}
        assignable={false}
        onAssign={() => {}}
        onRetryOptions={() => {}}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('ya tiene un agente activo');

    rerender(
      <OccAssignmentPanel
        optionsState={{ ...OPTIONS_STATE_SUCCESS, etag: null }}
        assignmentState={IDLE_ASSIGNMENT}
        onAssign={() => {}}
        onRetryOptions={() => {}}
      />
    );
    expect(screen.getByRole('status')).toHaveTextContent('versión operativa no está disponible');
  });

  it('locks the manifest while a command is in flight', () => {
    renderPanel({ assignmentState: { ...IDLE_ASSIGNMENT, status: 'submitting' } });

    expect(screen.getByRole('form')).toHaveAttribute('aria-busy', 'true');
    expect(screen.getByRole('radio', { name: /Riley Ramp/ })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Asignando operación…' })).toBeDisabled();
  });

  it('renders only the sanitized assignment failure', () => {
    renderPanel({
      assignmentState: {
        ...IDLE_ASSIGNMENT,
        status: 'error',
        reason: 'stale',
        refreshRequired: true,
        error: new Error('Las opciones de asignación cambiaron. Revise la versión actual.'),
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('Las opciones de asignación cambiaron');
  });

  it('renders option loading and recoverable failure states', async () => {
    const { props, rerender } = renderPanel({
      optionsState: {
        status: 'loading',
        data: null,
        etag: null,
        error: null,
        reason: null,
        recoverable: false,
      },
    });
    expect(screen.getByRole('status')).toHaveTextContent('Consultando contrato y elegibilidad');

    rerender(
      <OccAssignmentPanel
        optionsState={{
          status: 'error',
          data: null,
          etag: null,
          error: new Error('safe conflict'),
          reason: 'options-conflict',
          recoverable: true,
        }}
        assignmentState={IDLE_ASSIGNMENT}
        onAssign={props.onAssign}
        onRetryOptions={props.onRetryOptions}
      />
    );
    expect(screen.getByRole('alert')).toHaveTextContent('La operación cambió o no tiene una versión asignable');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onRetryOptions).toHaveBeenCalledTimes(1);
  });
});
