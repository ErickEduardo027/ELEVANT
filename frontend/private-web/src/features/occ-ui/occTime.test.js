import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import {
  durationText, formatClock, minutesBetween, OCC_EMPTY_CLOCK, relativeTimeParts, relativeTimeText, toInstantMs,
} from './occTime';
import { occUiMessages } from './occUiMessages';

// Punta Cana is UTC−4 all year: 18:32 UTC is 14:32 at the station.
const ZONE = 'America/Santo_Domingo';
const NOW = Date.parse('2026-11-14T18:32:00Z');
const MINUTE = 60_000;
const at = minutes => NOW + minutes * MINUTE;
const spanish = createTranslator(occUiMessages, 'es');
const english = createTranslator(occUiMessages, 'en');

describe('occTime', () => {
  it('formats a clock in the station time zone and «--:--» for an invalid instant', () => {
    expect(formatClock('2026-11-14T18:32:00Z', 'es-DO', ZONE)).toBe('14:32');
    expect(formatClock(NOW, 'en-US', ZONE)).toBe('14:32');
    expect(formatClock(new Date(NOW), 'es-DO', 'UTC')).toBe('18:32');
    // 24 hours: just after midnight is 00, never 24 or 12 a. m.; seconds are dropped, not rounded.
    expect(formatClock('2026-11-15T04:05:00Z', 'en-US', ZONE)).toBe('00:05');
    expect(formatClock('2026-11-14T22:59:59Z', 'es-DO', ZONE)).toBe('18:59');

    expect(OCC_EMPTY_CLOCK).toBe('--:--');
    for (const invalid of [null, undefined, '', '   ', 'mañana', Number.NaN, Infinity, {}, new Date('no')]) {
      expect(formatClock(invalid, 'es-DO', ZONE), String(invalid)).toBe('--:--');
    }

    // The instants the primitives accept: an ISO text, milliseconds or a Date.
    expect(toInstantMs('2026-11-14T18:32:00Z')).toBe(NOW);
    expect(toInstantMs(NOW)).toBe(NOW);
    expect(toInstantMs(new Date(NOW))).toBe(NOW);
    expect(toInstantMs('ayer')).toBeNaN();
    expect(toInstantMs(null)).toBeNaN();
  });

  it('tells now, the future and the past apart, rounding to the minute, with hours past 60 minutes', () => {
    // Less than a minute either way is «ahora».
    for (const delta of [0, 59_000, -59_000]) {
      expect(relativeTimeParts(NOW + delta, NOW)).toEqual({ tense: 'now', hours: 0, minutes: 0 });
    }
    expect(relativeTimeParts(at(12), NOW)).toEqual({ tense: 'future', hours: 0, minutes: 12 });
    expect(relativeTimeParts(at(12.4), NOW)).toEqual({ tense: 'future', hours: 0, minutes: 12 });
    expect(relativeTimeParts(at(12.6), NOW)).toEqual({ tense: 'future', hours: 0, minutes: 13 });
    expect(relativeTimeParts(at(-3), NOW)).toEqual({ tense: 'past', hours: 0, minutes: 3 });
    expect(relativeTimeParts(at(85), NOW)).toEqual({ tense: 'future', hours: 1, minutes: 25 });
    // 59.6 minutes rounds to a full hour.
    expect(relativeTimeParts(at(59.6), NOW)).toEqual({ tense: 'future', hours: 1, minutes: 0 });
    expect(relativeTimeParts('2026-11-14T16:32:00Z', '2026-11-14T18:32:00Z')).toEqual({ tense: 'past', hours: 2, minutes: 0 });
    expect(relativeTimeParts('pronto', NOW)).toBeNull();
    expect(relativeTimeParts(NOW, undefined)).toBeNull();

    // Rounded the same way ahead and behind, and never a negative zero.
    expect(minutesBetween(at(12), NOW)).toBe(12);
    expect(minutesBetween(at(-3), NOW)).toBe(-3);
    expect(minutesBetween(at(2.5), NOW)).toBe(3);
    expect(minutesBetween(at(-2.5), NOW)).toBe(-3);
    expect(Object.is(minutesBetween(NOW - 20_000, NOW), 0)).toBe(true);
    expect(minutesBetween(null, NOW)).toBeNaN();

    // The words of a countdown, the same as the maps' data block.
    expect(relativeTimeText(at(12), NOW, spanish)).toBe('en 12 min');
    expect(relativeTimeText(NOW + 30_000, NOW, spanish)).toBe('ahora');
    expect(relativeTimeText(at(-3), NOW, spanish)).toBe('hace 3 min');
    expect(relativeTimeText(at(85), NOW, spanish)).toBe('en 1 h 25 min');
    expect(relativeTimeText(at(-120), NOW, spanish)).toBe('hace 2 h');
    expect(relativeTimeText(at(85), NOW, english)).toBe('in 1 h 25 min');
    expect(relativeTimeText(at(-3), NOW, english)).toBe('3 min ago');
    expect(relativeTimeText(NOW, NOW, english)).toBe('now');
    expect(relativeTimeText('pronto', NOW, spanish)).toBe('');
    expect(durationText({ hours: 0, minutes: 5 }, spanish)).toBe('5 min');
    expect(durationText({ hours: 3, minutes: 0 }, english)).toBe('3 h');
  });
});
