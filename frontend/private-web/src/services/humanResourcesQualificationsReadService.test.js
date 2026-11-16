import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { getHumanResourcesQualifications, getHumanResourcesQualificationEquipmentTypes,
  getHumanResourcesQualificationHistory, getHumanResourcesQualificationSummary,
  recordHumanResourcesQualification } from './humanResourcesQualificationsReadService';
import { handleUnauthorizedResponse } from '../features/auth/authService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

it('uses the shared authenticated API client with paging and cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const read = vi.fn().mockResolvedValue({ page: 1, limit: 20, hasMore: false, qualifications: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesQualifications: read });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesQualifications({ page: 1, limit: 20 }, { signal }))
    .resolves.toMatchObject({ qualifications: [] });
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(read).toHaveBeenCalledWith({ page: 1, limit: 20 }, { signal });
});

it('loads equipment options and sends an idempotent qualification record through the shared client', async () => {
  readSession.mockReturnValue({ token: 'fresh-hr-token' });
  const options = vi.fn().mockResolvedValue([{ id: 'equipment-id', code: 'GPU', name: 'GPU' }]);
  const record = vi.fn().mockResolvedValue({ id: 'record-id', cycleNumber: 2 });
  createPrivateWebApiClient.mockReturnValue({
    getHumanResourcesQualificationEquipmentTypes: options,
    recordHumanResourcesQualification: record,
  });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesQualificationEquipmentTypes({ signal }))
    .resolves.toHaveLength(1);
  const request = { rampProfileId: 'agent-id', equipmentTypeId: 'equipment-id',
    expectedCurrentId: 'old-id' };
  await expect(recordHumanResourcesQualification('record-id', request))
    .resolves.toMatchObject({ cycleNumber: 2 });
  expect(createPrivateWebApiClient.mock.calls.at(-1)[0].getAccessToken()).toBe('fresh-hr-token');
  expect(options).toHaveBeenCalledWith({ signal });
  expect(record).toHaveBeenCalledWith('record-id', request, {});
});
it('reads the qualification summary and history and reports an expired session', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const summary = vi.fn().mockResolvedValue({ total: 0 });
  const history = vi.fn().mockRejectedValue(Object.assign(new Error('expired'), { status: 401 }));
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesQualificationSummary: summary,
    getHumanResourcesQualificationHistory: history });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesQualificationSummary({ asOf: '2026-10-13' }, { signal }))
    .resolves.toEqual({ total: 0 });
  expect(summary).toHaveBeenCalledWith({ asOf: '2026-10-13' }, { signal });
  await expect(getHumanResourcesQualificationHistory('cycle-id', { signal })).rejects.toMatchObject({ status: 401 });
  expect(history).toHaveBeenCalledWith('cycle-id', { signal });
  expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});
