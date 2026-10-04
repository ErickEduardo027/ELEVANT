import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { getHumanResourcesQualifications, getHumanResourcesQualificationEquipmentTypes,
  recordHumanResourcesQualification } from './humanResourcesQualificationsReadService';

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