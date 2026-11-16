import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

const mocks = vi.hoisted(() => ({
  read: vi.fn(), save: vi.fn(), observer: vi.fn(),
}));
vi.mock('../../../services/attendanceDraftService', () => ({
  readAttendanceDraft: mocks.read,
  saveOccAttendanceDraft: mocks.save,
}));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: mocks.observer,
}));

import OccAttendancePanel from './OccAttendancePanel';

const operationId = '70000000-0000-7000-8000-000000000005';
const assignmentId = '70000000-0000-7000-8000-000000000006';
const otherAssignment = '70000000-0000-7000-8000-000000000007';
const contribution = (revision, incidentNote) => ({
  revision,
  authorAccountId: '40000000-0000-7000-8000-000000000001',
  recordedAt: '2026-10-02T12:01:00.000Z',
  observedStartAt: null,
  observedEndAt: null,
  incidentNote,
});
const snapshot = (assignment = assignmentId, occ = null, rampAgent = null) => ({
  operationId, assignmentId: assignment,
  stationId: '20000000-0000-7000-8000-000000000003', occ, rampAgent,
});

beforeEach(() => {
  vi.clearAllMocks();
  mocks.observer.mockImplementation(callback => ({ start: async () => {}, stop: async () => {}, callback }));
  mocks.read.mockResolvedValue(snapshot());
  mocks.save.mockResolvedValue({ contribution: contribution(1, 'Retraso observado'), replayed: false });
});

describe('OccAttendancePanel', () => {
  it('shows the assigned agent lane without letting OCC edit it, and saves its own lane', async () => {
    const user = userEvent.setup();
    mocks.read.mockResolvedValue(snapshot(assignmentId, null, contribution(1, 'Puerta abierta')));
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley Ramp" />);

    expect(await screen.findByText('Puerta abierta')).toBeInTheDocument();
    expect(screen.getByText('Aporte del agente')).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: 'Nota del agente' })).not.toBeInTheDocument();
    await user.type(screen.getByRole('textbox', { name: 'Nota de OCC' }), 'Retraso observado');
    await user.click(screen.getByRole('button', { name: 'Guardar observación OCC' }));

    await waitFor(() => expect(mocks.save).toHaveBeenCalledOnce());
    expect(mocks.save.mock.calls[0][0]).toBe(operationId);
    expect(mocks.save.mock.calls[0][1]).toBe(assignmentId);
    expect(mocks.save.mock.calls[0][2]).toEqual({
      expectedRevision: 0, observedStartAt: null, observedEndAt: null,
      incidentNote: 'Retraso observado',
    });
    expect(mocks.save.mock.calls[0][3]).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('keeps attempted fields after 409, shows the canonical revision, and asks for another decision', async () => {
    const user = userEvent.setup();
    let remoteRevision = false;
    mocks.read.mockImplementation(() => Promise.resolve(snapshot(assignmentId,
      contribution(remoteRevision ? 2 : 1, remoteRevision ? 'Edición concurrente' : 'Inicial'))));
    mocks.save.mockImplementationOnce(() => {
      remoteRevision = true;
      return Promise.reject({ status: 409, code: 'stale-revision', recoverable: true });
    });
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley Ramp" />);

    const note = await screen.findByRole('textbox', { name: 'Nota de OCC' });
    await waitFor(() => expect(note).toHaveValue('Inicial'));
    await user.clear(note);
    await user.type(note, 'Retraso observado');
    await user.click(screen.getByRole('button', { name: 'Guardar observación OCC' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('cambió');
    expect(note).toHaveValue('Retraso observado');
    expect(screen.getByText(/Versión guardada: 2/)).toBeInTheDocument();
    expect(mocks.save).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Guardar con versión actual' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][2].expectedRevision).toBe(2);
    expect(mocks.save.mock.calls[1][3]).not.toBe(mocks.save.mock.calls[0][3]);
  });

  it('does not save against an old revision when the post-409 refresh fails', async () => {
    const user = userEvent.setup();
    let readPhase = 'initial';
    mocks.read.mockImplementation(() => {
      if (readPhase === 'initial') return Promise.resolve(snapshot(assignmentId, contribution(1, 'Inicial')));
      if (readPhase === 'failure') {
        readPhase = 'remote';
        return Promise.reject({ code: 'request-failed', recoverable: true });
      }
      return Promise.resolve(snapshot(assignmentId, contribution(2, 'Versión remota')));
    });
    mocks.save.mockImplementationOnce(() => {
      readPhase = 'failure';
      return Promise.reject({ status: 409, code: 'stale-revision', recoverable: true });
    });
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
    const note = await screen.findByRole('textbox', { name: 'Nota de OCC' });
    await waitFor(() => expect(note).toHaveValue('Inicial'));
    await user.clear(note);
    await user.type(note, 'Mi intento');
    await user.click(screen.getByRole('button', { name: 'Guardar observación OCC' }));
    const choice = await screen.findByRole('button', { name: 'Guardar con versión actual' });
    expect(choice).toBeDisabled();
    expect(mocks.save).toHaveBeenCalledOnce();
    await user.click(screen.getByRole('button', { name: 'Actualizar aportes' }));
    await waitFor(() => expect(choice).toBeEnabled());
    await user.click(choice);
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1][2].expectedRevision).toBe(2);
  });

  it('compares canonical and attempted hours on a time-only conflict', async () => {
    const user = userEvent.setup();
    const earlier = { ...contribution(1, 'Misma nota'), observedStartAt: '2026-10-05T10:00:00Z' };
    const later = { ...contribution(2, 'Misma nota'), observedStartAt: '2026-10-05T11:00:00Z' };
    let remoteRevision = false;
    mocks.read.mockImplementation(() => Promise.resolve(snapshot(assignmentId,
      remoteRevision ? later : earlier)));
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
    const start = await screen.findByLabelText('Entrada observada');
    await waitFor(() => expect(screen.getByRole('textbox', { name: 'Nota de OCC' })).toHaveValue('Misma nota'));
    fireEvent.change(start, { target: { value: '2026-10-05T12:00' } });
    remoteRevision = true;
    mocks.observer.mock.results[0].value.callback(['attendance_draft']);
    expect(await screen.findByText(/Entrada guardada:/)).toBeInTheDocument();
    expect(screen.getByText(/Entrada de tu intento:/)).toHaveTextContent('2026-10-05T12:00');
    expect(start).toHaveValue('2026-10-05T12:00');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('rejects a local time that disappears in a daylight-saving gap', async () => {
    const priorZone = process.env.TZ;
    process.env.TZ = 'America/New_York';
    try {
      expect(new Date('2026-03-08T02:30').getHours()).toBe(3);
      const user = userEvent.setup();
      render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
      const start = await screen.findByLabelText('Entrada observada');
      fireEvent.change(start, { target: { value: '2026-03-08T02:30' } });
      await user.click(screen.getByRole('button', { name: 'Guardar observación OCC' }));
      expect(screen.getByText(/Revisa las horas/)).toBeInTheDocument();
      expect(mocks.save).not.toHaveBeenCalled();
    } finally { process.env.TZ = priorZone; }
  });

  it('does not silently replace an unsaved OCC edit after a remote revision arrives', async () => {
    const user = userEvent.setup();
    let remoteRevision = false;
    mocks.read.mockImplementation(() => Promise.resolve(snapshot(assignmentId,
      contribution(remoteRevision ? 2 : 1, remoteRevision ? 'Nueva nota remota' : 'Inicial'))));
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
    const note = await screen.findByRole('textbox', { name: 'Nota de OCC' });
    await waitFor(() => expect(note).toHaveValue('Inicial'));
    await user.clear(note);
    await user.type(note, 'Mi edición sin guardar');
    remoteRevision = true;
    mocks.observer.mock.results[0].value.callback(['attendance_draft']);
    expect(await screen.findByText(/Versión guardada: 2/)).toBeInTheDocument();
    expect(note).toHaveValue('Mi edición sin guardar');
    expect(await screen.findByRole('alert')).toHaveTextContent('cambió');
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it('retries an uncertain write with precisely the same body and idempotency key', async () => {
    const user = userEvent.setup();
    mocks.save.mockRejectedValueOnce({ code: 'unknown-outcome', recoverable: true });
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley Ramp" />);
    await screen.findByRole('textbox', { name: 'Nota de OCC' });
    await user.type(screen.getByRole('textbox', { name: 'Nota de OCC' }), 'Retraso observado');
    await user.click(screen.getByRole('button', { name: 'Guardar observación OCC' }));
    expect(await screen.findByText(/Pendiente de confirmar/)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Reintentar misma intención' }));
    await waitFor(() => expect(mocks.save).toHaveBeenCalledTimes(2));
    expect(mocks.save.mock.calls[1].slice(0, 4)).toEqual(mocks.save.mock.calls[0].slice(0, 4));
  });

  it('discards a late read from a prior assignment', async () => {
    let resolveOld;
    mocks.read.mockImplementation((_, assignment) => assignment === assignmentId
      ? new Promise(resolve => { resolveOld = resolve; })
      : Promise.resolve(snapshot(otherAssignment, contribution(1, 'Nueva asignación'))));
    const view = render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Primero" />);
    await waitFor(() => expect(resolveOld).toBeTypeOf('function'));
    view.rerender(<OccAttendancePanel operationId={operationId} assignmentId={otherAssignment} displayName="Segundo" />);
    expect(await screen.findByText('Nueva asignación')).toBeInTheDocument();
    resolveOld(snapshot(assignmentId, contribution(1, 'Dato anterior')));
    await waitFor(() => expect(screen.queryByText('Dato anterior')).not.toBeInTheDocument());
  });

  it('shows forbidden and recoverable read errors without leaking transport details', async () => {
    mocks.read.mockRejectedValueOnce({ status: 403, code: 'forbidden', recoverable: false,
      message: 'Sin permiso' });
    const view = render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Sin permiso');
    view.unmount();
    mocks.read.mockRejectedValueOnce({ status: 503, code: 'request-failed', recoverable: true,
      message: 'No fue posible consultar la asistencia.' });
    render(<OccAttendancePanel operationId={operationId} assignmentId={assignmentId} displayName="Riley" />);
    expect(await screen.findByRole('button', { name: 'Reintentar lectura' })).toBeInTheDocument();
  });
});
