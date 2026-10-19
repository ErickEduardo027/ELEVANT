import { describe, expect, it, vi } from 'vitest';
import { createTaxCommand, financeTaxError } from './financeTaxService';

describe('finance tax commands', () => {
  it('reuses uncertain writes and changes identity when payload changes', async () => {
    const run = createTaxCommand(); const send = vi.fn().mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue({ id: 'p' });
    await expect(run('create', { rate: 0 }, send)).rejects.toThrow(); await run('create', { rate: 0 }, send);
    expect(send.mock.calls[1][0]).toEqual(send.mock.calls[0][0]);
    await run('create', { rate: 1 }, send); expect(send.mock.calls[2][0].requestId).not.toBe(send.mock.calls[0][0].requestId);
  });
  it('never exposes exception text and describes ambiguity', () => {
    expect(financeTaxError({ code: 'ambiguous_tax_policy', message: 'Private SQL' })).toMatch(/más de una política/);
    expect(financeTaxError({ status: 500, message: 'Private SQL' })).not.toContain('Private SQL');
  });
});
