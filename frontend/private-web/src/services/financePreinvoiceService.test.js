import { beforeEach, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(), readSession: vi.fn(),
  handleUnauthorizedResponse: vi.fn(), getFinancePreinvoices: vi.fn(),
  submitPreinvoice: vi.fn(), issueFinanceInvoice: vi.fn(),
  resolveFinancePreinvoiceDispute: vi.fn(),
  getFinanceInvoiceByPreinvoice: vi.fn(),
  recordNonFiscalPayment: vi.fn(), getFinancePaymentByInvoice: vi.fn(),
  getFinanceInvoiceDocument: vi.fn(), getFinancePaymentReceipt: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession,
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
}));

import { getFinancePreinvoices, submitFinancePreinvoice, issueFinanceInvoice,
  getFinanceInvoiceByPreinvoice, recordNonFiscalPayment,
  getFinancePaymentByInvoice, getFinanceInvoiceDocument, getFinancePaymentReceipt,
  resolveFinancePreinvoiceDispute } from './financePreinvoiceService';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createPrivateWebApiClient.mockReturnValue({
    getFinancePreinvoices: mocks.getFinancePreinvoices,
    submitPreinvoice: mocks.submitPreinvoice,
    issueFinanceInvoice: mocks.issueFinanceInvoice,
    resolveFinancePreinvoiceDispute: mocks.resolveFinancePreinvoiceDispute,
    getFinanceInvoiceByPreinvoice: mocks.getFinanceInvoiceByPreinvoice,
    recordNonFiscalPayment: mocks.recordNonFiscalPayment,
    getFinancePaymentByInvoice: mocks.getFinancePaymentByInvoice,
    getFinanceInvoiceDocument: mocks.getFinanceInvoiceDocument,
    getFinancePaymentReceipt: mocks.getFinancePaymentReceipt,
  });
});

it('uses the authenticated station-scoped API client', async () => {
  const query = { stationId: 'station-one', page: 1, limit: 20 };
  const page = { ...query, hasMore: false, preinvoices: [] };
  mocks.getFinancePreinvoices.mockResolvedValueOnce(page);
  await expect(getFinancePreinvoices(query)).resolves.toBe(page);
  expect(mocks.getFinancePreinvoices).toHaveBeenCalledWith(query, { signal: undefined });
  expect(mocks.createPrivateWebApiClient.mock.calls[0][0].getAccessToken())
    .toBe('finance-token');
});

it('expires the local session after API authorization fails', async () => {
  mocks.getFinancePreinvoices.mockRejectedValueOnce({ status: 401 });
  await expect(getFinancePreinvoices({ stationId: 'station-one' }))
    .rejects.toEqual({ status: 401 });
  expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});

it('uses the draft identifier as a stable idempotency key across an uncertain retry', async () => {
  const id = '10000000-0000-7000-8000-000000000001';
  mocks.submitPreinvoice.mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce({ id, status: 'Submitted', replayed: true });
  await expect(submitFinancePreinvoice(id)).rejects.toThrow('network');
  await expect(submitFinancePreinvoice(id))
    .resolves.toEqual({ id, status: 'Submitted', replayed: true });
  expect(mocks.submitPreinvoice).toHaveBeenCalledTimes(2);
  expect(mocks.submitPreinvoice).toHaveBeenNthCalledWith(1, id, { requestId: id });
  expect(mocks.submitPreinvoice).toHaveBeenNthCalledWith(2, id, { requestId: id });
});

it('expires the local session when submitting returns unauthorized', async () => {
  mocks.submitPreinvoice.mockRejectedValueOnce({ status: 401 });
  await expect(submitFinancePreinvoice('10000000-0000-7000-8000-000000000001'))
    .rejects.toEqual({ status: 401 });
  expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});

it('issues and reads invoices through the bearer-scoped API client', async () => {
  const request = { preinvoiceId: '10000000-0000-7000-8000-000000000001',
    requestId: '10000000-0000-7000-8000-000000000002' };
  mocks.issueFinanceInvoice.mockResolvedValue({ number: 'NF-1' });
  mocks.getFinanceInvoiceByPreinvoice.mockResolvedValue({ number: 'NF-1' });
  await issueFinanceInvoice(request);
  await getFinanceInvoiceByPreinvoice(request.preinvoiceId);
  expect(mocks.issueFinanceInvoice).toHaveBeenCalledWith(request);
  expect(mocks.getFinanceInvoiceByPreinvoice).toHaveBeenCalledWith(
    request.preinvoiceId, { cache: 'no-store' });
  expect(mocks.createPrivateWebApiClient.mock.calls[0][0].getAccessToken())
    .toBe('finance-token');
});

it('records and reads a payment through the bearer-scoped API client', async () => {
  const request = { invoiceId: '10000000-0000-7000-8000-000000000003',
    requestId: '10000000-0000-7000-8000-000000000004', reference: 'BANK-TEST-123' };
  mocks.recordNonFiscalPayment.mockResolvedValue({ id: 'payment-one' });
  mocks.getFinancePaymentByInvoice.mockResolvedValue({ invoiceId: request.invoiceId,
    payment: null });
  await recordNonFiscalPayment(request);
  await getFinancePaymentByInvoice(request.invoiceId);
  expect(mocks.recordNonFiscalPayment).toHaveBeenCalledWith(request);
  expect(mocks.getFinancePaymentByInvoice).toHaveBeenCalledWith(
    request.invoiceId, { cache: 'no-store' });
});

it('downloads private PDFs with the current Finance bearer and no browser cache', async () => {
  const pdf = new Blob(['%PDF-1.7'], { type: 'application/pdf' });
  mocks.getFinanceInvoiceDocument.mockResolvedValueOnce(pdf);
  mocks.getFinancePaymentReceipt.mockResolvedValueOnce(pdf);
  await expect(getFinanceInvoiceDocument('10000000-0000-7000-8000-000000000001'))
    .resolves.toBe(pdf);
  await expect(getFinancePaymentReceipt('10000000-0000-7000-8000-000000000002'))
    .resolves.toBe(pdf);
  expect(mocks.getFinanceInvoiceDocument).toHaveBeenCalledWith(
    '10000000-0000-7000-8000-000000000001', { cache: 'no-store' });
  expect(mocks.getFinancePaymentReceipt).toHaveBeenCalledWith(
    '10000000-0000-7000-8000-000000000002', { cache: 'no-store' });
});

it('sends a Finance dispute decision through the bearer-scoped API client', async () => {
  const id = '10000000-0000-7000-8000-000000000001';
  const request = { requestId: '10000000-0000-7000-8000-000000000002',
    decision: 'Maintain', reason: 'Reviewed approved evidence' };
  mocks.resolveFinancePreinvoiceDispute.mockResolvedValue({ preinvoiceId: id,
    status: 'Submitted' });
  await resolveFinancePreinvoiceDispute(id, request);
  expect(mocks.resolveFinancePreinvoiceDispute).toHaveBeenCalledWith(id, request);
});