import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../mapMessages';
import { aircraftCard, aircraftSource, flightRowOf } from './aircraftCard';

const t = createTranslator(mapMessages, 'es');
const facts = card => Object.fromEntries(card.facts.map(fact => [fact.key, fact.value]));

describe('aircraftCard (owner request of 2026-11-15)', () => {
  it('other traffic: callsign big, its address, its operator from the callsign, no route', () => {
    const card = aircraftCard({ id: 'h:a1b2c3', hex: 'a1b2c3', kind: 'other', callsign: 'AAL1234', registration: 'N123AA',
      typeIcao: 'B738', altM: 3048, gsMs: 128.6, onGround: false, quality: 'live' }, null, { t });
    expect(card).toMatchObject({ kind: 'aircraft', id: 'h:a1b2c3', title: 'AAL1234', subtitle: 'A1B2C3', source: 'adsb' });
    expect(card.facts.map(fact => fact.key)).toEqual(['registration', 'type', 'airline', 'route', 'altitude', 'speed', 'source']);
    expect(facts(card)).toEqual({ registration: 'N123AA', type: 'B738', airline: 'AAL', route: null,
      altitude: expect.stringMatching(/^10.000 ft$/), speed: '250 kt', source: 'ADS-B' });
  });

  it('an ELEVANT arrival: its flight number beside the callsign, its airline and route to PUJ', () => {
    const flight = { flightKey: 'p:1', flightNumber: 'ZZ161', airline: { name: 'Aerolínea Demo' },
      counterpart: { iataCode: 'MIA' }, direction: 'Arrival' };
    const card = aircraftCard({ id: 'f:p:1', hex: 'f1c901', kind: 'aviam', flightKey: 'p:1', callsign: 'ZZZ161',
      direction: 'Arrival', altM: null, onGround: false, quality: 'estimated' }, flight, { t });
    expect(card).toMatchObject({ title: 'ZZZ161', subtitle: 'ZZ161 · F1C901', source: 'estimated' });
    expect(facts(card)).toMatchObject({ airline: 'Aerolínea Demo', route: 'MIA–PUJ', altitude: null, source: 'Estimada' });
  });

  it('a demo departure on the ground: «Demo», «En tierra», route from PUJ, no speed standing still', () => {
    const card = aircraftCard({ id: 'f:d', kind: 'aviam', flightNumber: 'ZZ9002', counterpartIata: 'SDQ',
      direction: 'Departure', onGround: true, gsMs: 0, isDemo: true, quality: 'estimated' }, null, { t });
    expect(card.title).toBe('ZZ9002');
    expect(facts(card)).toMatchObject({ route: 'PUJ–SDQ', altitude: 'En tierra', speed: null, source: 'Demo' });
    expect(aircraftSource({ quality: 'live' })).toBe('adsb');
    expect(aircraftCard(null, null, { t })).toBeNull();
  });

  it('flightRowOf finds a row by its flightKey', () => {
    expect(flightRowOf([{ flightKey: 'a' }, { flightKey: 'b' }], 'b')).toEqual({ flightKey: 'b' });
    expect(flightRowOf(null, 'b')).toBeNull();
    expect(flightRowOf([{ flightKey: 'a' }], null)).toBeNull();
  });
});
