import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(),
  queue: vi.fn(), detail: vi.fn(), decide: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import { decideOccReview, loadOccReviewDetail, loadOccReviewQueue } from './occReviewService';

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