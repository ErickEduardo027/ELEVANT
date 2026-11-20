import { describe, expect, it } from 'vitest';
import { billingUnitCode, billingUnitLabel, billingUnitQuantity, proposedBillingUnit } from './billingUnits';

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

describe('a quantity with its billing unit (N21)', () => {
  it('writes a quantity in the words of the tablet, singular only for exactly one', () => {
    // es-DO writes a decimal point, as every number of AVIAM Web.
    expect([1, 2, 0.5, 0].map(quantity => billingUnitQuantity(quantity, 'hour', 'es-DO')))
      .toEqual(['1 hora', '2 horas', '0.5 horas', '0 horas']);
    expect([1, 3, 1.5, 0].map(quantity => billingUnitQuantity(quantity, 'operation', 'es-DO')))
      .toEqual(['1 operación', '3 operaciones', '1.5 operaciones', '0 operaciones']);
    expect([1, 2, 0.5, 0].map(quantity => billingUnitQuantity(quantity, 'hour', 'en-US')))
      .toEqual(['1 hour', '2 hours', '0.5 hours', '0 hours']);
    // Spanish unless the locale is English.
    expect(billingUnitQuantity(2, 'hour')).toBe('2 horas');
    expect(billingUnitQuantity(2, 'operation', 'en')).toBe('2 operations');
  });

  it('names every unit an environment starts with, in Spanish and in English', () => {
    const words = Object.fromEntries(['operation', 'aircraft', 'passenger', 'ton', 'hour', 'minute', 'unit', 'service',
      'day'].map(code => [code, [1, 2].flatMap(quantity => ['es-DO', 'en-US']
      .map(locale => billingUnitQuantity(quantity, code, locale)))]));
    expect(words).toEqual({
      operation: ['1 operación', '1 operation', '2 operaciones', '2 operations'],
      aircraft: ['1 aeronave', '1 aircraft', '2 aeronaves', '2 aircraft'],
      passenger: ['1 pasajero', '1 passenger', '2 pasajeros', '2 passengers'],
      ton: ['1 tonelada', '1 ton', '2 toneladas', '2 tons'],
      hour: ['1 hora', '1 hour', '2 horas', '2 hours'],
      minute: ['1 minuto', '1 minute', '2 minutos', '2 minutes'],
      unit: ['1 unidad', '1 unit', '2 unidades', '2 units'],
      service: ['1 servicio', '1 service', '2 servicios', '2 services'],
      day: ['1 día', '1 day', '2 días', '2 days'],
    });
  });

  it('reads a legacy name as its unit and never inflects a unit it does not know', () => {
    expect(billingUnitQuantity(2, 'Operación', 'es-DO')).toBe('2 operaciones');
    expect(billingUnitQuantity(1, ' HORA ', 'es-DO')).toBe('1 hora');
    expect(billingUnitQuantity(1, 'Hour', 'en-US')).toBe('1 hour');
    // An unknown unit: the quantity times its code, in either language. Inherited keys of an object are not units.
    expect(billingUnitQuantity(2, 'turno', 'es-DO')).toBe('2 × turno');
    expect(billingUnitQuantity(0.5, 'turno', 'en-US')).toBe('0.5 × turno');
    expect(billingUnitQuantity(2, 'constructor', 'es-DO')).toBe('2 × constructor');
    // Without a unit, the number alone; without a quantity, nothing.
    expect(billingUnitQuantity(2, '', 'es-DO')).toBe('2');
    expect(billingUnitQuantity(2, null, 'es-DO')).toBe('2');
    expect(billingUnitQuantity(null, 'hour', 'es-DO')).toBe('');
    expect(billingUnitQuantity(Number.NaN, 'hour', 'es-DO')).toBe('');
  });

  it('keeps the four decimals of a quantity, and the singular for what reads as one', () => {
    expect(billingUnitQuantity(1.23456, 'hour', 'es-DO')).toBe('1.2346 horas');
    expect(billingUnitQuantity(0.99999, 'hour', 'es-DO')).toBe('1 hora');
    expect(billingUnitQuantity(1500, 'minute', 'es-DO')).toBe('1,500 minutos');
  });
});
