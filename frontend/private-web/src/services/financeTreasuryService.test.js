import { beforeEach, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { applyTreasuryReceipt, getTreasuryReceipt, getTreasuryStatement, issueTreasuryAdjustment,
    listTreasuryReceipts, parseTreasuryAmount, recordTreasuryReceipt, refundTreasuryReceipt, reverseTreasuryReceipt,
    treasuryIntent } from './financeTreasuryService';
vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
it('uses real treasury routes and passes scoped filters and cancellation', async () => {
    const signal = new AbortController().signal;
    await listTreasuryReceipts({ stationId: 's-1', airlineId: 'a-1', page: 2 }, { signal });
    expect(commercialApi).toHaveBeenCalledWith('/finance/receipts?page=2&limit=25&stationId=s-1&airlineId=a-1', expect.objectContaining({ signal, cache: 'no-store' }));
    await getTreasuryReceipt('r-1', { signal });
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/receipts/r-1', expect.objectContaining({ signal }));
    await getTreasuryStatement({ asOf: '2026-10-18', stationId: 's-1', airlineId: 'a-1' }, { signal });
    expect(commercialApi).toHaveBeenLastCalledWith('/finance/statements?asOf=2026-10-18&stationId=s-1&airlineId=a-1', expect.objectContaining({ signal }));
});
it('posts immutable intents with expected versions to each separate command', async () => {
    const input = { requestId: 'uuid', expectedVersion: 'v1', amount: 300, reason: 'Customer refund' };
    for (const [call, endpoint] of [[recordTreasuryReceipt, '/finance/receipts'],
        [values => applyTreasuryReceipt('r-1', values), '/finance/receipts/r-1/applications'],
        [values => reverseTreasuryReceipt('r-1', values), '/finance/receipts/r-1/reversals'],
        [values => refundTreasuryReceipt('r-1', values), '/finance/receipts/r-1/refunds'],
        [values => issueTreasuryAdjustment('i-1', values), '/finance/invoices/i-1/adjustment-notes']]) {
        await call(input);
        expect(commercialApi).toHaveBeenLastCalledWith(endpoint, expect.objectContaining({ method: 'POST', body: JSON.stringify(input) }));
    }
});
it('parses typed amounts without rounding user input or silently treating blank as zero', () => {
    expect(parseTreasuryAmount('300.1250')).toBe(300.125);
    for (const value of ['', '1e3', '10,50', '-1', '0', '1.00001', 'Infinity', 'NaN']) expect(() => parseTreasuryAmount(value)).toThrow();
    expect(parseTreasuryAmount('0', { allowZero: true })).toBe(0);
});
it('keeps a request id for the exact payload across retries and replaces it when the payload changes', () => {
    const payload = { expectedVersion: 'v1', amount: 300, reason: 'Partial payment' };
    const first = treasuryIntent(null, payload);
    expect(treasuryIntent(first, payload)).toBe(first);
    expect(treasuryIntent(first, { ...payload, amount: 301 }).body.requestId).not.toBe(first.body.requestId);
    expect(first.body.amount).toBe(300);
});
