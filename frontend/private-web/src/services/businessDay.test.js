import { describe, expect, it } from 'vitest';
import { addDays, BUSINESS_TIME_ZONE, businessToday, formatBusinessDateTime, stationLocalToUtc,
  utcToStationLocalInput } from './businessDay';

describe('business day (2-F)', () => {
  it('is the day in Santo Domingo, not the UTC day', () => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Santo_Domingo');
    // 21:00 on 5 November in Santo Domingo is already 6 November in UTC.
    expect(businessToday(new Date('2026-11-06T01:00:00Z'))).toBe('2026-11-05');
    expect(businessToday(new Date('2026-11-06T03:59:59Z'))).toBe('2026-11-05');
    expect(businessToday(new Date('2026-11-06T04:00:00Z'))).toBe('2026-11-06');
  });

  it('uses the station zone when given and falls back on an unknown one', () => {
    const instant = new Date('2026-11-06T01:00:00Z');
    expect(businessToday(instant, 'Europe/Madrid')).toBe('2026-11-06');
    expect(businessToday(instant, 'America/New_York')).toBe('2026-11-05');
    expect(businessToday(instant, 'Mars/Olympus_Mons')).toBe('2026-11-05');
  });

  it('adds calendar days to an ISO date', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-11-05', 30)).toBe('2026-12-05');
    expect(() => addDays('05/11/2026', 1)).toThrow(TypeError);
  });
});

describe('report date and time (phase 3, block E)', () => {
  it('shows a UTC instant in the station local time with a 24-hour clock', () => {
    expect(formatBusinessDateTime('2026-10-26T12:00:00Z')).toBe('26/10/2026, 08:00');
    // 22:30 in Punta Cana is already the next day in UTC: the report keeps the local day.
    expect(formatBusinessDateTime('2026-11-06T02:30:00Z')).toBe('05/11/2026, 22:30');
    expect(formatBusinessDateTime(new Date('2026-11-06T02:30:00Z'), { timeZone: 'Europe/Madrid' })).toBe('06/11/2026, 03:30');
    expect(formatBusinessDateTime('2026-10-26T12:00:00Z', { locale: 'en-US' })).toBe('10/26/2026, 08:00');
  });

  it('falls back on AVIAM calendar for an unknown zone and shows a dash for an invalid instant', () => {
    expect(formatBusinessDateTime('2026-10-26T12:00:00Z', { timeZone: 'Mars/Olympus_Mons' })).toBe('26/10/2026, 08:00');
    expect(formatBusinessDateTime('not a date')).toBe('—');
    expect(formatBusinessDateTime(null)).toBe('—');
  });
});

describe('station local time (3-N19)', () => {
  const zone = 'America/Santo_Domingo';

  it('converts what OCC types in the station zone to the UTC instant the API stores', () => {
    expect(stationLocalToUtc('2026-11-05T13:00', zone)).toBe('2026-11-05T17:00:00.000Z');
    // Local midnight is 04:00 UTC; 22:30 local is already the next day in UTC.
    expect(stationLocalToUtc('2026-11-05T00:00', zone)).toBe('2026-11-05T04:00:00.000Z');
    expect(stationLocalToUtc('2026-11-05T22:30', zone)).toBe('2026-11-06T02:30:00.000Z');
    expect(stationLocalToUtc('2026-11-05T22:30:15', zone)).toBe('2026-11-06T02:30:15.000Z');
  });

  it('prefills a form with the local time of a UTC instant', () => {
    expect(utcToStationLocalInput('2026-11-06T02:30:00.000Z', zone)).toBe('2026-11-05T22:30');
    expect(utcToStationLocalInput('2026-11-05T04:00:00Z', zone)).toBe('2026-11-05T00:00');
    expect(utcToStationLocalInput(new Date('2026-11-05T17:00:00Z'), zone)).toBe('2026-11-05T13:00');
    expect(utcToStationLocalInput('not a date', zone)).toBe('');
  });

  it('follows the zone, daylight saving included, and falls back on AVIAM calendar for an unknown one', () => {
    expect(stationLocalToUtc('2026-07-01T12:00', 'America/New_York')).toBe('2026-07-01T16:00:00.000Z');
    expect(stationLocalToUtc('2026-12-01T12:00', 'America/New_York')).toBe('2026-12-01T17:00:00.000Z');
    expect(utcToStationLocalInput(stationLocalToUtc('2026-03-29T10:15', 'Europe/Madrid'), 'Europe/Madrid'))
      .toBe('2026-03-29T10:15');
    expect(stationLocalToUtc('2026-11-05T13:00', 'Mars/Olympus_Mons')).toBe('2026-11-05T17:00:00.000Z');
    expect(stationLocalToUtc('2026-11-05 13:00', zone)).toBeNull();
    expect(stationLocalToUtc('', zone)).toBeNull();
  });
});
