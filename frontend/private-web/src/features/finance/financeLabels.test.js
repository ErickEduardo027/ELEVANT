import { describe, expect, it } from 'vitest';
import { invoiceLabel, packageScopeLabel, statusMeta, TARIFF_VERSION_STATUS } from './financeLabels';

describe('Finance labels', () => {
  it('names an invoice by its e-NCF and falls back to its internal number (4-N19)', () => {
    expect(invoiceLabel({ fiscalNumber: 'E310000000017', number: 'NF-0193f4c2a1b24c5d9e8f7a6b5c4d3e2f' }))
      .toBe('E310000000017');
    expect(invoiceLabel({ fiscalNumber: null, number: 'NF-0193f4c2a1b24c5d9e8f7a6b5c4d3e2f' })).toBe('NF-0193f4c2a1b2…');
    expect(invoiceLabel({ number: 'NF-SHORT' })).toBe('NF-SHORT');
    expect(invoiceLabel(null)).toBe('');
  });

  it('never shows a status or a scope code raw', () => {
    expect(statusMeta(TARIFF_VERSION_STATUS, 'Published').label).toBe('Vigente');
    expect(statusMeta(TARIFF_VERSION_STATUS, 'Unknown').label).toBe('Estado no reconocido');
    expect(packageScopeLabel('Flight')).toBe('Por vuelo');
    expect(packageScopeLabel('Other')).toBe('Alcance no reconocido');
  });
});
