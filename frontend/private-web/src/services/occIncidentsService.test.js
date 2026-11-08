import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(),
  list: vi.fn(), report: vi.fn(), change: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import { changeOccIncidentStatus, loadOccIncidents, reportOccIncident } from './occIncidentsService';

const operationId = '70000000-0000-7000-8000-000000000005';
const incidentId = '73000000-0000-7000-8000-000000000001';
const key = '22222222-2222-4222-8222-222222222222';
const report = { incidentType: 'Safety', severity: 'High', description: 'Derrame en la posición',
  occurredAt: '2026-11-08T14:00:00.000Z', delayCode: null };
const problem = (status, code) => new ElevantApiError({ kind: 'http', status, code, title: 'Server title' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'occ-token' });
  mocks.createClient.mockReturnValue({
    getOccOperationIncidents: mocks.list, reportOccIncident: mocks.report, changeOccIncidentStatus: mocks.change,
  });
});

describe('occIncidentsService (3-G)', () => {
  it('reads and writes through the shared authenticated client with the intent key and the version', async () => {
    const controller = new AbortController();
    mocks.list.mockResolvedValue({ incidents: [] });
    mocks.report.mockResolvedValue({ id: incidentId });
    mocks.change.mockResolvedValue({ id: incidentId, status: 'Resolved' });
    await expect(loadOccIncidents(operationId, { signal: controller.signal })).resolves.toEqual({ incidents: [] });
    await reportOccIncident(operationId, report, key);
    await changeOccIncidentStatus(incidentId, { status: 'Resolved', note: 'Resuelta con la aerolínea' }, 'AAAA', key);
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('occ-token');
    expect(mocks.list).toHaveBeenCalledWith(operationId, { signal: controller.signal });
    expect(mocks.report).toHaveBeenCalledWith(operationId, report, key);
    expect(mocks.change).toHaveBeenCalledWith(incidentId, { status: 'Resolved', note: 'Resuelta con la aerolínea' },
      'AAAA', key);
  });

  it('refuses an invalid form before sending it', async () => {
    await expect(reportOccIncident(operationId, { ...report, description: 'corta' }, key)).rejects.toMatchObject({
      status: 400, code: 'incident_report_invalid',
      message: 'Revise el tipo, la severidad, la descripción (8 a 2000 caracteres) y el código IATA de una desviación.',
    });
    await expect(reportOccIncident(operationId, { ...report, incidentType: 'Deviation' }, key))
      .rejects.toMatchObject({ code: 'incident_report_invalid' });
    await expect(changeOccIncidentStatus(incidentId, { status: 'Closed', note: 'corta' }, 'AAAA', key))
      .rejects.toMatchObject({ status: 400, code: 'reason_required', message: 'Escriba una nota de 8 a 2000 caracteres.' });
    expect(mocks.report).not.toHaveBeenCalled();
    expect(mocks.change).not.toHaveBeenCalled();
  });

  it('explains every refusal by its code in Spanish and keeps the status and the code', async () => {
    mocks.change.mockRejectedValueOnce(problem(412, 'version_conflict'));
    await expect(changeOccIncidentStatus(incidentId, { status: 'Resolved', note: 'Resuelta con la aerolínea' }, 'AAAA', key))
      .rejects.toMatchObject({ status: 412, code: 'version_conflict',
        message: 'La incidencia cambió mientras la revisaba. Se actualizó la lista; intente de nuevo.' });
    mocks.change.mockRejectedValueOnce(problem(409, 'incident_transition_invalid'));
    await expect(changeOccIncidentStatus(incidentId, { status: 'Resolved', note: 'Resuelta con la aerolínea' }, 'AAAA', key))
      .rejects.toMatchObject({ message: 'La incidencia ya no admite ese cambio. Se actualizó la lista.' });
    // A version the server cannot read is a malformed request, not a refused change.
    mocks.change.mockRejectedValueOnce(problem(400, 'invalid_incident_request'));
    await expect(changeOccIncidentStatus(incidentId, { status: 'Resolved', note: 'Resuelta con la aerolínea' }, 'AAAA', key))
      .rejects.toMatchObject({ status: 400, code: 'invalid_incident_request',
        message: 'La versión de la incidencia no es válida. Actualice la lista antes de cambiarla.' });
    const closed = 'La operación ya está aprobada o cancelada: sus incidencias quedan como historia y solo se ' +
      'resuelven o se cierran. Se actualizó la lista.';
    mocks.report.mockRejectedValueOnce(problem(409, 'operation_closed'));
    await expect(reportOccIncident(operationId, report, key)).rejects.toMatchObject({
      status: 409, code: 'operation_closed', message: closed });
    // A resolved incident of an approved or cancelled operation is not taken back into review.
    mocks.change.mockRejectedValueOnce(problem(409, 'operation_closed'));
    await expect(changeOccIncidentStatus(incidentId, { status: 'InReview', note: 'La aerolínea pidió revisarla' }, 'AAAA',
      key)).rejects.toMatchObject({ status: 409, code: 'operation_closed', message: closed });
    mocks.list.mockRejectedValueOnce(problem(403, undefined));
    await expect(loadOccIncidents(operationId)).rejects.toMatchObject({ status: 403,
      message: 'Su acceso no incluye las incidencias de esta operación.' });
    mocks.list.mockRejectedValueOnce(problem(404, undefined));
    await expect(loadOccIncidents(operationId)).rejects.toMatchObject({ status: 404,
      message: 'La operación o la incidencia ya no está en su alcance.' });
  });

  it('never shows the server title or a network error, and expires the session only on 401', async () => {
    mocks.report.mockRejectedValueOnce(new TypeError('Failed to fetch https://internal'));
    await expect(reportOccIncident(operationId, report, key)).rejects.toMatchObject({ status: null, code: null,
      message: 'No se pudo confirmar el reporte. Actualice la lista antes de intentarlo de nuevo.' });
    mocks.list.mockRejectedValueOnce(problem(401, undefined));
    await expect(loadOccIncidents(operationId)).rejects.toMatchObject({ status: 401 });
    expect(mocks.unauthorized).toHaveBeenCalledWith({ status: 401 });
    expect(mocks.unauthorized).toHaveBeenCalledTimes(1);
  });
});
