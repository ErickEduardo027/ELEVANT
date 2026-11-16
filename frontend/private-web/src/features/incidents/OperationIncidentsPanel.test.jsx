import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DepartmentAccessProvider } from '../access/DepartmentAccessContext';

const mocks = vi.hoisted(() => ({ load: vi.fn(), report: vi.fn(), change: vi.fn() }));
vi.mock('../../services/occIncidentsService', () => ({
  loadOccIncidents: mocks.load,
  reportOccIncident: mocks.report,
  changeOccIncidentStatus: mocks.change,
}));

import OperationIncidentsPanel from './OperationIncidentsPanel';

const operationId = '70000000-0000-7000-8000-000000000005';
const incidentId = '73000000-0000-7000-8000-000000000001';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const incident = {
  id: incidentId, type: 'Safety', severity: 'High', status: 'Open', description: 'Derrame de combustible en la posición',
  occurredAt: '2026-11-08T14:00:00.000Z', reportedAt: '2026-11-08T14:05:00.000Z', delayCode: null,
  reportedBy: 'Riley Ramp', reportedByKind: 'Agent', resolutionNote: null, resolvedAt: null, resolvedBy: null,
  version: 'AAAAAAAAB9E=', allowedStatuses: ['InReview', 'Resolved'],
  history: [{ fromStatus: null, toStatus: 'Open', note: 'Reportada desde la tablet.', occurredAt: '2026-11-08T14:05:00.000Z',
    actor: 'Riley Ramp' }],
};
const list = {
  operationId, operationCode: 'PUJ-20261108-001', operationStatus: 'InProgress', ianaTimeZone: 'America/Santo_Domingo',
  canReport: true, incidents: [incident],
};
const manager = { kind: 'Member', permissions: ['operations.incidents.read', 'operations.incidents.update'] };

function renderPanel({ access = manager, refreshToken = 0 } = {}) {
  const panel = token => (access
    ? <DepartmentAccessProvider initialAccess={access} observe={false}>
      <OperationIncidentsPanel operationId={operationId} refreshToken={token} />
    </DepartmentAccessProvider>
    : <OperationIncidentsPanel operationId={operationId} refreshToken={token} />);
  const view = render(panel(refreshToken));
  return { ...view, refresh: token => view.rerender(panel(token)) };
}

const failure = (status, code, message) => Object.assign(new Error(message), { status, code });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.load.mockResolvedValue(list);
});

describe('OperationIncidentsPanel (3-G)', () => {
  it('lists the live incidents in Spanish with who reported them and their history', async () => {
    renderPanel();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando incidencias…');
    const panel = await screen.findByRole('region', { name: 'Incidencias de la operación' });
    expect(await within(panel).findByText('Seguridad · Alta')).toBeInTheDocument();
    expect(within(panel).getByText(/· Abierta/)).toBeInTheDocument();
    expect(within(panel).getByText(/PUJ-20261108-001 · En curso/)).toBeInTheDocument();
    expect(within(panel).getByText(/Reportada por Riley Ramp \(agente\)/)).toBeInTheDocument();
    expect(within(panel).getByText('Historial (1)')).toBeInTheDocument();
    expect(within(panel).getByText(/Riley Ramp: reportada → Abierta — Reportada desde la tablet\./)).toBeInTheDocument();
    expect(within(panel).queryByText(/Safety|High|InProgress/)).not.toBeInTheDocument();
    expect(mocks.load).toHaveBeenCalledWith(operationId, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it('shows the empty, recoverable error and unauthorized states', async () => {
    mocks.load.mockResolvedValueOnce({ ...list, incidents: [] });
    const { unmount } = renderPanel();
    expect(await screen.findByText('Sin incidencias.')).toBeInTheDocument();
    unmount();

    mocks.load.mockRejectedValueOnce(failure(null, null, 'No se pudieron cargar las incidencias. Revise la conexión e intente de nuevo.'));
    const second = renderPanel();
    expect(await screen.findByText('No se pudieron cargar las incidencias.')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByText('Seguridad · Alta')).toBeInTheDocument();
    second.unmount();

    mocks.load.mockRejectedValueOnce(failure(403, null, 'Su acceso no incluye las incidencias de esta operación.'));
    renderPanel();
    expect(await screen.findByText('Su acceso no incluye las incidencias de esta operación.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });

  it('is hidden without the read permission and read-only without the update permission', async () => {
    const { unmount } = renderPanel({ access: { kind: 'Member', permissions: ['operations.review.read'] } });
    expect(screen.queryByRole('region', { name: 'Incidencias de la operación' })).not.toBeInTheDocument();
    expect(mocks.load).not.toHaveBeenCalled();
    unmount();

    renderPanel({ access: { kind: 'Member', permissions: ['operations.incidents.read'] } });
    expect(await screen.findByText('Seguridad · Alta')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Resolver' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reportar incidencia' })).not.toBeInTheDocument();
  });

  it('moves an incident only with a note, with the version it saw and the intent key', async () => {
    const user = userEvent.setup();
    mocks.change.mockResolvedValue({ ...incident, status: 'Resolved' });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Resolver' }));
    const form = screen.getByRole('form', { name: 'Resolver' });
    const save = within(form).getByRole('button', { name: 'Guardar' });
    expect(save).toBeDisabled();
    await user.type(within(form).getByLabelText('Nota (8 a 2000 caracteres)'), '  Limpieza hecha por bomberos ');
    await user.click(save);
    await waitFor(() => expect(mocks.change).toHaveBeenCalledWith(incidentId,
      { status: 'Resolved', note: 'Limpieza hecha por bomberos' }, 'AAAAAAAAB9E=', expect.stringMatching(UUID)));
    expect(await screen.findByText('Incidencia actualizada.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
  });

  it('explains a refused change by its code and re-reads after a stale version', async () => {
    const user = userEvent.setup();
    mocks.change.mockRejectedValueOnce(failure(412, 'version_conflict',
      'La incidencia cambió mientras la revisaba. Se actualizó la lista; intente de nuevo.'));
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Pasar a revisión' }));
    await user.type(screen.getByLabelText('Nota (8 a 2000 caracteres)'), 'La aerolínea pidió revisarla');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('La incidencia cambió mientras la revisaba. Se actualizó la lista; intente de nuevo.'))
      .toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(2));
    expect(screen.queryByLabelText('Nota (8 a 2000 caracteres)')).not.toBeInTheDocument();

    mocks.change.mockRejectedValueOnce(failure(409, 'incident_transition_invalid',
      'La incidencia ya no admite ese cambio. Se actualizó la lista.'));
    await user.click(screen.getByRole('button', { name: 'Resolver' }));
    await user.type(screen.getByLabelText('Nota (8 a 2000 caracteres)'), 'Resuelta con la aerolínea');
    await user.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText('La incidencia ya no admite ese cambio. Se actualizó la lista.')).toBeInTheDocument();
    await waitFor(() => expect(mocks.load).toHaveBeenCalledTimes(3));
  });

  it('reports an OCC deviation in the station local time with its IATA code', async () => {
    const user = userEvent.setup();
    mocks.report.mockResolvedValue({ ...incident, id: '73000000-0000-7000-8000-000000000002' });
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Reportar incidencia' }));
    const form = screen.getByRole('form', { name: 'Nueva incidencia de OCC' });
    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Deviation');
    await user.selectOptions(within(form).getByLabelText('Severidad'), 'Medium');
    await user.selectOptions(within(form).getByLabelText('Código IATA de la demora'), '87');
    const occurredAt = within(form).getByLabelText('Hora en que ocurrió (hora local de la estación)');
    await user.clear(occurredAt);
    await user.type(occurredAt, '2026-11-08T10:00');
    await user.type(within(form).getByLabelText('Descripción (8 a 2000 caracteres)'), 'Demora por la torre de control');
    await user.click(within(form).getByRole('button', { name: 'Reportar' }));
    await waitFor(() => expect(mocks.report).toHaveBeenCalledWith(operationId, {
      incidentType: 'Deviation', severity: 'Medium', description: 'Demora por la torre de control',
      occurredAt: '2026-11-08T14:00:00.000Z', delayCode: '87',
    }, expect.stringMatching(UUID)));
    expect(await screen.findByText('Incidencia reportada.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Nueva incidencia de OCC' })).not.toBeInTheDocument();
  });

  it('keeps the key of a report whose answer was lost and shows the refusal by code', async () => {
    const user = userEvent.setup();
    mocks.report
      .mockRejectedValueOnce(failure(null, null, 'No se pudo confirmar el reporte. Actualice la lista antes de intentarlo de nuevo.'))
      .mockRejectedValueOnce(failure(400, 'incident_occurred_at_invalid', 'La hora está en el futuro o es anterior a la operación.'));
    renderPanel();
    await user.click(await screen.findByRole('button', { name: 'Reportar incidencia' }));
    const form = screen.getByRole('form', { name: 'Nueva incidencia de OCC' });
    await user.selectOptions(within(form).getByLabelText('Tipo'), 'Safety');
    await user.selectOptions(within(form).getByLabelText('Severidad'), 'High');
    await user.type(within(form).getByLabelText('Descripción (8 a 2000 caracteres)'), 'Derrame en la posición 5');
    await user.click(within(form).getByRole('button', { name: 'Reportar' }));
    expect(await within(form).findByText(/No se pudo confirmar el reporte/)).toBeInTheDocument();
    await user.click(within(form).getByRole('button', { name: 'Reportar' }));
    expect(await within(form).findByText('La hora está en el futuro o es anterior a la operación.')).toBeInTheDocument();
    expect(mocks.report.mock.calls[1][2]).toBe(mocks.report.mock.calls[0][2]);
    expect(mocks.report.mock.calls[0][1]).toMatchObject({ incidentType: 'Safety', delayCode: null });
  });

  it('re-reads silently on an announcement and says when the operation no longer takes reports', async () => {
    const { refresh } = renderPanel();
    expect(await screen.findByText('Seguridad · Alta')).toBeInTheDocument();
    mocks.load.mockResolvedValueOnce({ ...list, operationStatus: 'Approved', canReport: false,
      incidents: [{ ...incident, status: 'Resolved', allowedStatuses: ['Closed', 'InReview'],
        resolutionNote: 'Cerrada al aprobar la revisión de OCC.', resolvedBy: 'Alex Operations',
        resolvedAt: '2026-11-08T16:00:00.000Z' }] });
    refresh(1);
    expect(screen.queryByText('Cargando incidencias…')).not.toBeInTheDocument();
    expect(await screen.findByText(/Resolución: Cerrada al aprobar la revisión de OCC\./)).toBeInTheDocument();
    expect(screen.getByText('La operación está cerrada: ya no se reportan incidencias.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reportar incidencia' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Volver a revisión' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cerrar' })).toBeInTheDocument();
  });
});
