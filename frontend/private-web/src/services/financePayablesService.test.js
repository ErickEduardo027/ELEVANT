import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { applyPayablePayment, savePayable, decideEmployeeExpense, payablesOptions, listPayables, uploadPayablesAttachment,
  downloadPayablesAttachment, removePayablesAttachment, reversePayablePayment } from './financePayablesService';
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
  it.each([
    ['an upload', () => uploadPayablesAttachment('payables', 'bill', { requestId: 'stable', expectedVersion: 'v1',
      file: new File(['%PDF-1.7'], 'receipt.pdf', { type: 'application/pdf' }) }), 400, 'attachment_limit'],
    ['a download', () => downloadPayablesAttachment('expenses', 'claim', 'receipt'), 503, 'unavailable'],
  ])('propagates the Problem Details code of %s without its title (4-N27)', async (_name, send, status, code) => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.invalid');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status,
      json: async () => ({ title: 'Private server title', code }) }));
    try {
      const failure = await send().catch(error => error);
      expect(failure).toMatchObject({ status, code });
      expect(failure.message).not.toContain('Private');
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('keeps a refusal without a JSON body as a plain status', async () => {
    vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.invalid');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: false, status: 502, json: async () => { throw new Error('html'); } }));
    try {
      expect(await downloadPayablesAttachment('payables', 'bill', 'receipt').catch(error => error))
        .toMatchObject({ status: 502, code: undefined });
    } finally { vi.unstubAllGlobals(); vi.unstubAllEnvs(); }
  });
  it('reverses one application or voids the payment through its reversals (4-N04)', async () => {
    const body = { requestId: 'stable', expectedVersion: 'payment-v2', reason: 'Aplicado a la factura equivocada', applicationId: 'application' };
    await reversePayablePayment('payment', body);
    expect(commercialApi).toHaveBeenCalledWith('/finance/payable-payments/payment/reversals', { method: 'POST', body: JSON.stringify(body) });
  });
  it('removes a draft receipt through its removals, never with DELETE (4-N13)', async () => {
    const body = { requestId: 'stable', expectedVersion: 'claim-v3' };
    await removePayablesAttachment('expenses', 'claim', 'receipt', body);
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/expenses/claim/attachments/receipt/removals', { method: 'POST', body: JSON.stringify(body) });
    await removePayablesAttachment('payables', 'bill', 'file', body);
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/payables/bill/attachments/file/removals', { method: 'POST', body: JSON.stringify(body) });
    expect(() => removePayablesAttachment('suppliers', 'supplier', 'file', body)).toThrow();
    expect(() => removePayablesAttachment('../governance', 'x', 'y', body)).toThrow();
  });
});
