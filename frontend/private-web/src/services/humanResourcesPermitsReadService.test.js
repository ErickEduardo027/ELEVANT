import { expect, it, vi } from 'vitest';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';
import { getHumanResourcesPermitHistory, getHumanResourcesPermits, getHumanResourcesPermitSummary,
  recordHumanResourcesPermit } from './humanResourcesPermitsReadService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

it('uses the shared authenticated API client with paging and cancellation', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const read = vi.fn().mockResolvedValue({ page: 1, limit: 20, hasMore: false, permits: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesPermits: read });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesPermits({ page: 1, limit: 20 }, { signal }))
    .resolves.toMatchObject({ permits: [] });
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
  expect(read).toHaveBeenCalledWith({ page: 1, limit: 20 }, { signal });
});

it('records a permit through the shared authenticated client', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const record = vi.fn().mockResolvedValue({ id: '50000000-0000-7000-8000-000000000040', cycleNumber: 2 });
  createPrivateWebApiClient.mockReturnValue({ recordHumanResourcesPermit: record });
  const input = { rampProfileId: '50000000-0000-7000-8000-000000000001',
    documentType: 'AirportId', expectedCurrentId: null, documentNumber: 'DEV-NEW',
    issuedOn: '2026-01-01', expiresOn: '2099-12-31' };
  await expect(recordHumanResourcesPermit('50000000-0000-7000-8000-000000000040', input))
    .resolves.toMatchObject({ cycleNumber: 2 });
  expect(record).toHaveBeenCalledWith('50000000-0000-7000-8000-000000000040', input, {});
  expect(createPrivateWebApiClient.mock.calls[0][0].getAccessToken()).toBe('hr-token');
});
it('reads the permit summary and history through the shared client', async () => {
  readSession.mockReturnValue({ token: 'hr-token' });
  const summary = vi.fn().mockResolvedValue({ total: 2 });
  const history = vi.fn().mockResolvedValue({ cycles: [] });
  createPrivateWebApiClient.mockReturnValue({ getHumanResourcesPermitSummary: summary,
    getHumanResourcesPermitHistory: history });
  const signal = new AbortController().signal;
  await expect(getHumanResourcesPermitSummary({ documentType: 'AirportId' }, { signal }))
    .resolves.toEqual({ total: 2 });
  await expect(getHumanResourcesPermitHistory('permit-id', { signal })).resolves.toEqual({ cycles: [] });
  expect(summary).toHaveBeenCalledWith({ documentType: 'AirportId' }, { signal });
  expect(history).toHaveBeenCalledWith('permit-id', { signal });
});
