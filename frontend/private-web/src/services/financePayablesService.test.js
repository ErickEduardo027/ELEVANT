import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { applyPayablePayment, savePayable, decideEmployeeExpense, payablesOptions, listPayables, uploadPayablesAttachment } from './financePayablesService';
vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: () => ({ token: 'synthetic-token' }), handleUnauthorizedResponse: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe('Finance payables contract adapter', () => {
  it('posts applications separately with per-invoice versions and frozen FX', async () => {
    const body = { requestId: 'request', expectedVersion: 'payment-v1', applications: [{ invoiceId: 'invoice', expectedVersion: 'invoice-v1', paymentAmount: 300, rateToInvoice: 1 }] };
    await applyPayablePayment('payment', body);
    expect(commercialApi).toHaveBeenCalledWith('/finance/payable-payments/payment/applications', { method: 'POST', body: JSON.stringify(body) });
  });
  it('uses scoped filters and public DTO property names without role input', async () => {
    await listPayables({ scopeStationId: 'station', outstandingOnly: true, search: 'SUP & 1' });
    expect(commercialApi.mock.calls[0][0]).toContain('scopeStationId=station');
    expect(commercialApi.mock.calls[0][0]).toContain('search=SUP+%26+1');
    const body = { requestId: 'stable', expectedVersion: 'v1', fx: { currency: 'USD', rateToDop: 60, source: 'Approved', rateDate: '2026-10-18' } };
    await savePayable('bill', body);
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/payables/bill', { method: 'PUT', body: JSON.stringify(body) });
  });
  it('uses the two-stage expense decision contract', async () => {
    const body = { requestId: 'stable', expectedVersion: 'v2', decision: 'DepartmentApproved', reason: null };
    await decideEmployeeExpense('claim', body);
    expect(commercialApi).toHaveBeenCalledWith('/finance/expenses/claim/decisions', { method: 'POST', body: JSON.stringify(body) });
    await payablesOptions('expenses', 'station');
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/expenses/options?scopeStationId=station', { cache: 'no-store' });
  });
  it('uploads receipts through the protected document endpoint with browser multipart boundaries', async () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.invalid/');
    const fetcher = vi.fn().mockResolvedValue({ ok: true, status: 200, json: async () => ({ id: 'attachment' }) });
    vi.stubGlobal('fetch', fetcher);
    try {
      const file = new File(['%PDF-1.7 synthetic'], 'receipt.pdf', { type: 'application/pdf' });
      await uploadPayablesAttachment('expenses', 'claim', { requestId: 'stable', expectedVersion: 'v1', file });
      expect(fetcher.mock.calls[0][0]).toBe('https://api.example.invalid/api/v1/finance/expenses/claim/attachments');
      const request = fetcher.mock.calls[0][1];
      expect(request.headers).toEqual({ Authorization: 'Bearer synthetic-token' });
      expect(request.body.get('requestId')).toBe('stable'); expect(request.body.get('expectedVersion')).toBe('v1');
      expect(request.body.has('objectKey')).toBe(false); expect(request.cache).toBe('no-store');
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
});
