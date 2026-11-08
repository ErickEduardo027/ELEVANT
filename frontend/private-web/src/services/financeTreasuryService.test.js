import { beforeEach, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { applyTreasuryReceipt, getTreasuryReceipt, getTreasuryStatement, issueTreasuryAdjustment,
    listTreasuryReceipts, parseTreasuryAmount, recordTreasuryReceipt, refundTreasuryReceipt, reverseTreasuryReceipt,
    treasuryError, treasuryIntent, treasuryToday } from './financeTreasuryService';
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
it('dates by the business day of Santo Domingo and explains the dates the server refuses (4-N10)', () => {
    // 23:00 in Santo Domingo is already the next UTC day.
    expect(treasuryToday(new Date('2026-11-06T03:00:00Z'))).toBe('2026-11-05');
    expect(treasuryToday(new Date('2026-11-06T04:30:00Z'))).toBe('2026-11-06');
    const problem = (status, code) => Object.assign(new Error('Conflict'), { status, code });
    expect(treasuryError(problem(400, 'effective_before_invoice'))).toMatch(/anterior al día de emisión de la factura/);
    expect(treasuryError(problem(400, 'effective_before_receipt'))).toMatch(/anterior a la fecha en que se recibió el cobro/);
    expect(treasuryError(problem(409, 'treasury_conflict'))).toMatch(/Recargue el documento/);
    expect(treasuryError(problem(409))).toMatch(/Recargue el documento/);
    expect(treasuryError(problem(404))).toBe('El documento no está disponible en su estación o aerolínea.');
    expect(treasuryError(problem(401, 'effective_before_invoice'))).toBe('La sesión expiró. Vuelva a iniciar sesión.');
    // A failure without an answer is explained in Spanish, never with the text of the exception.
    expect(treasuryError(new TypeError('Failed to fetch'))).toBe('No se pudo completar la acción. Revise la conexión e intente de nuevo.');
});
it('keeps a request id for the exact payload across retries and replaces it when the payload changes', () => {
    const payload = { expectedVersion: 'v1', amount: 300, reason: 'Partial payment' };
    const first = treasuryIntent(null, payload);
    expect(treasuryIntent(first, payload)).toBe(first);
    expect(treasuryIntent(first, { ...payload, amount: 301 }).body.requestId).not.toBe(first.body.requestId);
    expect(first.body.amount).toBe(300);
});
