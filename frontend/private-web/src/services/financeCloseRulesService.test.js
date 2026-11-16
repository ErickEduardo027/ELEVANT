import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { getFinanceCloseRules: vi.fn(), setGroundTimeAllowance: vi.fn(), addFinanceHoliday: vi.fn(), removeFinanceHoliday: vi.fn() };
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => ({ token: 't' }) }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

import { addHoliday, loadCloseRules, saveGroundTime } from './financeCloseRulesService';
import { sundayWeek } from '../features/finance/invoicing/weeks';

describe('finance close rules (ADR-0034)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('sends the version read and explains conflicts and invalid input', async () => {
    api.setGroundTimeAllowance.mockResolvedValue({});
    await saveGroundTime('Narrowbody', 80, 'abc');
    expect(api.setGroundTimeAllowance).toHaveBeenCalledWith('Narrowbody', { allowedMinutes: 80, version: 'abc' });
    api.addFinanceHoliday.mockRejectedValue({ status: 409 });
    await expect(addHoliday('2026-11-06', 'Otro')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya tiene otro festivo/) });
    api.getFinanceCloseRules.mockRejectedValue(new TypeError('x'));
    await expect(loadCloseRules()).rejects.toMatchObject({ status: 400 });
  });

  it('builds the Sunday-to-Saturday week Finance reviews', () => {
    expect(sundayWeek('2026-11-05')).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(sundayWeek('2026-11-01')).toEqual({ from: '2026-11-01', to: '2026-11-07' });
    expect(sundayWeek('2026-11-07', -1)).toEqual({ from: '2026-10-25', to: '2026-10-31' });
    expect(sundayWeek('2026-01-02', -1)).toEqual({ from: '2025-12-21', to: '2025-12-27' });
  });
});
