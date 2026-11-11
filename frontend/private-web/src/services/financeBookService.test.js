import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { readSession } from '../features/auth/authService';

vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

const KEY = 'a0000000-0000-7000-8000-0000000000f1';
const ID = '70000000-0000-7000-8000-0000000000f1';

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.test');
  readSession.mockReturnValue({ token: 'finance-token' });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async () => new Response(JSON.stringify({ id: ID }),
    { status: 200, headers: { 'content-type': 'application/json' } })));
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

const sent = () => fetch.mock.calls.map(([url, init]) => ({
  url: String(url), method: init.method, key: new Headers(init.headers).get('idempotency-key'),
  body: init.body ? JSON.parse(init.body) : undefined,
}));

it('sends the Idempotency-Key of every tariff book command with its body and expected version (1-E)', async () => {
  const book = await import('./financeBookService');
  const tariff = { validFrom: '2027-01-01', validTo: null, note: null, rates: [], expectedVersion: 'AAA=' };
  await book.saveBillingUnit(null, { code: 'gallon' }, KEY);
  await book.saveBillingUnit(ID, { code: 'gallon', expectedVersion: 'AAA=' }, KEY);
  await book.createServiceTariffDraft({ currencyCode: 'USD' }, KEY);
  await book.saveServiceTariffDraft(ID, tariff, KEY);
  await book.publishServiceTariff(ID, 'AAA=', KEY);
  await book.deleteServiceTariffDraft(ID, 'AAA=', KEY);
  await book.saveCharge(null, { code: 'NIGHT' }, KEY);
  await book.saveCharge(ID, { code: 'NIGHT', expectedVersion: 'AAA=' }, KEY);
  await book.createChargeTariffDraft({ currencyCode: 'USD' }, KEY);
  await book.saveChargeTariffDraft(ID, tariff, KEY);
  await book.publishChargeTariff(ID, 'AAA=', KEY);
  await book.deleteChargeTariffDraft(ID, 'AAA=', KEY);
  await book.recordExchangeRate({ rateDate: '2026-11-02', rate: 59.1 }, KEY);
  await book.correctExchangeRate(ID, { rate: 59.2, expectedVersion: 'AAA=' }, KEY);
  await book.decideContractApproval(ID, { decision: 'Approved', expectedVersion: 'AAA=' }, KEY);
  const api = 'https://api.example.test/api/v1/finance';
  expect(sent().map(({ url, method }) => `${method} ${url.replace(api, '')}`)).toEqual([
    'POST /billing-units', `PUT /billing-units/${ID}`, 'POST /service-tariffs', `PUT /service-tariffs/${ID}`,
    `POST /service-tariffs/${ID}/publish`, `DELETE /service-tariffs/${ID}?expectedVersion=AAA%3D`, 'POST /charges',
    `PUT /charges/${ID}`, 'POST /charge-tariffs', `PUT /charge-tariffs/${ID}`, `POST /charge-tariffs/${ID}/publish`,
    `DELETE /charge-tariffs/${ID}?expectedVersion=AAA%3D`, 'POST /exchange-rates', `POST /exchange-rates/${ID}/correction`,
    `POST /contract-approvals/${ID}/decision`,
  ]);
  expect(sent().every(request => request.key === KEY)).toBe(true);
  expect(sent()[4].body).toEqual({ expectedVersion: 'AAA=' });
  // The key goes next to the session and the JSON content type, never instead of them.
  const headers = new Headers(fetch.mock.calls[0][1].headers);
  expect([headers.get('authorization'), headers.get('content-type')]).toEqual(['Bearer finance-token', 'application/json']);
});

it('still sends a command without a key, as older screens did (expand)', async () => {
  const book = await import('./financeBookService');
  await book.publishServiceTariff(ID, 'AAA=');
  await book.deleteChargeTariffDraft(ID, 'AAA=');
  expect(sent().map(request => request.key)).toEqual([null, null]);
});

it('asks «Facturas» for pages of 25 with the search, and only for the fields that are set (4-N21)', async () => {
  const book = await import('./financeBookService');
  await book.listFinanceInvoices({ stationId: 'st-1', status: '', search: 'E3100', page: 2 });
  await book.listFinanceInvoices();
  expect(sent().map(request => request.url)).toEqual([
    'https://api.example.test/api/v1/finance/invoices?page=2&limit=25&stationId=st-1&search=E3100',
    'https://api.example.test/api/v1/finance/invoices?page=1&limit=25',
  ]);
  expect(book.INVOICE_PAGE_SIZE).toBe(25);
});

it('keeps the Problem Details code of a refused report export', async () => {
  const book = await import('./financeBookService');
  fetch.mockImplementationOnce(async () => new Response(JSON.stringify({ title: 'Unknown export format.', code: 'invalid_report_export_format' }),
    { status: 400, headers: { 'content-type': 'application/problem+json' } }));
  await expect(book.downloadFinanceReport('sales', 'docx', { from: '2026-11-01', to: '2026-11-08' }))
    .rejects.toMatchObject({ status: 400, code: 'invalid_report_export_format', message: 'No se pudo generar la exportación.' });
  fetch.mockImplementationOnce(async () => new Response('not json', { status: 500 }));
  await expect(book.downloadFinanceReport('sales', 'csv', { from: '2026-11-01', to: '2026-11-08' }))
    .rejects.toMatchObject({ status: 500, code: undefined });
});

it('no longer offers the retired preinvoice edits nor the legacy payment and credit note (4-A, 4-N12)', async () => {
  const book = await import('./financeBookService');
  for (const retired of ['editPreinvoiceLine', 'addPreinvoiceAdjustment', 'issueCreditNote', 'recordPartialPayment'])
    expect(book).not.toHaveProperty(retired);
});
