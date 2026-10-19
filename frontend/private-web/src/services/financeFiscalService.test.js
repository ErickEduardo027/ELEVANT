import { beforeEach, describe, expect, it, vi } from 'vitest';
import { commercialApi } from './commercialGovernanceApi';
import { createFiscalCommand, createFiscalDocument, fiscalError, getFiscalDocument, getFiscalStatus,
  listFiscalDocuments, simulateFiscalDocument } from './financeFiscalService';
vi.mock('./commercialGovernanceApi', () => ({ commercialApi: vi.fn() }));
beforeEach(() => vi.clearAllMocks());
describe('fiscal backend contract', () => {
  it('uses the fiscal document routes and exact concurrency DTO', async () => {
    commercialApi.mockResolvedValue({});
    await getFiscalStatus(); await listFiscalDocuments({ stationId: 'PUJ', take: 25 });
    await getFiscalDocument('doc');
    await createFiscalDocument({ requestId: 'request', invoiceId: 'invoice', outcome: 'Pending' });
    await simulateFiscalDocument('doc', { requestId: 'dispatch', expectedVersion: 'version' });
    expect(commercialApi.mock.calls).toEqual([
      ['/finance/fiscal-documents/status'], ['/finance/fiscal-documents?stationId=PUJ&take=25'], ['/finance/fiscal-documents/doc'],
      ['/finance/fiscal-documents', { method: 'POST', body: JSON.stringify({ requestId: 'request', invoiceId: 'invoice', outcome: 'Pending' }) }],
      ['/finance/fiscal-documents/doc/simulate', { method: 'POST', body: JSON.stringify({ requestId: 'dispatch', expectedVersion: 'version' }) }],
    ]);
  });
  it('retains the same request and payload after a lost response', async () => {
    const command = createFiscalCommand(); const send = vi.fn().mockRejectedValueOnce(new Error('network')).mockResolvedValue({ documentId: 'doc' });
    await expect(command('create', { invoiceId: 'invoice', outcome: 'Timeout' }, send)).rejects.toThrow();
    await command('create', { invoiceId: 'invoice', outcome: 'Timeout' }, send);
    expect(send.mock.calls[0][0]).toEqual(send.mock.calls[1][0]);
    expect(send.mock.calls[0][0].requestId).toMatch(/^[a-f0-9-]{36}$/i);
  });
  it('does not expose exception details and distinguishes unknown/archive conflicts', () => {
    expect(fiscalError(Object.assign(new Error('SQL private detail'), { status: 409 }))).toContain('Actualizar');
    expect(fiscalError(Object.assign(new Error('S3 private detail'), { status: 503 }))).toContain('archivo');
    expect(fiscalError(new Error('Private detail'))).not.toContain('Private detail');
  });
});
