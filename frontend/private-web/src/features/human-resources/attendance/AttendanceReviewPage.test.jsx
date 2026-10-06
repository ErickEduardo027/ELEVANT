import { afterEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AttendanceReviewPage from './AttendanceReviewPage';
import { getHumanResourcesAttendance, validateHumanResourcesAttendance } from
  '../../../services/humanResourcesAttendanceService';

vi.mock('../../../services/humanResourcesAttendanceService', () => ({
  getHumanResourcesAttendance: vi.fn(), validateHumanResourcesAttendance: vi.fn(),
}));
const session = vi.hoisted(() => ({
  stationScopes: [{ stationId: '20000000-0000-7000-8000-000000000003', stationCode: 'PUJ' }],
  token: 'test-token',
}));
vi.mock('../../auth/AuthContext', () => ({ useAuth: () => ({ session }) }));
const observerCallbacks = vi.hoisted(() => []);
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: callback => {
    observerCallbacks.push(callback);
    return { start: vi.fn().mockResolvedValue(undefined),
      stop: vi.fn().mockResolvedValue(undefined) };
  },
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const otherStationId = '20000000-0000-7000-8000-000000000099';
const assignmentId = '70000000-0000-7000-8000-000000000006';
const occ = { revision: 1, authorAccountId: '40000000-0000-7000-8000-000000000001',
  recordedAt: '2026-10-02T12:30:00Z', observedStartAt: '2026-10-02T12:00:00Z',
  observedEndAt: '2026-10-02T14:00:00Z', incidentNote: 'Inicio en puerta' };
const rampAgent = { revision: 1, authorAccountId: '40000000-0000-7000-8000-000000000002',
  recordedAt: '2026-10-02T14:20:00Z', observedStartAt: '2026-10-02T12:05:00Z',
  observedEndAt: '2026-10-02T14:10:00Z', incidentNote: 'Salida confirmada' };
const row = { operationId: '70000000-0000-7000-8000-000000000005', assignmentId,
  stationId, operationDate: '2026-10-02', operationCode: 'EV 311',
  agentName: 'Riley Ramp', occ, rampAgent, latestDecision: null,
  isDecisionCurrent: false };
const page = { stationId, from: '2026-09-29', to: '2026-10-05',
  page: 1, limit: 20, hasMore: false, items: [row] };
const initialDate = new Date(2026, 9, 5, 12);

afterEach(() => {
  cleanup(); vi.resetAllMocks(); observerCallbacks.length = 0;
  session.stationScopes = [{ stationId, stationCode: 'PUJ' }];
  session.token = 'test-token';
});

it('shows both authored lanes and requires a reason for discrepant selected times', async () => {
  getHumanResourcesAttendance.mockResolvedValue(page);
  render(<AttendanceReviewPage initialDate={initialDate} />);
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(screen.getByText('Inicio en puerta')).toBeInTheDocument();
  expect(screen.getByText('Salida confirmada')).toBeInTheDocument();
  expect(getHumanResourcesAttendance).toHaveBeenCalledWith(
    { stationId, from: '2026-09-29', to: '2026-10-05', page: 1, limit: 20 },
    expect.objectContaining({ signal: expect.any(AbortSignal) }));
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.selectOptions(screen.getByLabelText('Fin validado'), 'RampAgent');
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeDisabled();
  await userEvent.type(screen.getByRole('textbox', { name: 'Justificación' }),
    'Incidencia revisada');
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeEnabled();
  expect(validateHumanResourcesAttendance).not.toHaveBeenCalled();
});

it('compares equivalent instants rather than timestamp strings', async () => {
  getHumanResourcesAttendance.mockResolvedValue({ ...page, items: [{ ...row,
    rampAgent: { ...rampAgent, observedStartAt: '2026-10-02T08:00:00-04:00',
      observedEndAt: '2026-10-02T10:00:00-04:00' },
  }] });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeEnabled();
  expect(screen.queryByText(/horas de los dos aportes difieren/i)).not.toBeInTheDocument();
});

it('shows an existing current decision without offering a duplicate write', async () => {
  getHumanResourcesAttendance.mockResolvedValue({ ...page, items: [{ ...row,
    isDecisionCurrent: true, latestDecision: { occRevision: 1, rampAgentRevision: 1,
      startSource: 'Occ', endSource: 'RampAgent', reason: 'Revisado' },
  }] });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.type(screen.getByRole('textbox', { name: 'Justificación' }), 'Revisado');
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeDisabled();
  expect(validateHumanResourcesAttendance).not.toHaveBeenCalled();
});

it('submits exact revisions and revalidates the canonical page', async () => {
  getHumanResourcesAttendance.mockResolvedValue(page);
  validateHumanResourcesAttendance.mockResolvedValue({ decision: { id: crypto.randomUUID() }, replayed: false });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.selectOptions(screen.getByLabelText('Fin validado'), 'RampAgent');
  await userEvent.type(screen.getByRole('textbox', { name: 'Justificación' }),
    'Incidencia revisada');
  await userEvent.click(screen.getByRole('button', { name: 'Validar asistencia' }));
  await waitFor(() => expect(validateHumanResourcesAttendance).toHaveBeenCalledWith(
    assignmentId, stationId, {
      expectedOccRevision: 1, expectedRampAgentRevision: 1,
      startSource: 'Occ', endSource: 'RampAgent', reason: 'Incidencia revisada',
    }, expect.any(String)));
  await waitFor(() => expect(getHumanResourcesAttendance).toHaveBeenCalledTimes(2));
});

it('preserves the entered reason after 409 but requires an explicit new confirmation', async () => {
  getHumanResourcesAttendance.mockResolvedValueOnce(page)
    .mockResolvedValue({ ...page, items: [{ ...row, occ: { ...occ, revision: 2 } }] });
  validateHumanResourcesAttendance.mockRejectedValueOnce({ code: 'stale-revision', status: 409 });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.selectOptions(screen.getByLabelText('Fin validado'), 'RampAgent');
  await userEvent.type(screen.getByRole('textbox', { name: 'Justificación' }),
    'Incidencia revisada');
  await userEvent.click(screen.getByRole('button', { name: 'Validar asistencia' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/cambiaron/i);
  expect(screen.getByRole('textbox', { name: 'Justificación' })).toHaveValue('Incidencia revisada');
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /Confirmar versiones actuales/i }));
  expect(screen.getByRole('button', { name: 'Validar asistencia' })).toBeEnabled();
});

it('removes previous station evidence when authorization is lost', async () => {
  getHumanResourcesAttendance.mockResolvedValueOnce(page)
    .mockRejectedValueOnce({ status: 403, code: 'forbidden' });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await act(async () => { observerCallbacks[0](['attendance_validation']); });
  expect(await screen.findByRole('alert')).toHaveTextContent(/No tienes acceso/i);
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('ignores a late page from another station', async () => {
  session.stationScopes = [{ stationId, stationCode: 'PUJ' },
    { stationId: otherStationId, stationCode: 'TST' }];
  let resolveOld;
  getHumanResourcesAttendance.mockImplementationOnce(() =>
    new Promise(resolve => { resolveOld = resolve; }))
    .mockResolvedValueOnce({ ...page, stationId: otherStationId, items: [] });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await userEvent.selectOptions(screen.getByLabelText('Estación'), otherStationId);
  expect(await screen.findByText(/No hay asignaciones/i)).toBeInTheDocument();
  await act(async () => { resolveOld(page); });
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
});

it('rejects a 31-date inclusive range before requesting evidence', async () => {
  getHumanResourcesAttendance.mockResolvedValue(page);
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  fireEvent.change(screen.getByLabelText('Desde'), { target: { value: '2026-10-01' } });
  fireEvent.change(screen.getByLabelText('Hasta'), { target: { value: '2026-10-31' } });
  expect(await screen.findByRole('alert')).toHaveTextContent(/hasta 30/i);
  expect(getHumanResourcesAttendance).not.toHaveBeenCalledWith(
    expect.objectContaining({ from: '2026-10-01', to: '2026-10-31' }),
    expect.anything());
});

it('never restores protected evidence when a pending GET resolves after validation is forbidden', async () => {
  let resolvePending;
  getHumanResourcesAttendance.mockResolvedValueOnce(page)
    .mockImplementationOnce(() => new Promise(resolve => { resolvePending = resolve; }))
    .mockResolvedValueOnce(page);
  validateHumanResourcesAttendance.mockRejectedValueOnce({ code: 'forbidden', status: 403 });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /Justificaci/i }), 'Revisado');
  await act(async () => { observerCallbacks[0](['attendance_draft']); });
  await waitFor(() => expect(getHumanResourcesAttendance).toHaveBeenCalledTimes(2));
  await userEvent.click(screen.getByRole('button', { name: 'Validar asistencia' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No tienes acceso/i);
  await act(async () => { resolvePending(page); });
  expect(screen.queryByText('Riley Ramp')).not.toBeInTheDocument();
  await act(async () => { observerCallbacks[0](['attendance_validation']); });
  expect(await screen.findByText('Riley Ramp')).toBeInTheDocument();
  expect(getHumanResourcesAttendance).toHaveBeenCalledTimes(3);
});

it('retains one exact retry after an unknown outcome across a page refresh', async () => {
  getHumanResourcesAttendance.mockResolvedValueOnce(page)
    .mockResolvedValueOnce({ ...page, items: [] })
    .mockResolvedValue({ ...page, items: [] });
  validateHumanResourcesAttendance.mockRejectedValueOnce({ code: 'unknown-outcome' })
    .mockResolvedValueOnce({ decision: { id: crypto.randomUUID() }, replayed: true });
  render(<AttendanceReviewPage initialDate={initialDate} />);
  await screen.findByText('Riley Ramp');
  await userEvent.click(screen.getByRole('button', { name: /Revisar EV 311/i }));
  await userEvent.type(screen.getByRole('textbox', { name: /Justificaci/i }), 'Revisado');
  await userEvent.click(screen.getByRole('button', { name: 'Validar asistencia' }));
  expect(await screen.findByRole('alert')).toHaveTextContent(/No se confirm/i);
  const first = validateHumanResourcesAttendance.mock.calls[0];
  await act(async () => { observerCallbacks[0](['attendance_validation']); });
  expect(await screen.findByText(/No hay asignaciones/i)).toBeInTheDocument();
  expect(screen.getByLabelText(/Estaci/i)).toBeDisabled();
  await userEvent.click(screen.getByRole('button', { name: /Reintentar misma validaci/i }));
  await waitFor(() => expect(validateHumanResourcesAttendance).toHaveBeenCalledTimes(2));
  expect(validateHumanResourcesAttendance.mock.calls[1]).toEqual(first);
});
