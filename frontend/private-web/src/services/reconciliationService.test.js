import { beforeEach, expect, it, vi } from 'vitest';
import { getFinanceReconciliation } from './reconciliationService';
import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { readSession } from '../features/auth/authService';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn() }));

beforeEach(() => {
  vi.mocked(readSession).mockReturnValue({ token: 'finance-token' });
});

it('passes station scope and cancellation through the shared client', async () => {
  const data = { stationId: 'station-one', page: 1, limit: 20,
    hasMore: false, rows: [] };
  const list = vi.fn().mockResolvedValue(data);
  vi.mocked(createPrivateWebApiClient).mockReturnValue({
    getFinanceReconciliation: list,
  });
  const controller = new AbortController();
  await expect(getFinanceReconciliation({ stationId: 'station-one',
    page: 1, limit: 20 }, { signal: controller.signal })).resolves.toBe(data);
  expect(list).toHaveBeenCalledWith({ stationId: 'station-one', page: 1,
    limit: 20 }, { signal: controller.signal });
});