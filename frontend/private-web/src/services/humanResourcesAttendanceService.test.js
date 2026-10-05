import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { getHumanResourcesAttendance, validateHumanResourcesAttendance } from './humanResourcesAttendanceService';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

const stationId = '20000000-0000-7000-8000-000000000003';
const assignmentId = '70000000-0000-7000-8000-000000000006';
const query = { stationId, from: '2026-10-01', to: '2026-10-05', page: 1, limit: 20 };
const body = { expectedOccRevision: 1, expectedRampAgentRevision: 2,
  startSource: 'Occ', endSource: 'RampAgent', reason: 'Revisado' };
const key = '82000000-0000-7000-8000-000000000052';

beforeEach(() => readSession.mockReturnValue({ token: 'first-token' }));
afterEach(() => vi.resetAllMocks());

describe('humanResourcesAttendanceService', () => {
  it('captures a token per read and forwards abort signals', async () => {
    const page = { items: [] };
    const getHumanResourcesAttendanceApi = vi.fn().mockResolvedValue(page);
    createPrivateWebApiClient.mockReturnValue({ getHumanResourcesAttendance: getHumanResourcesAttendanceApi });
    const signal = new AbortController().signal;
    await expect(getHumanResourcesAttendance(query, { signal })).resolves.toBe(page);
    expect(getHumanResourcesAttendanceApi).toHaveBeenCalledWith(query, { signal });
    expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('first-token');
  });

  it('rejects a reply from a changed session', async () => {
    createPrivateWebApiClient.mockReturnValue({
      getHumanResourcesAttendance: vi.fn().mockImplementation(async () => {
        readSession.mockReturnValue({ token: 'second-token' });
        return { items: [] };
      }),
    });
    await expect(getHumanResourcesAttendance(query)).rejects.toMatchObject({ code: 'cancelled' });
  });

  it('keeps a write result uncertain without inventing a fresh intention', async () => {
    const validate = vi.fn().mockRejectedValue(new TypeError('network'));
    createPrivateWebApiClient.mockReturnValue({ validateHumanResourcesAttendance: validate });
    await expect(validateHumanResourcesAttendance(assignmentId, stationId, body, key))
      .rejects.toMatchObject({ code: 'unknown-outcome' });
    expect(validate).toHaveBeenCalledWith(assignmentId, stationId, body, key, { signal: undefined });
  });

  it('maps conflict and expires the session on 401', async () => {
    const validate = vi.fn().mockRejectedValueOnce({ status: 409 })
      .mockRejectedValueOnce({ status: 401 });
    createPrivateWebApiClient.mockReturnValue({ validateHumanResourcesAttendance: validate });
    await expect(validateHumanResourcesAttendance(assignmentId, stationId, body, key))
      .rejects.toMatchObject({ code: 'stale-revision', status: 409 });
    await expect(validateHumanResourcesAttendance(assignmentId, stationId, body, key))
      .rejects.toMatchObject({ code: 'unauthorized', status: 401 });
    expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
  });
});
