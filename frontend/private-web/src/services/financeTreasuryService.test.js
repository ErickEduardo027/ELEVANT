import { beforeEach, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { adjustmentNoteTitle, applyTreasuryReceipt, downloadAdjustmentNoteDocument, getTreasuryReceipt, getTreasuryStatement,
    isFiscalNoteNumber, issueTreasuryAdjustment, listTreasuryReceipts, noteDocumentError, parseTreasuryAmount, recordTreasuryReceipt,
    refundTreasuryReceipt, reverseTreasuryReceipt, treasuryError, treasuryIntent, treasuryToday } from './financeTreasuryService';
vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
const noteApi = vi.hoisted(() => ({ getFinanceAdjustmentNoteDocument: vi.fn(), unauthorized: vi.fn() }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => noteApi }));
vi.mock('../features/auth/authService', () => ({ readSession: () => ({ token: 'synthetic-token' }),
    handleUnauthorizedResponse: noteApi.unauthorized }));
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
    // 4-N09: a card receipt of the portal is corrected with a credit note, never reversed.
    expect(treasuryError(problem(409, 'card_payment_not_reversible'))).toMatch(/Los cobros con tarjeta no se revierten.*nota de crédito/);
    expect(treasuryError(problem(409, 'idempotency_conflict'))).toMatch(/ya se usó con otros datos/);
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

it('names a note by its e-NCF E34/E33 and keeps the internal number of the others (4-N17)', () => {
    expect(isFiscalNoteNumber('E340000000001')).toBe(true);
    expect(isFiscalNoteNumber('E330000000012')).toBe(true);
    for (const value of ['E310000000001', 'TC-QA', 'E34000000001', '', null]) expect(isFiscalNoteNumber(value)).toBe(false);
    expect(adjustmentNoteTitle({ kind: 'Credit', number: 'E340000000001' })).toBe('Nota de crédito electrónica E340000000001');
    expect(adjustmentNoteTitle({ kind: 'Debit', number: 'E330000000001' })).toBe('Nota de débito electrónica E330000000001');
    expect(adjustmentNoteTitle({ kind: 'Credit', number: 'TC-0001' })).toBe('Nota de crédito TC-0001');
});
it('downloads a note PDF with the session token and explains a failure by its code (4-N17)', async () => {
    const createObjectURL = vi.fn(() => 'blob:note');
    Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() });
    noteApi.getFinanceAdjustmentNoteDocument.mockResolvedValueOnce(new Blob(['%PDF-1.7'], { type: 'application/pdf' }));
    await downloadAdjustmentNoteDocument('n-34', 'nota-E340000000001.pdf');
    expect(noteApi.getFinanceAdjustmentNoteDocument).toHaveBeenCalledWith('n-34', { cache: 'no-store' });
    expect(createObjectURL).toHaveBeenCalled();
    const expired = Object.assign(new Error('Unauthorized'), { status: 401 });
    noteApi.getFinanceAdjustmentNoteDocument.mockRejectedValueOnce(expired);
    await expect(downloadAdjustmentNoteDocument('n-34', 'nota.pdf')).rejects.toBe(expired);
    expect(noteApi.unauthorized).toHaveBeenCalledWith({ status: 401 });
    expect(noteDocumentError({ status: 404, code: 'not_found' })).toBe('El documento no está disponible en su estación o aerolínea.');
    expect(noteDocumentError({ status: 403 })).toBe('No tiene permiso para descargar las notas de ajuste de esta estación.');
    expect(noteDocumentError(new TypeError('Failed to fetch'))).toBe('No se pudo descargar el PDF de la nota. Intente de nuevo.');
});
