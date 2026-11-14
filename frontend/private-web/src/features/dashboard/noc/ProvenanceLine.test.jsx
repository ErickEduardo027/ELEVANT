import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { consoleMessages } from './consoleMessages';
import ProvenanceLine, { provenanceSentences } from './ProvenanceLine';

// The provenance line under the console's map (contratos 2.5, owner decision 6): one sentence per source, only when it
// applies, the age of the aircraft on the server's clock.

const t = createTranslator(consoleMessages, 'es');
const NOW = Date.parse('2026-11-14T15:00:00Z');
const SOURCE = { name: 'Red ADS-B de prueba', homeUrl: 'https://example.org/adsb', licenseName: 'Datos', licenseUrl: null };
const picture = (overrides = {}) => ({ status: 'Live', source: SOURCE, serverTime: NOW - 4_000, ageSeconds: 2,
  ...overrides });
const words = input => provenanceSentences({ t, ...input }).map(sentence => sentence.text);

afterEach(cleanup);

describe('provenanceSentences', () => {
  it('says each source only when it applies, in order', () => {
    expect(words({ stands: [{ locationSource: 'reference' }, { locationSource: 'occ' }], picture: picture(),
      situation: { aircraft: [{ quality: 'estimated' }, { quality: 'estimated' }, { quality: 'live' }] },
      flights: [{ isDemo: true }], nowMs: NOW })).toEqual([
      'Posiciones: referencia interna sin verificar.', 'Aviones: Red ADS-B de prueba, hace 6 s.',
      '2 posiciones estimadas.', 'Incluye un vuelo demo.',
    ]);
    // Stands placed by OCC, one estimated aircraft, no demo flight.
    expect(words({ stands: [{ locationSource: 'occ' }], picture: picture(),
      situation: { aircraft: [{ quality: 'estimated' }, { quality: 'estimated', hiddenInStand: true }] },
      flights: [{ isDemo: false }], nowMs: NOW })).toEqual(['Aviones: Red ADS-B de prueba, hace 6 s.',
      '1 posición estimada.']);
  });

  it('counts an old picture in minutes and says when there is no live traffic', () => {
    expect(words({ picture: picture({ status: 'Stale', ageSeconds: 200 }), nowMs: NOW }))
      .toEqual(['Aviones: Red ADS-B de prueba, hace 3 min.']);
    expect(words({ picture: picture({ status: 'Disabled', source: null }), nowMs: NOW }))
      .toEqual(['Aviones: sin tráfico en vivo.']);
    // Before the first picture nothing is said of the aircraft.
    expect(words({ picture: null, nowMs: NOW })).toEqual([]);
  });
});

describe('ProvenanceLine', () => {
  it('renders the sentences in one line, and nothing without any', () => {
    const { rerender } = render(<ProvenanceLine stands={[{ locationSource: 'reference' }]} picture={null} />);
    expect(screen.getByTestId('occ-console-provenance')).toHaveTextContent('Posiciones: referencia interna sin verificar.');
    rerender(<ProvenanceLine stands={[]} picture={null} />);
    expect(screen.queryByTestId('occ-console-provenance')).not.toBeInTheDocument();
  });
});
