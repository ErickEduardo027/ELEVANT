import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = { getFinanceCharters: vi.fn(), confirmFinanceCharterPrepayment: vi.fn() };
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => ({ token: 't' }) }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

import { confirmCharterPrepayment, listFinanceCharters } from './financeChartersService';

describe('finance charters (ADR-0033)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('lists the charters and sends the prepayment as typed', async () => {
    api.getFinanceCharters.mockResolvedValue({ charters: [{ id: 'c1' }] });
    await expect(listFinanceCharters()).resolves.toEqual([{ id: 'c1' }]);
    api.confirmFinanceCharterPrepayment.mockResolvedValue({ id: 'c1' });
    await confirmCharterPrepayment('c1', 260, 'TRF-1');
    expect(api.confirmFinanceCharterPrepayment).toHaveBeenCalledWith('c1', { amount: 260, reference: 'TRF-1' });
  });

  it('explains conflicts and invalid input without raw errors', async () => {
    api.confirmFinanceCharterPrepayment.mockRejectedValue({ status: 409, detail: 'raw' });
    await expect(confirmCharterPrepayment('c1', 1, 'x1')).rejects.toMatchObject({ status: 409, message: expect.stringMatching(/ya tiene otro prepago/) });
    api.confirmFinanceCharterPrepayment.mockRejectedValue(new TypeError('The prepayment is invalid.'));
    await expect(confirmCharterPrepayment('c1', 0, '')).rejects.toMatchObject({ status: 400 });
    api.getFinanceCharters.mockRejectedValue({ status: 403 });
    await expect(listFinanceCharters()).rejects.toMatchObject({ message: expect.stringMatching(/no incluye/) });
  });
});
