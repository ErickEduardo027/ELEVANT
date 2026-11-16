import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  exportOccReport: vi.fn(),
  getOccReport: vi.fn(),
  listOccReports: vi.fn(),
  readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
}));

vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { downloadOccReport, getOccReport } from './occReportsService';

const query = { stationId: '20000000-0000-7000-8000-000000000001', from: '2026-01-01', to: '2026-12-31' };
const problem = (status, code) => Object.assign(new Error(`HTTP ${status}`),
  { status, title: 'Narrow the filters before exporting.', ...(code && { code }) });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'occ-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({
    exportOccReport: mocks.exportOccReport, getOccReport: mocks.getOccReport, listOccReports: mocks.listOccReports,
  });
});

describe('occReportsService', () => {
  it('explains an export over its row limit by its code and never shows the server title (3-N13)', async () => {
    mocks.exportOccReport.mockRejectedValueOnce(problem(422, 'report_too_large'));
    const error = await downloadOccReport('operations', query, 'xlsx', 'PUJ').catch(failure => failure);
    expect(error).toMatchObject({ status: 422, code: 'report_too_large' });
    expect(error.message).toBe('El reporte supera el máximo de filas exportables. Acote el período o los filtros.');
    expect(error.message).not.toContain('Narrow');
  });

  it('translates the query, report and station codes and keeps a refused permission as access', async () => {
    mocks.getOccReport
      .mockRejectedValueOnce(problem(400, 'invalid_report_query'))
      .mockRejectedValueOnce(problem(404, 'report_not_found'))
      .mockRejectedValueOnce(problem(404, 'station_unavailable'))
      .mockRejectedValueOnce(problem(403))
      .mockRejectedValueOnce(Object.assign(new TypeError('Failed to fetch'), { status: undefined }));
    const read = () => getOccReport('operations', { ...query, page: 1, limit: 25 }).catch(failure => failure);
    expect((await read()).message).toBe(
      'Revise el período: la fecha final no puede ser anterior a la inicial y el máximo es un año.');
    expect((await read()).message).toBe('Ese reporte ya no existe; actualice la página.');
    expect(await read()).toMatchObject({ status: 404, code: 'station_unavailable',
      message: 'La estación no está disponible para su cuenta.' });
    const forbidden = await read();
    expect(forbidden).toMatchObject({ status: 403, message: 'Tu acceso no incluye los reportes de esta estación.' });
    expect(forbidden.code).toBeUndefined();
    expect(await read()).toMatchObject({ status: null, message: 'No se pudo generar el reporte. Intenta nuevamente.' });
  });

  it('ends the session on a 401 and passes an aborted request through', async () => {
    mocks.getOccReport.mockRejectedValueOnce(problem(401));
    expect((await getOccReport('operations', query).catch(failure => failure)).message)
      .toBe('La sesión expiró. Vuelva a iniciar sesión.');
    expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    mocks.getOccReport.mockRejectedValueOnce(aborted);
    await expect(getOccReport('operations', query)).rejects.toBe(aborted);
  });
});
