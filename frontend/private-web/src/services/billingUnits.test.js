import { describe, expect, it } from 'vitest';
import { billingUnitCode, billingUnitLabel, proposedBillingUnit } from './billingUnits';

const units = [{ code: 'operation', name: 'Operación', isActive: true }, { code: 'hour', name: 'Hora', isActive: true },
  { code: 'old', name: 'Antigua', isActive: false }];

describe('billing unit codes (1-E)', () => {
  it('maps a code or a legacy name, in any casing and with or without accents, to an active code', () => {
    expect(['operation', 'OPERATION', 'operación', 'Operacion', ' Hora '].map(value => billingUnitCode(value, units)))
      .toEqual(['operation', 'operation', 'operation', 'operation', 'hour']);
    expect(billingUnitCode('old', units)).toBeNull();
    expect(billingUnitCode('Antigua', units)).toBeNull();
    expect(billingUnitCode('turno', units)).toBeNull();
    expect(billingUnitCode('', units)).toBeNull();
    expect(billingUnitCode('operation')).toBeNull();
  });

  it('proposes the service unit only when it names an active unit, otherwise the first active one', () => {
    expect(proposedBillingUnit('operación', units)).toBe('operation');
    expect(proposedBillingUnit('hour', units)).toBe('hour');
    expect(proposedBillingUnit('turno', units)).toBe('operation');
    expect(proposedBillingUnit(null, [units[2], units[1]])).toBe('hour');
    expect(proposedBillingUnit('operación', [])).toBe('');
  });

  it('names a unit in Spanish for «Por …» texts, with or without the unit list', () => {
    expect(billingUnitLabel('operation')).toBe('operación');
    expect(billingUnitLabel('ton')).toBe('tonelada');
    expect(billingUnitLabel('hour', units)).toBe('hora');
    expect(billingUnitLabel('old', units)).toBe('antigua');
    expect(billingUnitLabel('operación', units)).toBe('operación');
    expect(billingUnitLabel('turno')).toBe('turno');
    expect(billingUnitLabel(null)).toBe('');
  });
});
