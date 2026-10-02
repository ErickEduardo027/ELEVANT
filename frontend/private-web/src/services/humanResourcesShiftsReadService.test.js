import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession, handleUnauthorizedResponse } from '../features/auth/authService';
import { getHumanResourcesShiftAssignmentOptions, recordHumanResourcesShift } from
  './humanResourcesShiftsReadService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({
  readSession: vi.fn(), handleUnauthorizedResponse: vi.fn(),
}));

it('reads one agent/date options with the current session and cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const query = { rampProfileId: '50000000-0000-7000-8000-000000000001',
    workDate: '2026-10-01' };
  const read = vi.fn().mockResolvedValue({ ...query, hasShift: false, stations: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesShiftAssignmentOptions: read });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesShiftAssignmentOptions(query, { signal }))
    .resolves.toMatchObject({ hasShift: false });
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(read).toHaveBeenCalledWith(query, { signal });
});

it('records a stable shift intention and clears an expired session', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const id = '50000000-0000-7000-8000-000000000050';
  const request = { rampProfileId: '50000000-0000-7000-8000-000000000001',
    stationId: '20000000-0000-7000-8000-000000000003',
    terminalId: '20000000-0000-7000-8000-000000000004',
    workDate: '2026-10-01', startsAtLocal: '06:00:00', endsAtLocal: '14:00:00' };
  const record = vi.fn().mockRejectedValue({ status: 401 });
  createPrivateWebApiClient.mockReturnValue({ recordHumanResourcesShift: record });
  await expect(recordHumanResourcesShift(id, request))
    .rejects.toMatchObject({ status: 401 });
  expect(record).toHaveBeenCalledWith(id, request, {});
  expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});
