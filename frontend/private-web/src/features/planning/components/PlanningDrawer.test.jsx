import { useState } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningDrawer from './PlanningDrawer';
import {
  createPlanningFlight,
  OPTIONS_STATE_SUCCESS,
  STATION_ID,
} from '../testing/planningFixtures';

const attendance = vi.hoisted(() => ({ read: vi.fn(), save: vi.fn() }));
vi.mock('../../../services/attendanceDraftService', () => ({
  readAttendanceDraft: attendance.read,
  saveOccAttendanceDraft: attendance.save,
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: async () => {}, stop: async () => {} }),
}));
// 3-G: the live incidents panel has its own tests; here it shows which operation it reads and its re-read token.
vi.mock('../../incidents/OperationIncidentsPanel', () => ({
  default: ({ operationId, refreshToken }) => (
    <div data-testid="incidents-panel" data-operation={operationId} data-refresh={String(refreshToken)} />
  ),
}));
const agents = vi.hoisted(() => ({ release: vi.fn(), options: vi.fn(), handOver: vi.fn() }));
vi.mock('../../../services/occCoverageService', () => ({
  releaseOccOperationAgent: agents.release,
  loadOccHandoverOptions: agents.options,
  handOverOccOperation: agents.handOver,
}));

const ASSIGNED_FLIGHT = createPlanningFlight();
const FLIGHT = createPlanningFlight({
  assignedAgents: [],
  agents: [],
  resourceState: {
    ...ASSIGNED_FLIGHT.resourceState,
    agentsAssigned: false,
  },
  hasAssignmentGap: true,
});

beforeEach(() => {
  attendance.read.mockReset();
  attendance.read.mockImplementation(() => new Promise(() => {}));
  for (const mock of Object.values(agents)) mock.mockReset();
});

const STARTED = createPlanningFlight({ operationStatus: 'InProgress' });
const HANDOVER_OPTIONS = {
  turnaroundId: STARTED.turnaroundId, operationId: 'operation-1', operationStatus: 'InProgress',
  currentAssignmentId: 'assignment-agent-1', currentAgentId: 'agent-1', currentAgentName: 'Riley Ramp',
  remainingFrom: '2026-08-19T14:10:00Z', remainingUntil: '2026-08-19T15:00:00Z',
  agents: [
    { id: 'agent-2', displayName: 'Ximena Ramp', employeeNumber: 'QA-RA-302', eligible: true, eligibilityReasons: [] },
    { id: 'agent-3', displayName: 'Mateo Ramp', employeeNumber: 'DEV-RA-002', eligible: false,
      eligibilityReasons: ['mentor_required', 'assignment_conflict'] },
  ],
};
const conflict = code => Object.assign(new Error(`HTTP 409 ${code}`), { status: 409, code });

function renderDrawer(overrides = {}) {
  const props = {
    flight: FLIGHT,
    onClose: vi.fn(),
    optionsState: OPTIONS_STATE_SUCCESS,
    onRetryOptions: vi.fn(),
    ...overrides,
  };
  const result = render(<PlanningDrawer {...props} />);
  return { ...result, props };
}

function optionsSection() {
  return screen.getByRole('heading', { name: 'Asignación OCC' }).closest('section');
}

function DrawerHarness() {
  const [flight, setFlight] = useState(null);

  return (
    <>
      <button type="button" onClick={() => setFlight(FLIGHT)}>Abrir detalle operativo</button>
      <PlanningDrawer
        flight={flight}
        onClose={() => setFlight(null)}
        optionsState={OPTIONS_STATE_SUCCESS}
        onRetryOptions={() => {}}
      />
    </>
  );
}

describe('PlanningDrawer', () => {
  it('scopes attendance to the selected assignment and hides it without an operation', async () => {
    attendance.read.mockImplementation(async (operationId, assignmentId) => ({
      operationId, assignmentId, stationId: STATION_ID, occ: null, rampAgent: null,
    }));
    const second = { ...ASSIGNED_FLIGHT.assignedAgents[0], assignmentId: 'assignment-agent-2',
      displayName: 'Morgan Ramp', employeeNumber: 'DEV-RA-002' };
    const flight = createPlanningFlight({
      assignedAgents: [...ASSIGNED_FLIGHT.assignedAgents, second],
    });
    const view = renderDrawer({ flight });
    expect(await screen.findByRole('heading', { name: 'Asistencia de Riley Ramp' })).toBeInTheDocument();
    expect(attendance.read).toHaveBeenCalledWith(flight.operation.id,
      ASSIGNED_FLIGHT.assignedAgents[0].assignmentId, expect.anything());
    await userEvent.selectOptions(screen.getByRole('combobox', { name: 'Agente para asistencia' }),
      second.assignmentId);
    expect(await screen.findByRole('heading', { name: 'Asistencia de Morgan Ramp' })).toBeInTheDocument();
    await waitFor(() => expect(attendance.read).toHaveBeenCalledWith(flight.operation.id,
      second.assignmentId, expect.anything()));

    view.rerender(<PlanningDrawer flight={{ ...flight, operation: null }}
      onClose={() => {}} optionsState={OPTIONS_STATE_SUCCESS} onRetryOptions={() => {}} />);
    expect(screen.queryByRole('heading', { name: /Asistencia de/ })).not.toBeInTheDocument();
  });

  it("mounts the operation's live incidents, re-read with the board (3-G)", () => {
    const { rerender, props } = renderDrawer({ flight: ASSIGNED_FLIGHT, dataRevision: 4 });
    expect(screen.getByTestId('incidents-panel')).toHaveAttribute('data-operation', 'operation-1');
    expect(screen.getByTestId('incidents-panel')).toHaveAttribute('data-refresh', '4');
    rerender(<PlanningDrawer {...props} flight={{ ...ASSIGNED_FLIGHT, operation: null }} />);
    expect(screen.queryByTestId('incidents-panel')).not.toBeInTheDocument();
  });

  it('renders nothing when no turnaround is selected', () => {
    const { container } = render(<PlanningDrawer flight={null} onClose={() => {}} />);

    expect(container).toBeEmptyDOMElement();
  });

  it('renders canonical context, both legs, and assigned resources', () => {
    renderDrawer({ flight: ASSIGNED_FLIGHT });

    expect(screen.getByText('DEV-TAT-0002')).toBeInTheDocument();
    expect(screen.getByText('19/08/2026')).toBeInTheDocument();
    expect(screen.getByText('PUJ · Punta Cana')).toBeInTheDocument();
    expect(screen.getByText('ZZ · Demo Airlines')).toBeInTheDocument();
    expect(screen.getByText('ZZ102')).toBeInTheDocument();
    expect(screen.getByText('SDQ → PUJ')).toBeInTheDocument();
    expect(screen.getByText('ZZ103')).toBeInTheDocument();
    expect(screen.getByText('PUJ → JFK')).toBeInTheDocument();
    expect(screen.getByText(/Airbus A320-200 · HI-DEV2/)).toBeInTheDocument();
    expect(screen.getAllByText(/Riley Ramp/).length).toBeGreaterThan(0);
    expect(screen.getByText(/GPU-DEV-01 · Ground power unit/)).toBeInTheDocument();
    expect(screen.getAllByText(/BAGGAGE · Baggage handling/).length).toBeGreaterThan(0);
  });

  it('shows the operation, equipment and unit codes in Spanish (3-N22)', () => {
    renderDrawer({ flight: createPlanningFlight({ operationStatus: 'PendingReview' }) });

    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
    expect(screen.getByText('(Disponible)')).toBeInTheDocument();
    expect(screen.getByText('0/1 por operación')).toBeInTheDocument();
    expect(screen.queryByText(/PendingReview|Available/)).not.toBeInTheDocument();
  });

  it('renders contract, service, and agent eligibility returned by the options endpoint', () => {
    renderDrawer();
    const section = within(optionsSection());

    expect(section.getByText('DEV-CONTRACT').closest('p')).toHaveTextContent('DEV-CONTRACT · versión 1 · USD');
    expect(section.getByText('BAGGAGE').parentElement).toHaveTextContent('BAGGAGE · Baggage handling');
    expect(section.getByText('Elegible')).toBeInTheDocument();
    expect(section.getByText('No elegible')).toBeInTheDocument();
    expect(section.getByText('Turno no compatible')).toBeInTheDocument();
  });

  it('shows a loading state while authorized options are requested', () => {
    renderDrawer({
      optionsState: { status: 'loading', data: null, error: null, reason: null, recoverable: false },
    });

    expect(within(optionsSection()).getByRole('status')).toHaveTextContent('Consultando contrato y elegibilidad');
  });

  it('shows truthful empty option values', () => {
    renderDrawer({
      optionsState: {
        status: 'empty',
        data: { contract: null, services: [], agents: [] },
        error: null,
        reason: null,
        recoverable: false,
      },
    });
    const section = within(optionsSection());

    expect(section.getByText('Sin contrato aplicable para esta escala.')).toBeInTheDocument();
    expect(section.getByText('Sin servicios contratados disponibles.')).toBeInTheDocument();
    expect(section.getByText('Sin agentes candidatos para este contexto.')).toBeInTheDocument();
  });

  it('explains a 409 contract ambiguity and retries when requested', async () => {
    const { props } = renderDrawer({
      optionsState: {
        status: 'error',
        data: null,
        error: new Error('safe view error'),
        reason: 'options-conflict',
        recoverable: true,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('La operación cambió o no tiene una versión asignable');
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onRetryOptions).toHaveBeenCalledTimes(1);
  });

  it('shows a recoverable generic options failure without internal error details', async () => {
    const { props } = renderDrawer({
      optionsState: {
        status: 'error',
        data: null,
        error: new Error('sensitive upstream detail'),
        reason: 'request-failed',
        recoverable: true,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('No fue posible consultar las opciones de esta escala.');
    expect(screen.queryByText('sensitive upstream detail')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(props.onRetryOptions).toHaveBeenCalledTimes(1);
  });

  it('shows an unauthorized options state without offering a retry', () => {
    renderDrawer({
      optionsState: {
        status: 'unauthorized',
        data: null,
        error: new Error('expired'),
        reason: 'unauthorized',
        recoverable: false,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('La sesión expiró');
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('shows a forbidden options state without offering a retry', () => {
    renderDrawer({
      optionsState: {
        status: 'forbidden',
        data: null,
        error: new Error('private policy detail'),
        reason: 'forbidden',
        recoverable: false,
      },
    });

    expect(screen.getByRole('alert')).toHaveTextContent('no tiene permiso');
    expect(screen.queryByText('private policy detail')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('blocks reassignment and shows no placeholder actions (3-N28)', () => {
    renderDrawer({ flight: ASSIGNED_FLIGHT });

    expect(screen.getByRole('button', { name: 'Asignar operación' })).toBeDisabled();
    expect(within(optionsSection()).getByRole('status')).toHaveTextContent('ya tiene un agente activo');

    for (const label of ['Editar planificación', 'Crear Work Order']) {
      expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
    }
    expect(screen.queryByTitle('Próximamente')).not.toBeInTheDocument();
  });

  it('offers editing, cancelling and diverting the flight before its operation starts (3-A)', async () => {
    const onChangeFlight = vi.fn();
    const { unmount } = renderDrawer({ flight: ASSIGNED_FLIGHT, onChangeFlight });

    expect(screen.getByRole('heading', { name: 'Cambios del vuelo' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Editar vuelo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Cancelar vuelo' }));
    await userEvent.click(screen.getByRole('button', { name: 'Marcar desviado' }));
    expect(onChangeFlight.mock.calls).toEqual([['reschedule'], ['cancel'], ['divert']]);
    unmount();

    // An operation already started, or a closed flight, is closed through the review: nothing to change here.
    for (const flight of [
      createPlanningFlight({ operationStatus: 'InProgress' }),
      createPlanningFlight({ status: 'Cancelled' }),
    ]) {
      const view = renderDrawer({ flight, onChangeFlight });
      expect(screen.queryByRole('button', { name: 'Editar vuelo' })).not.toBeInTheDocument();
      view.unmount();
    }
  });

  it('asks before releasing the agent and tells that another one can be assigned after the arrival (3-C)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false);
    renderDrawer({ flight: createPlanningFlight({ operationStatus: 'Assigned' }), onAgentReleased: vi.fn() });

    await userEvent.click(screen.getByRole('button', { name: 'Liberar agente' }));

    expect(confirm).toHaveBeenCalledWith(expect.stringContaining('también con la llegada ya registrada'));
    expect(agents.release).not.toHaveBeenCalled();
    confirm.mockRestore();
  });

  it('releases the agent OCC sees with the intent key, and re-reads when another agent took it (3-J)', async () => {
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(true);
    const onAgentReleased = vi.fn();
    const onStale = vi.fn();
    agents.release.mockRejectedValueOnce(Object.assign(new Error('network'), { status: undefined }))
      .mockRejectedValueOnce(conflict('assignment_changed'))
      .mockResolvedValueOnce(undefined);
    renderDrawer({ flight: createPlanningFlight({ operationStatus: 'Assigned' }), onAgentReleased, onStale });

    await userEvent.click(screen.getByRole('button', { name: 'Liberar agente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo confirmar la liberación');
    // The same intent after an answer that never came keeps its key, so the server replays it.
    await userEvent.click(screen.getByRole('button', { name: 'Liberar agente' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Otro usuario cambió el agente de la operación');
    const [first, second] = agents.release.mock.calls;
    expect(first).toEqual([STARTED.turnaroundId, { expectedAssignmentId: 'assignment-agent-1',
      idempotencyKey: expect.any(String) }]);
    expect(second[1].idempotencyKey).toBe(first[1].idempotencyKey);
    expect(onStale).toHaveBeenCalledTimes(1);

    await userEvent.click(screen.getByRole('button', { name: 'Liberar agente' }));
    await waitFor(() => expect(onAgentReleased).toHaveBeenCalledTimes(1));
    expect(agents.release.mock.calls[2][1].idempotencyKey).not.toBe(first[1].idempotencyKey);
    confirm.mockRestore();
  });

  it('hands a started operation to an eligible agent with a reason and the assignment on screen (3-F)', async () => {
    agents.options.mockResolvedValue(HANDOVER_OPTIONS);
    agents.handOver.mockResolvedValue({ turnaroundId: STARTED.turnaroundId, assignmentId: 'assignment-agent-2',
      agentId: 'agent-2', previousAgentId: 'agent-1', replayed: false });
    const onAgentHandedOver = vi.fn();
    renderDrawer({ flight: STARTED, onAgentReleased: vi.fn(), onAgentHandedOver });

    const form = await screen.findByRole('form', { name: 'Relevar agente' });
    expect(within(form).getByText(/Agente actual: Riley Ramp/)).toHaveTextContent('Queda de 10:10 a 11:00 (hora local).');
    // The release before the start is not offered once the agent started.
    expect(screen.queryByRole('button', { name: 'Liberar agente' })).not.toBeInTheDocument();
    expect(within(form).getByText(/No elegibles/)).toHaveTextContent(
      'Mateo Ramp (Menos de 3 meses: necesita un mentor en su cobertura, Ya tiene 3 operaciones simultáneas)');
    expect(within(form).queryByRole('option', { name: /Mateo Ramp/ })).not.toBeInTheDocument();
    const submit = within(form).getByRole('button', { name: 'Relevar agente' });
    await userEvent.selectOptions(within(form).getByLabelText('Agente que recibe la operación'), 'agent-2');
    expect(submit).toBeDisabled();
    await userEvent.type(within(form).getByLabelText('Motivo del relevo'), '  Riley terminó su turno.  ');
    await userEvent.click(submit);

    await waitFor(() => expect(onAgentHandedOver).toHaveBeenCalledWith('Ximena Ramp'));
    expect(agents.handOver).toHaveBeenCalledWith(STARTED.turnaroundId, { agentId: 'agent-2',
      expectedAssignmentId: 'assignment-agent-1', reason: 'Riley terminó su turno.' }, expect.any(String));
    expect(agents.options).toHaveBeenCalledWith(STARTED.turnaroundId, { signal: expect.any(AbortSignal) });
  });

  it('reads the options again when the agent or the eligibility changed, and explains the code (3-F)', async () => {
    agents.options.mockResolvedValue(HANDOVER_OPTIONS);
    agents.handOver.mockRejectedValueOnce(conflict('agent_not_eligible'));
    const onStale = vi.fn();
    renderDrawer({ flight: STARTED, onAgentHandedOver: vi.fn(), onStale });
    const form = await screen.findByRole('form', { name: 'Relevar agente' });
    await userEvent.selectOptions(within(form).getByLabelText('Agente que recibe la operación'), 'agent-2');
    await userEvent.type(within(form).getByLabelText('Motivo del relevo'), 'Riley terminó su turno.');
    await userEvent.click(within(form).getByRole('button', { name: 'Relevar agente' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('El agente ya no es elegible para lo que queda de la operación');
    await waitFor(() => expect(agents.options).toHaveBeenCalledTimes(2));
    expect(onStale).toHaveBeenCalledTimes(1);
  });

  it('shows the empty, recoverable-error and unauthorized states of the handover (3-F)', async () => {
    agents.options.mockResolvedValueOnce({ ...HANDOVER_OPTIONS, agents: [HANDOVER_OPTIONS.agents[1]] });
    const empty = renderDrawer({ flight: STARTED, onAgentHandedOver: vi.fn() });
    expect(await screen.findByText('No hay agentes elegibles ahora.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Relevar agente' })).not.toBeInTheDocument();
    empty.unmount();

    agents.options.mockRejectedValueOnce(Object.assign(new Error('network'), { status: 503 }))
      .mockResolvedValueOnce(HANDOVER_OPTIONS);
    const failing = renderDrawer({ flight: STARTED, onAgentHandedOver: vi.fn() });
    expect(await screen.findByText('No fue posible consultar los agentes para el relevo.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByRole('form', { name: 'Relevar agente' })).toBeInTheDocument();
    failing.unmount();

    agents.options.mockRejectedValueOnce(Object.assign(new Error('forbidden'), { status: 403 }));
    renderDrawer({ flight: STARTED, onAgentHandedOver: vi.fn() });
    expect(await screen.findByText('Su acceso no permite relevar agentes en esta estación.')).toBeInTheDocument();
    // A returned operation is handed over too; an assigned one is released instead.
    expect(createPlanningFlight({ operationStatus: 'Returned' }).operationStatus).toBe('Returned');
  });

  it('focuses the close control and dismisses with the Escape key', async () => {
    const { props } = renderDrawer();

    expect(screen.getByRole('button', { name: 'Cerrar panel' })).toHaveFocus();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).toHaveBeenCalledTimes(1);
  });

  it('cannot be dismissed while the assignment command is in flight', async () => {
    const { props } = renderDrawer({
      flight: createPlanningFlight({ assignedAgents: [], agents: [] }),
      assignmentState: {
        status: 'submitting',
        data: null,
        error: null,
        reason: null,
        refreshRequired: false,
      },
    });

    expect(screen.getByRole('button', { name: 'Cerrar panel' })).toBeDisabled();
    await userEvent.keyboard('{Escape}');
    expect(props.onClose).not.toHaveBeenCalled();
  });

  it('traps keyboard focus inside the modal drawer', async () => {
    renderDrawer({
      optionsState: {
        status: 'error',
        data: null,
        error: new Error('safe view error'),
        reason: 'request-failed',
        recoverable: true,
      },
    });

    const closeButton = screen.getByRole('button', { name: 'Cerrar panel' });
    const retryButton = screen.getByRole('button', { name: 'Reintentar' });

    expect(closeButton).toHaveFocus();
    await userEvent.tab({ shift: true });
    expect(retryButton).toHaveFocus();
    await userEvent.tab();
    expect(closeButton).toHaveFocus();
  });

  it('returns focus to the control that opened the drawer', async () => {
    render(<DrawerHarness />);
    const trigger = screen.getByRole('button', { name: 'Abrir detalle operativo' });

    await userEvent.click(trigger);
    expect(screen.getByRole('button', { name: 'Cerrar panel' })).toHaveFocus();

    await userEvent.click(screen.getByRole('button', { name: 'Cerrar panel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('locks background scrolling while open and restores the previous body style', () => {
    document.body.style.overflow = 'clip';
    const { unmount } = renderDrawer();

    expect(document.body.style.overflow).toBe('hidden');
    unmount();
    expect(document.body.style.overflow).toBe('clip');
    document.body.style.overflow = '';
  });

  it('exposes dialog semantics and safe fallbacks for optional API values', () => {
    const flight = createPlanningFlight({
      station: null,
      airline: null,
      airlineName: null,
      aircraft: null,
      position: null,
      terminal: null,
      operationStatus: null,
      arrival: null,
      departure: null,
      assignedAgents: [],
      assignedEquipment: [],
      assignedServices: [],
    });
    renderDrawer({ flight });

    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAttribute('aria-labelledby', 'planning-drawer-title');
    expect(dialog).toHaveAttribute('aria-describedby', 'planning-drawer-description');
    expect(dialog).toHaveAccessibleName('DEV-TAT-0002');
    expect(dialog).toHaveAccessibleDescription('Escala operativa · asignación controlada');
    expect(screen.getByText('Sin estación')).toBeInTheDocument();
    expect(screen.getByText('Sin aerolínea')).toBeInTheDocument();
    expect(screen.getByText('Sin operación creada')).toBeInTheDocument();
    expect(screen.getByText('Sin aeronave registrada')).toBeInTheDocument();
    expect(screen.getByText('Sin agentes asignados.')).toBeInTheDocument();
    expect(screen.getByText('Sin equipos asignados.')).toBeInTheDocument();
    expect(screen.getByText('Sin servicios planificados.')).toBeInTheDocument();
  });
});