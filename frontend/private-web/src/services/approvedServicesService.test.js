import { afterEach, describe, expect, it } from 'vitest';
import { getApprovedServices, markApprovedServiceReviewed, resetApprovedServicesForTests } from './approvedServicesService';

afterEach(resetApprovedServicesForTests);

describe('approvedServicesService', () => {
  it('lists only approved operational services', async () => {
    expect((await getApprovedServices()).length).toBeGreaterThan(0);
  });
  it('marks a service as reviewed', async () => {
    const result = await markApprovedServiceReviewed('SRV-2608-041');
    expect(result.status).toBe('reviewed');
  });
});
