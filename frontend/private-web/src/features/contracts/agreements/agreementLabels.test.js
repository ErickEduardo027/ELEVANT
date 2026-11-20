import { describe, expect, it } from 'vitest';
import { airlineCodeLabel, countLabel, validityRange } from './agreementLabels';

describe('validityRange (N33)', () => {
  it('keeps a list neutral: two dates with a dash, or «Sin vencimiento» for a validity with no end', () => {
    expect(validityRange('2026-09-01', '2027-08-31')).toBe('01/09/2026 — 31/08/2027');
    expect(validityRange('2026-09-01', null)).toBe('01/09/2026 — Sin vencimiento');
    expect(validityRange('2026-09-01', undefined, { style: 'short' })).toBe('01/09/2026 — Sin vencimiento');
  });

  it('writes the validity in full inside a sentence, never «al Sin vencimiento»', () => {
    expect(validityRange('2026-11-03', '2027-11-02', { style: 'long' }))
      .toBe('del 3 de noviembre de 2026 al 2 de noviembre de 2027');
    const open = validityRange('2026-11-03', null, { style: 'long' });
    expect(open).toBe('desde el 3 de noviembre de 2026, sin vencimiento');
    expect(open).not.toMatch(/al Sin|Sin vencimiento/);
  });
});

describe('airlineCodeLabel (N33)', () => {
  it('trims the padding SQL adds to a two-letter IATA code and keeps an ICAO code whole', () => {
    expect(airlineCodeLabel('WN ')).toBe('WN');
    expect(airlineCodeLabel(' DM ')).toBe('DM');
    expect(airlineCodeLabel('SWA')).toBe('SWA');
  });

  it('writes nothing for a missing code', () => {
    expect(airlineCodeLabel(null)).toBe('');
    expect(airlineCodeLabel(undefined)).toBe('');
    expect(airlineCodeLabel('   ')).toBe('');
  });
});

describe('countLabel (N33)', () => {
  it('names one thing in the singular and any other count in the plural', () => {
    expect(countLabel(1, 'versión publicada', 'versiones publicadas')).toBe('1 versión publicada');
    expect(countLabel(2, 'versión publicada', 'versiones publicadas')).toBe('2 versiones publicadas');
    expect(countLabel(0, 'tarifa pactada', 'tarifas pactadas')).toBe('0 tarifas pactadas');
  });
});
