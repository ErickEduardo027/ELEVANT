import { expect, it } from 'vitest';
import { countOf, partOf, percentOf } from './kpiContext';

it('pluralizes by the count', () => {
  expect(countOf(0, 'factura', 'facturas')).toBe('0 facturas');
  expect(countOf(1, 'factura', 'facturas')).toBe('1 factura');
  expect(countOf(2, 'factura', 'facturas')).toBe('2 facturas');
  expect(countOf(1500, 'factura', 'facturas')).toBe('1,500 facturas');
});

it('gives a share with one decimal, and none against an empty whole', () => {
  expect(percentOf(1, 3)).toBe('33.3 %');
  expect(percentOf(2, 2)).toBe('100 %');
  expect(percentOf(0, 0)).toBeNull();
  expect(percentOf(1, null)).toBeNull();
});

it('names what a figure is counted against, with the noun agreeing with the whole', () => {
  expect(partOf(3, 10, 'solicitud', 'solicitudes')).toBe('de 10 solicitudes · 30 %');
  expect(partOf(1, 1, 'solicitud', 'solicitudes')).toBe('de 1 solicitud · 100 %');
  expect(partOf(0, 0, 'solicitud', 'solicitudes')).toBe('de 0 solicitudes');
});
