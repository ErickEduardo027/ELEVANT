import { afterEach, describe, expect, it, vi } from 'vitest';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { TRAFFIC_NOON } from '../testing/trafficFixtures';
import { staleWords, stationTime } from './stationTime';

// TRAFFIC_NOON is 15:00 UTC: 11:00 at Punta Cana (UTC−4 all year).
const NOON = Date.parse(TRAFFIC_NOON);

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe('station time', () => {
  it('is the 24-hour time at Punta Cana of an instant, whatever the language', () => {
    expect([stationTime(NOON), stationTime(NOON - 45_000), stationTime(NOON + 3_600_000 * 7)])
      .toEqual(['11:00', '10:59', '18:00']);
    // The station's day, not UTC's: 03:30 UTC is still 23:30 of the evening before at Punta Cana.
    expect(stationTime(Date.parse('2026-11-14T03:30:00Z'))).toBe('23:30');
    expect(stationTime(NOON, 'en-US')).toBe('11:00');
    // Without an instant there is no time to write.
    expect([stationTime(null), stationTime(undefined), stationTime(Number.NaN), stationTime(TRAFFIC_NOON)])
      .toEqual([null, null, null, null]);
  });

  it('falls back to the UTC time on a runtime that does not know the zone', () => {
    vi.spyOn(Intl, 'DateTimeFormat').mockImplementation(function NoZone() {
      throw new RangeError('Invalid time zone specified');
    });
    // A locale no earlier call has formatted with, so its formatter is built now.
    expect(stationTime(NOON - 45_000, 'es-419')).toBe('14:59');
  });
});

describe('stale words', () => {
  it('are the stale tag of the vocabulary with the station time of the last position, never its age', () => {
    const lastFix = NOON - 45_000;
    expect(staleWords(lastFix)).toBe('Sin actualizar desde las 10:59');
    expect(staleWords(lastFix)).toBe(TAGS.stale.es.replace('{time}', '10:59'));
    expect(staleWords(lastFix, 'en')).toBe('Not updated since 10:59');
    expect(staleWords(lastFix, 'en')).toBe(TAGS.stale.en.replace('{time}', '10:59'));
    expect(staleWords(lastFix)).not.toMatch(/\d+\s*(s|min)\b|hace|Sin señal/);
    // The time does not age: four minutes on, the same words.
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(NOON);
    const words = staleWords(lastFix);
    vi.setSystemTime(NOON + 240_000);
    expect(staleWords(lastFix)).toBe(words);
  });

  it('are the tag alone without a known instant, and Spanish for a language the vocabulary lacks', () => {
    expect([staleWords(null), staleWords(Number.NaN, 'en')]).toEqual([TAGS.stale.short.es, TAGS.stale.short.en]);
    expect([staleWords(null), staleWords(null, 'en')]).toEqual(['Sin actualizar', 'Not updated']);
    expect(staleWords(NOON, 'fr')).toBe('Sin actualizar desde las 11:00');
  });
});
