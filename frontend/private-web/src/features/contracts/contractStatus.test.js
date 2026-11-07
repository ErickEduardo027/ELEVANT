import { describe, expect, it } from 'vitest';
import { CONTRACT_STATUS, contractStatusLabel, contractStatusTone } from './contractStatus';

describe('contract status labels (2-N26)', () => {
  it('labels every status in Spanish and keeps an unknown code visible', () => {
    expect(Object.keys(CONTRACT_STATUS)).toEqual(['Draft', 'Active', 'Suspended', 'Terminated', 'Expired']);
    expect(contractStatusLabel('Active')).toBe('Activo');
    expect(contractStatusLabel('Expired')).toBe('Vencido');
    expect(contractStatusLabel('Draft')).toBe('Pendiente de firmas y permiso');
    expect(contractStatusLabel('Paused')).toBe('Paused');
    expect(contractStatusTone('Suspended')).toBe('danger');
    expect(contractStatusTone('Paused')).toBe('neutral');
  });
});
