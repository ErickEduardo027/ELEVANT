import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(),
  list: vi.fn(), confirm: vi.fn(), reopen: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import { confirmCharterPrepayment, listFinanceCharters, reopenCharterPrepayment } from './financeChartersService';

const charterId = '74000000-0000-7000-8000-000000000001';
const key = '33333333-3333-4333-8333-333333333333';
const reopening = { reason: 'El transportista pidió otro servicio', version: 'AAAAAAAAB9E=' };
const problem = (status, code) => new ElevantApiError({ kind: 'http', status, code, title: 'Server title' });

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createClient.mockReturnValue({
    getFinanceCharters: mocks.list, confirmFinanceCharterPrepayment: mocks.confirm,
    reopenFinanceCharterPrepayment: mocks.reopen,
  });
});

describe('financeChartersService', () => {
  it('lists, confirms and reopens through the shared authenticated client', async () => {
    mocks.list.mockResolvedValue({ charters: [{ id: charterId }] });
    mocks.confirm.mockResolvedValue({ id: charterId, prepaymentStatus: 'Confirmed' });
    mocks.reopen.mockResolvedValue({ id: charterId, prepaymentStatus: 'Pending' });
    await expect(listFinanceCharters()).resolves.toEqual([{ id: charterId }]);
    await confirmCharterPrepayment(charterId, 150, 'TRF-001');
    await expect(reopenCharterPrepayment(charterId, reopening, key)).resolves.toMatchObject({ prepaymentStatus: 'Pending' });
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('finance-token');
    expect(mocks.confirm).toHaveBeenCalledWith(charterId, { amount: 150, reference: 'TRF-001' });
    expect(mocks.reopen).toHaveBeenCalledWith(charterId, reopening, key);
  });

  it('refuses invalid data before sending it (3-N24)', async () => {
    await expect(reopenCharterPrepayment(charterId, { ...reopening, reason: 'corta' }, key)).rejects.toMatchObject({
      status: 400, message: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).' });
    await expect(reopenCharterPrepayment(charterId, { ...reopening, version: '' }, key))
      .rejects.toMatchObject({ status: 400 });
    await expect(confirmCharterPrepayment(charterId, 0, 'TRF-001')).rejects.toMatchObject({
      status: 400, message: 'Revise el monto y la referencia del prepago.' });
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('explains the reopening refusals by their code and keeps the status and the code', async () => {
    mocks.reopen.mockRejectedValueOnce(problem(409, 'charter_prepayment_not_confirmed'));
    await expect(reopenCharterPrepayment(charterId, reopening, key)).rejects.toMatchObject({
      status: 409, code: 'charter_prepayment_not_confirmed',
      message: 'El prepago ya no está confirmado. Se actualizó la lista.' });
    mocks.reopen.mockRejectedValueOnce(problem(409, 'version_conflict'));
    await expect(reopenCharterPrepayment(charterId, reopening, key)).rejects.toMatchObject({
      code: 'version_conflict',
      message: 'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.' });
    mocks.reopen.mockRejectedValueOnce(problem(403, undefined));
    await expect(reopenCharterPrepayment(charterId, reopening, key)).rejects.toMatchObject({
      status: 403, message: 'Su acceso no incluye los charters de Finanzas.' });
    mocks.reopen.mockRejectedValueOnce(problem(404, undefined));
    await expect(reopenCharterPrepayment(charterId, reopening, key)).rejects.toMatchObject({
      status: 404, message: 'El charter ya no existe o no es de sus estaciones.' });
  });

  it('keeps the existing explanation of a confirmation refused without a code', async () => {
    mocks.confirm.mockRejectedValueOnce(problem(409, undefined));
    await expect(confirmCharterPrepayment(charterId, 150, 'TRF-001')).rejects.toMatchObject({
      status: 409, message: 'Este charter ya tiene otro prepago confirmado. Se actualizó la lista.' });
  });

  it('never shows a network error or the server title, and expires the session only on 401', async () => {
    mocks.reopen.mockRejectedValueOnce(new TypeError('Failed to fetch https://internal'));
    await expect(reopenCharterPrepayment(charterId, reopening, key)).rejects.toMatchObject({ status: null,
      message: 'No se pudo confirmar la reapertura. Actualice la lista antes de intentarlo de nuevo.' });
    mocks.list.mockRejectedValueOnce(problem(401, undefined));
    await expect(listFinanceCharters()).rejects.toMatchObject({ status: 401 });
    expect(mocks.unauthorized).toHaveBeenCalledTimes(1);
    mocks.list.mockRejectedValueOnce(problem(500, undefined));
    await expect(listFinanceCharters()).rejects.toMatchObject({
      message: 'No se pudieron cargar los charters. Intente nuevamente.' });
  });
});
