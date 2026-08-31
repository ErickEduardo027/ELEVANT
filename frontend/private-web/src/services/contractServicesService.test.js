import { afterEach, describe, expect, it } from 'vitest';
import { __resetContractServicesStoreForTests, createContractService, getContractServices, updateContractService } from './contractServicesService';

afterEach(() => __resetContractServicesStoreForTests());

describe('contractServicesService', () => {
  it('creates a service associated with a contract', async () => {
    const created = await createContractService({ contractId: 'CTR-2026-018', airline: 'Arajet', name: 'Remolque', rate: 350, currency: 'USD', billingUnit: 'Por operación', startDate: '2026-08-10', endDate: '2027-02-28' });
    expect(created.contractId).toBe('CTR-2026-018');
    expect((await getContractServices())[0].name).toBe('Remolque');
  });

  it('updates future tariff data and status', async () => {
    const updated = await updateContractService('SRV-001', { rate: 500, currency: 'USD', billingUnit: 'Por operación', endDate: '2027-02-28', active: false });
    expect(updated.rate).toBe(500);
    expect(updated.active).toBe(false);
  });
});
