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
const confirmation = { amount: 150, reference: 'TRF-001', version: 'AAAAAAAAB9E=' };
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
    await confirmCharterPrepayment(charterId, confirmation, key);
    // 4-N22: a correction carries its reason.
    await confirmCharterPrepayment(charterId, { ...confirmation, amount: 15, reason: 'Se capturó 150 en vez de 15' }, key);
    await expect(reopenCharterPrepayment(charterId, reopening, key)).resolves.toMatchObject({ prepaymentStatus: 'Pending' });
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('finance-token');
    expect(mocks.confirm).toHaveBeenNthCalledWith(1, charterId, confirmation, key);
    expect(mocks.confirm).toHaveBeenNthCalledWith(2, charterId,
      { ...confirmation, amount: 15, reason: 'Se capturó 150 en vez de 15' }, key);
    expect(mocks.reopen).toHaveBeenCalledWith(charterId, reopening, key);
  });

  it('refuses invalid data before sending it (3-N24, 4-N22)', async () => {
    await expect(reopenCharterPrepayment(charterId, { ...reopening, reason: 'corta' }, key)).rejects.toMatchObject({
      status: 400, message: 'Indique el motivo de la reapertura (entre 8 y 500 caracteres).' });
    await expect(reopenCharterPrepayment(charterId, { ...reopening, version: '' }, key))
      .rejects.toMatchObject({ status: 400 });
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, amount: 0 }, key)).rejects.toMatchObject({
      status: 400, message: 'Revise el monto y la referencia del prepago.' });
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, version: '' }, key))
      .rejects.toMatchObject({ status: 400 });
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, reason: 'Mal' }, key)).rejects.toMatchObject({
      status: 400, code: 'reason_required', message: 'Indique el motivo de la corrección (entre 5 y 500 caracteres).' });
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(mocks.confirm).not.toHaveBeenCalled();
  });

  it('explains the confirmation and correction refusals by their code (4-N22)', async () => {
    mocks.confirm.mockRejectedValueOnce(problem(409, 'charter_prepayment_applied'));
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, reason: 'Monto mal capturado' }, key))
      .rejects.toMatchObject({ status: 409, code: 'charter_prepayment_applied',
        message: 'El prepago ya se aplicó a la factura del charter. Revierta el cobro en «Cobros» y reabra el prepago para corregirlo.' });
    mocks.confirm.mockRejectedValueOnce(problem(400, 'reason_required'));
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, reason: 'Monto mal capturado' }, key))
      .rejects.toMatchObject({ message: 'Indique el motivo de la corrección (entre 5 y 500 caracteres).' });
    mocks.confirm.mockRejectedValueOnce(problem(400, 'expected_version_required'));
    await expect(confirmCharterPrepayment(charterId, confirmation, key))
      .rejects.toMatchObject({ message: 'Actualice la lista antes de confirmar el prepago.' });
    mocks.confirm.mockRejectedValueOnce(problem(400, 'invalid_charter_request'));
    await expect(confirmCharterPrepayment(charterId, confirmation, key))
      .rejects.toMatchObject({ message: 'Revise el monto y la referencia del prepago.' });
    mocks.confirm.mockRejectedValueOnce(problem(409, 'version_conflict'));
    await expect(confirmCharterPrepayment(charterId, confirmation, key)).rejects.toMatchObject({ status: 409,
      message: 'El charter cambió mientras lo revisaba. Se actualizó la lista; intente de nuevo.' });
    // Another receipt of the airline posted at the same moment is not a stale charter: nothing was saved.
    mocks.confirm.mockRejectedValueOnce(problem(409, 'charter_prepayment_receipt_conflict'));
    await expect(confirmCharterPrepayment(charterId, confirmation, key)).rejects.toMatchObject({ status: 409,
      code: 'charter_prepayment_receipt_conflict',
      message: 'Otro cobro de la aerolínea se registró al mismo tiempo y el prepago no se guardó. Se actualizó la lista; confírmelo de nuevo.' });
    mocks.confirm.mockRejectedValueOnce(new TypeError('Failed to fetch https://internal'));
    await expect(confirmCharterPrepayment(charterId, { ...confirmation, reason: 'Monto mal capturado' }, key))
      .rejects.toMatchObject({ status: null,
        message: 'No se pudo confirmar la corrección del prepago. Actualice la lista antes de intentarlo de nuevo.' });
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
    await expect(confirmCharterPrepayment(charterId, confirmation, key)).rejects.toMatchObject({
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
