// N11 (D-N11, D-S6): the tablet writes one date and time format, «lun, 16 nov» and «16 nov, 19:46», always on a
// 24-hour clock and in the station's local time. A station whose zone the tablet does not know uses AVIAM's calendar
// (America/Santo_Domingo), as private-web and the server's BusinessCalendar do, never the device's zone.
const {
  BUSINESS_TIME_ZONE,
  formatLocalDateTime,
  formatStationDate,
  formatStationDateTime,
  formatStationTime,
  stationTimeZone,
} = require('../src/utils/date-format');

const PUJ = 'America/Santo_Domingo';
// Monday 16 November, 19:46 at Punta Cana (UTC−4 all year).
const EVENING = '2026-11-16T23:46:00.000Z';
// Five past midnight at the station: a clock that counts to 24 would write «24:05».
const AFTER_MIDNIGHT = '2026-11-17T04:05:00.000Z';

describe('the station’s zone (D-S6)', () => {
  test('a zone the runtime knows is the one used', () => {
    expect(stationTimeZone('America/New_York')).toBe('America/New_York');
    expect(stationTimeZone(PUJ)).toBe(PUJ);
  });

  test.each([undefined, null, '', 'Mars/Olympus_Mons'])('%p falls back to AVIAM’s calendar', zone => {
    expect(BUSINESS_TIME_ZONE).toBe('America/Santo_Domingo');
    expect(stationTimeZone(zone)).toBe('America/Santo_Domingo');
  });

  test('times follow the station, not the device', () => {
    expect(formatStationTime(EVENING, 'America/New_York')).toBe('18:46');
    expect(formatStationTime(EVENING, 'Asia/Kathmandu')).toBe('05:31');
  });

  test('without a known zone the times are AVIAM’s, whatever the device says', () => {
    for (const zone of [undefined, null, '', 'Mars/Olympus_Mons']) {
      expect(formatStationTime(EVENING, zone)).toBe('19:46');
      expect(formatStationDateTime(EVENING, zone)).toBe(formatStationDateTime(EVENING, PUJ));
      expect(formatStationDate(EVENING, zone)).toBe(formatStationDate(EVENING, PUJ));
    }
  });
});

describe('one format (D-N11)', () => {
  test('the day reads «lun, 16 nov», as written', () => {
    expect(formatStationDate(EVENING, PUJ)).toMatch(/^lun\.?, 16 nov\.?$/);
  });

  test('the time is on a 24-hour clock and midnight is 00', () => {
    expect(formatStationTime(EVENING, PUJ)).toBe('19:46');
    expect(formatStationTime(AFTER_MIDNIGHT, PUJ)).toBe('00:05');
  });

  test('date and time read «16 nov, 19:46», with no a. m./p. m. nor a leading zero on the day', () => {
    expect(formatStationDateTime(EVENING, PUJ)).toMatch(/^16 nov\.?,? 19:46$/);
    expect(formatStationDateTime(AFTER_MIDNIGHT, PUJ)).toMatch(/^17 nov\.?,? 00:05$/);
    expect(formatStationDateTime('2026-10-05T14:00:00.000Z', PUJ)).toMatch(/^5 oct\.?,? 10:00$/);
    expect(formatStationDateTime(EVENING, PUJ)).not.toMatch(/[ap]\.\s?m\./);
  });

  test('the device’s messages use the same format', () => {
    expect(formatLocalDateTime(EVENING)).toMatch(/^\d{1,2} [a-zé]{3,4}\.?,? \d{2}:\d{2}$/);
    expect(formatLocalDateTime(EVENING)).not.toMatch(/[ap]\.\s?m\./);
  });

  test('a Date is accepted like an ISO instant', () => {
    expect(formatStationTime(new Date(EVENING), PUJ)).toBe('19:46');
    expect(formatStationDate(new Date(EVENING), PUJ)).toBe(formatStationDate(EVENING, PUJ));
  });

  test.each([null, undefined, '', 'not a date'])('%p is «—»', value => {
    expect(formatStationDate(value, PUJ)).toBe('—');
    expect(formatStationTime(value, PUJ)).toBe('—');
    expect(formatStationDateTime(value, PUJ)).toBe('—');
  });
});

test('a runtime that ignores hourCycle and counts to 24 still writes 00:05 after midnight', () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  // Writes midnight as 24 whenever an hour cycle is asked for, like some Intl implementations.
  class CountsTo24 extends NativeDateTimeFormat {
    constructor(locale, options = {}) {
      super(locale, options.hourCycle ? { ...options, hourCycle: 'h24' } : options);
    }
  }
  Intl.DateTimeFormat = CountsTo24;
  try {
    jest.isolateModules(() => {
      const isolated = require('../src/utils/date-format');
      expect(isolated.formatStationTime(AFTER_MIDNIGHT, PUJ)).toBe('00:05');
      expect(isolated.formatStationDateTime(AFTER_MIDNIGHT, PUJ)).toMatch(/^17 nov\.?,? 00:05$/);
      expect(isolated.formatLocalDateTime(AFTER_MIDNIGHT)).not.toMatch(/24:05/);
      // A day 24 is not an hour.
      expect(isolated.formatStationDate('2026-11-24T16:00:00.000Z', PUJ)).toMatch(/^mar\.?, 24 nov\.?$/);
      expect(isolated.formatStationDateTime('2026-11-24T16:00:00.000Z', PUJ)).toMatch(/^24 nov\.?,? 12:00$/);
    });
  } finally {
    Intl.DateTimeFormat = NativeDateTimeFormat;
  }
});
