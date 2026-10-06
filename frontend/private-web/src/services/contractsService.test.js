import { describe, expect, it } from 'vitest';
import { resolveContractStatus } from './contractsService';

describe('resolveContractStatus', () => {
  const referenceDate = new Date('2026-08-10T12:00:00');

  it('derives status from the validity date', () => {
    expect(resolveContractStatus({ endDate: '2027-01-01' }, referenceDate)).toBe('active');
    expect(resolveContractStatus({ endDate: '2026-08-30' }, referenceDate)).toBe('expiring');
    expect(resolveContractStatus({ endDate: '2026-08-01' }, referenceDate)).toBe('expired');
  });

  it('keeps a manually disabled contract disabled', () => {
    expect(resolveContractStatus({ endDate: '2027-01-01', statusOverride: 'disabled' }, referenceDate)).toBe('disabled');
  });
});