import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { handleUnauthorizedResponse, readSession } from '../features/auth/authService';

vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

const stationId = '10000000-0000-7000-8000-000000000001';
const home = {
  stationId, businessDate: '2026-10-31',
  toInvoice: { operations: 3, airlines: 2, oldestOperationDate: '2026-10-02' },
  invoicedThisMonth: [{ currencyCode: 'USD', count: 2, amount: 236 }],
  receivables: [{ currencyCode: 'USD', openInvoices: 2, open: 236, overdueInvoices: 1, overdue: 118 }],
  cardCollectionsThisMonth: [{ currencyCode: 'DOP', count: 1, amount: 5900 }],
  pendingContractApprovals: 1,
  chartersAwaitingPrepayment: null,
};

function reply(status, body) {
  return new Response(JSON.stringify(body), { status,
    headers: { 'content-type': status >= 400 ? 'application/problem+json' : 'application/json' } });
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.test');
  vi.mocked(readSession).mockReturnValue({ token: 'finance-token' });
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

it('reads «Inicio» from the one server read, never from preinvoices or approved services (4-A, 4-N02)', async () => {
  const sent = [];
  const fetch = vi.fn(async (url, init) => {
    // The client clears the token from its headers once the request is sent: read it while it is in flight.
    sent.push({ url: String(url), authorization: new Headers(init.headers).get('authorization') });
    return reply(200, home);
  });
  vi.stubGlobal('fetch', fetch);
  const { getFinanceHomeSnapshot, isEmptyFinanceHome } = await import('./financeHomeService');
  const snapshot = await getFinanceHomeSnapshot({ stationId });
  expect(fetch).toHaveBeenCalledOnce();
  expect(sent).toEqual([{ url: `https://api.example.test/api/v1/finance/home?stationId=${stationId}`,
    authorization: 'Bearer finance-token' }]);
  expect(snapshot).toEqual({
    businessDate: '2026-10-31', toInvoice: home.toInvoice, invoicedThisMonth: home.invoicedThisMonth,
    receivables: home.receivables, cardCollectionsThisMonth: home.cardCollectionsThisMonth,
    pendingContractApprovals: 1, chartersAwaitingPrepayment: null,
  });
  expect(isEmptyFinanceHome(snapshot)).toBe(false);
  expect(isEmptyFinanceHome({ toInvoice: null, invoicedThisMonth: null, receivables: null,
    cardCollectionsThisMonth: null, pendingContractApprovals: null, chartersAwaitingPrepayment: null })).toBe(true);
});

it('keeps the status and code of a refusal and renews the session on 401', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(403, { status: 403, title: 'The Finance home is forbidden in this station.',
    code: 'forbidden' })));
  const { getFinanceHomeSnapshot } = await import('./financeHomeService');
  await expect(getFinanceHomeSnapshot({ stationId })).rejects.toMatchObject({ status: 403, code: 'forbidden' });
  expect(handleUnauthorizedResponse).not.toHaveBeenCalled();

  vi.stubGlobal('fetch', vi.fn(async () => reply(401, { status: 401, title: 'Authentication failed.' })));
  await expect(getFinanceHomeSnapshot({ stationId })).rejects.toMatchObject({ status: 401 });
  expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
});

it('fails closed on a response that is not the published contract', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => reply(200, { ...home, preinvoices: 4 })));
  const { getFinanceHomeSnapshot } = await import('./financeHomeService');
  await expect(getFinanceHomeSnapshot({ stationId })).rejects.toMatchObject({ kind: 'malformed-response' });
});
