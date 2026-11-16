import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(),
  queue: vi.fn(), detail: vi.fn(), decide: vi.fn(), add: vi.fn(), remove: vi.fn(), exclusion: vi.fn(), reopen: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import {
  addOccReviewCharge, decideOccReview, loadOccReviewDetail, loadOccReviewQueue, removeOccReviewCharge, reopenOccReview,
  setOccReviewBillingExclusion,
} from './occReviewService';

const stationId = '20000000-0000-0000-0000-000000000001';
const operationId = '70000000-0000-0000-0000-000000000016';
const submissionId = '70000000-0000-0000-0000-000000000017';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'test-access-token' });
  mocks.createClient.mockReturnValue({
    getOccReviewQueue: mocks.queue,
    getOccReviewDetail: mocks.detail,
    decideOccReview: mocks.decide,
    addOccReviewCharge: mocks.add,
    removeOccReviewCharge: mocks.remove,
    setOccReviewServiceBillingExclusion: mocks.exclusion,
    reopenOccReview: mocks.reopen,
  });
});

describe('occReviewService', () => {
  it('uses the shared authenticated client and passes cancellation through', async () => {
    const controller = new AbortController();
    const queue = { operations: [] };
    const detail = { operationId };
    const decision = { outcome: 'Approved' };
    mocks.queue.mockResolvedValue(queue);
    mocks.detail.mockResolvedValue(detail);
    mocks.decide.mockResolvedValue(decision);

    await expect(loadOccReviewQueue(stationId, { signal: controller.signal })).resolves.toBe(queue);
    await expect(loadOccReviewDetail(operationId, { signal: controller.signal })).resolves.toBe(detail);
    await expect(decideOccReview(operationId, {
      submissionId, outcome: 'Approved',
    }, '"etag"', { signal: controller.signal })).resolves.toBe(decision);

    expect(mocks.createClient).toHaveBeenCalledTimes(3);
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('test-access-token');
    expect(mocks.queue).toHaveBeenCalledWith(stationId, { signal: controller.signal });
    expect(mocks.detail).toHaveBeenCalledWith(operationId, { signal: controller.signal });
    expect(mocks.decide).toHaveBeenCalledWith(operationId,
      { submissionId, outcome: 'Approved' }, '"etag"', { signal: controller.signal });
  });

  it('expires the browser session only on 401 and does not expose server details', async () => {
    mocks.queue.mockRejectedValue(new ElevantApiError({ kind: 'http', status: 401,
      title: 'secret database exception' }));
    await expect(loadOccReviewQueue(stationId)).rejects.toMatchObject({
      code: 'unauthorized', status: 401,
    });
    expect(mocks.unauthorized).toHaveBeenCalledWith({ status: 401 });

    mocks.decide.mockRejectedValue(new ElevantApiError({ kind: 'http', status: 412,
      title: 'private conflict detail' }));
    await expect(decideOccReview(operationId, {
      submissionId, outcome: 'Approved',
    }, '"etag"')).rejects.toMatchObject({ code: 'stale', status: 412 });
    expect(mocks.unauthorized).toHaveBeenCalledTimes(1);
  });

  it('treats ambiguous decisions as unknown outcomes that require a refresh', async () => {
    mocks.decide.mockRejectedValue(new TypeError('network with sensitive address'));
    await expect(decideOccReview(operationId, {
      submissionId, outcome: 'Returned', reason: 'Corregir servicio',
    }, '"etag"')).rejects.toMatchObject({ code: 'unknown-outcome' });
  });
});

describe('occReviewService commands of phase 3, block D', () => {
  const key = '11111111-1111-4111-8111-111111111111';
  const serviceId = '70000000-0000-0000-0000-000000000018';
  const problem = (status, code) => new ElevantApiError({ kind: 'http', status, code, title: 'Server title' });

  it('sends the intent key with the decision and the adjustments only when there is one', async () => {
    mocks.decide.mockResolvedValue({});
    mocks.add.mockResolvedValue({ reviewVersion: '"next"' });
    mocks.remove.mockResolvedValue({ reviewVersion: '"next"' });
    await decideOccReview(operationId, { submissionId, outcome: 'Approved' }, '"etag"', { idempotencyKey: key });
    expect(mocks.decide).toHaveBeenLastCalledWith(operationId, { submissionId, outcome: 'Approved' }, '"etag"',
      { signal: undefined, idempotencyKey: key });
    const charge = { submissionId, serviceId, chargeId: serviceId, reason: 'Cargo administrativo acordado' };
    await addOccReviewCharge(operationId, charge, '"etag"', { idempotencyKey: key });
    expect(mocks.add).toHaveBeenCalledWith(operationId, charge, '"etag"', { signal: undefined, idempotencyKey: key });
    await removeOccReviewCharge(operationId, serviceId, { submissionId, reason: 'Fue operación diurna' }, '"etag"');
    expect(mocks.remove.mock.calls[0][4]).toEqual({ signal: undefined });
  });

  it('excludes a service from billing and reopens an approval with their keys and versions', async () => {
    mocks.exclusion.mockResolvedValue({ reviewVersion: '"next"' });
    mocks.reopen.mockResolvedValue({ operationId, revisionNumber: 3 });
    const exclusion = { submissionId, excluded: true, reason: 'La GPU falló a la mitad' };
    await expect(setOccReviewBillingExclusion(operationId, serviceId, exclusion, '"etag"', key))
      .resolves.toEqual({ reviewVersion: '"next"' });
    expect(mocks.exclusion).toHaveBeenCalledWith(operationId, serviceId, exclusion, '"etag"', key);
    await expect(reopenOccReview(operationId, { submissionId, reason: 'La aerolínea pidió revisar' }, '"etag"', key))
      .resolves.toMatchObject({ revisionNumber: 3 });
    expect(mocks.reopen).toHaveBeenCalledWith(operationId, { submissionId, reason: 'La aerolínea pidió revisar' },
      '"etag"', key);
  });

  it('refuses a short reason before sending it', async () => {
    await expect(setOccReviewBillingExclusion(operationId, serviceId, { submissionId, excluded: false, reason: 'corta' },
      '"etag"', key)).rejects.toMatchObject({ status: 400, code: 'reason_required',
      message: 'El motivo debe tener entre 8 y 500 caracteres.' });
    await expect(reopenOccReview(operationId, { submissionId, reason: 'corta' }, '"etag"', key)).rejects.toMatchObject({
      code: 'reason_required', message: 'El motivo de la reapertura debe tener entre 8 y 2000 caracteres.' });
    await expect(decideOccReview(operationId, { submissionId, outcome: 'Returned', reason: 'x' }, '"etag"'))
      .rejects.toMatchObject({ code: 'reason_required' });
    expect(mocks.exclusion).not.toHaveBeenCalled();
    expect(mocks.reopen).not.toHaveBeenCalled();
    expect(mocks.decide).not.toHaveBeenCalled();
  });

  it('explains the refusals by their code and keeps it (3-H, 3-N02, 3-N11, 3-N29)', async () => {
    mocks.decide.mockRejectedValueOnce(problem(409, 'service_order_unsigned'));
    await expect(decideOccReview(operationId, { submissionId, outcome: 'Approved' }, '"etag"')).rejects.toMatchObject({
      status: 409, code: 'service_order_unsigned',
      message: 'La Orden de Servicio debe estar firmada: devuélvala a rampa para firmar de nuevo.' });
    mocks.reopen.mockRejectedValueOnce(problem(409, 'already_invoiced'));
    await expect(reopenOccReview(operationId, { submissionId, reason: 'La aerolínea pidió revisar' }, '"etag"', key))
      .rejects.toMatchObject({ code: 'already_invoiced', message: 'Ya hay servicios facturados: corrija con una nota de crédito.' });
    // A reopening refused for its Service Order never tells OCC to return it to the ramp.
    mocks.reopen.mockRejectedValueOnce(problem(409, 'service_order_stale'));
    await expect(reopenOccReview(operationId, { submissionId, reason: 'La aerolínea pidió revisar' }, '"etag"', key))
      .rejects.toMatchObject({ code: 'service_order_stale',
        message: expect.stringContaining('esta aprobación no se puede reabrir') });
    mocks.add.mockRejectedValueOnce(problem(409, 'charge_excluded_by_contract'));
    await expect(addOccReviewCharge(operationId, { submissionId, serviceId, chargeId: serviceId,
      reason: 'Cargo administrativo acordado' }, '"etag"')).rejects.toMatchObject({
      code: 'charge_excluded_by_contract', message: 'El contrato de la aerolínea excluye este cargo.' });
    mocks.exclusion.mockRejectedValueOnce(problem(412, 'version_conflict'));
    await expect(setOccReviewBillingExclusion(operationId, serviceId,
      { submissionId, excluded: true, reason: 'La GPU falló a la mitad' }, '"etag"', key)).rejects.toMatchObject({
      status: 412, code: 'version_conflict', message: 'La entrega cambió. Actualice el detalle antes de decidir.' });
    mocks.detail.mockRejectedValueOnce(problem(404, undefined));
    await expect(loadOccReviewDetail(operationId)).rejects.toMatchObject({ status: 404, code: 'not-found',
      message: 'La operación ya no está disponible en su estación.' });
    mocks.reopen.mockRejectedValueOnce(problem(403, undefined));
    await expect(reopenOccReview(operationId, { submissionId, reason: 'La aerolínea pidió revisar' }, '"etag"', key))
      .rejects.toMatchObject({ status: 403, code: 'forbidden', message: 'No tiene permiso para revisar esta operación.' });
  });

  it('treats a lost answer of a new command as an unknown outcome', async () => {
    mocks.reopen.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    await expect(reopenOccReview(operationId, { submissionId, reason: 'La aerolínea pidió revisar' }, '"etag"', key))
      .rejects.toMatchObject({ status: null, code: 'unknown-outcome',
        message: 'No fue posible confirmar la reapertura. Actualiza el detalle antes de intentarlo de nuevo.' });
    mocks.exclusion.mockRejectedValueOnce(problem(503, undefined));
    await expect(setOccReviewBillingExclusion(operationId, serviceId,
      { submissionId, excluded: true, reason: 'La GPU falló a la mitad' }, '"etag"', key))
      .rejects.toMatchObject({ status: 503, code: 'unknown-outcome' });
  });
});
