import { afterEach, describe, expect, it } from 'vitest';
import { approvePreinvoice, createPreinvoice, getPreinvoices, resetPreinvoicesForTests, sendPreinvoice } from './preinvoiceService';
afterEach(resetPreinvoicesForTests);
describe('preinvoiceService', () => {
  it('creates a saved draft', async () => { expect((await createPreinvoice({ airline: 'JetBlue', period: 'Agosto 2026' })).status).toBe('draft'); });
  it('only sends an approved preinvoice', async () => { await approvePreinvoice('PRE-2026-082'); expect((await sendPreinvoice('PRE-2026-082')).status).toBe('sent'); expect((await getPreinvoices())[0]).toBeTruthy(); });
});
