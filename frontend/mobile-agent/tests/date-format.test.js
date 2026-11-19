// N11 (D-N11, D-S6): the tablet writes one date and time format, «lun, 16 nov» and «16 nov, 19:46», always on a
// 24-hour clock and in the station's local time. A station whose zone the tablet does not know uses AVIAM's calendar
// (America/Santo_Domingo), as private-web and the server's BusinessCalendar do, never the device's zone.
const {
  BUSINESS_TIME_ZONE,
  formatLocalDateTime,
  formatStationDate,
  formatStationDateTime,
  formatStationTime,
  stationTimeLabel,
  stationTimeTitle,
  stationTimeZone,
  stationWallClock,
  stationWallClockToInstant,
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

// S6 (D-S6): the attendance card edits its times on the station's wall clock, «2026-11-16 19:46», and saves UTC
// instants. A time the station's clock skips is refused, never moved to another hour; one it repeats takes its first
// occurrence.
describe('the station’s wall clock (S6, D-S6)', () => {
  const NEW_YORK = 'America/New_York';

  test('13:00 in Santo Domingo is 17:00 UTC, both ways', () => {
    expect(stationWallClockToInstant('2026-11-16 13:00', PUJ)).toBe('2026-11-16T17:00:00.000Z');
    expect(stationWallClock('2026-11-16T17:00:00.000Z', PUJ)).toBe('2026-11-16 13:00');
  });

  test('New York in summer (UTC−4) and in winter (UTC−5)', () => {
    expect(stationWallClockToInstant('2026-07-15 13:00', NEW_YORK)).toBe('2026-07-15T17:00:00.000Z');
    expect(stationWallClockToInstant('2026-01-15 13:00', NEW_YORK)).toBe('2026-01-15T18:00:00.000Z');
    expect(stationWallClock('2026-07-15T17:00:00.000Z', NEW_YORK)).toBe('2026-07-15 13:00');
    expect(stationWallClock('2026-01-15T18:00:00.000Z', NEW_YORK)).toBe('2026-01-15 13:00');
  });

  test('02:30 on 8 March does not exist in New York: undefined, not 03:30', () => {
    expect(stationWallClockToInstant('2026-03-08 02:30', NEW_YORK)).toBeUndefined();
    expect(stationWallClockToInstant('2026-03-08 02:00', NEW_YORK)).toBeUndefined();
    // The minutes around the jump do exist.
    expect(stationWallClockToInstant('2026-03-08 01:59', NEW_YORK)).toBe('2026-03-08T06:59:00.000Z');
    expect(stationWallClockToInstant('2026-03-08 03:00', NEW_YORK)).toBe('2026-03-08T07:00:00.000Z');
  });

  test('01:30 on 1 November happens twice in New York: the first one is taken', () => {
    expect(stationWallClockToInstant('2026-11-01 01:30', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
    // Both read back as 01:30.
    expect(stationWallClock('2026-11-01T05:30:00.000Z', NEW_YORK)).toBe('2026-11-01 01:30');
    expect(stationWallClock('2026-11-01T06:30:00.000Z', NEW_YORK)).toBe('2026-11-01 01:30');
  });

  test('a zone the tablet does not know is Santo Domingo, whatever the device says', () => {
    for (const zone of ['Mars/Olympus_Mons', undefined, null, '']) {
      expect(stationWallClockToInstant('2026-11-16 13:00', zone)).toBe('2026-11-16T17:00:00.000Z');
      expect(stationWallClock('2026-11-16T17:00:00.000Z', zone)).toBe('2026-11-16 13:00');
    }
  });

  test('a station off the hour (Kathmandu, UTC+5:45), and midnight on a 24-hour clock', () => {
    expect(stationWallClock(EVENING, 'Asia/Kathmandu')).toBe('2026-11-17 05:31');
    expect(stationWallClockToInstant('2026-11-17 05:31', 'Asia/Kathmandu')).toBe(EVENING);
    expect(stationWallClock(AFTER_MIDNIGHT, PUJ)).toBe('2026-11-17 00:05');
    expect(stationWallClockToInstant('2026-11-17 00:05', PUJ)).toBe(AFTER_MIDNIGHT);
  });

  test('an empty value is null and one that is not a time is undefined', () => {
    for (const value of ['', '   ', null, undefined]) expect(stationWallClockToInstant(value, PUJ)).toBeNull();
    for (const value of ['2026-11-16', '16/11/2026 13:00', '2026-11-16 1:00', '2026-02-30 10:00', '2026-11-16 24:00',
      '2026-11-16 13:60', '2026-13-01 10:00', 'mañana']) {
      expect(stationWallClockToInstant(value, PUJ)).toBeUndefined();
    }
    // Spaces around the value and a «T» between date and time are accepted.
    expect(stationWallClockToInstant(' 2026-11-16 13:00 ', PUJ)).toBe('2026-11-16T17:00:00.000Z');
    expect(stationWallClockToInstant('2026-11-16T13:00', PUJ)).toBe('2026-11-16T17:00:00.000Z');
  });

  test('a missing or invalid instant has no wall clock, and a Date is accepted', () => {
    for (const value of [null, undefined, '', 'not a date']) expect(stationWallClock(value, PUJ)).toBe('');
    expect(stationWallClock(new Date(EVENING), PUJ)).toBe('2026-11-16 19:46');
  });

  test('the label names the station: «hora local de PUJ»', () => {
    expect(stationTimeLabel('PUJ')).toBe('hora local de PUJ');
    expect(stationTimeTitle('PUJ')).toBe('Hora local de PUJ');
    for (const code of [undefined, null, '', '  ']) {
      expect(stationTimeLabel(code)).toBe('hora local de la estación');
      expect(stationTimeTitle(code)).toBe('Hora local de la estación');
    }
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

// S6: the wall clock is read from `formatToParts`; a runtime without it (some Hermes builds) is read from the formatted
// text. Neither a clock that counts to 24 nor one that ignores `hourCycle` and writes «07:46 PM» moves the saved hour.
describe('the station’s wall clock on other Intl engines (S6)', () => {
  const NativeDateTimeFormat = Intl.DateTimeFormat;
  const NEW_YORK = 'America/New_York';

  function withEngine(Engine, check) {
    Intl.DateTimeFormat = Engine;
    try {
      jest.isolateModules(() => check(require('../src/utils/date-format')));
    } finally {
      Intl.DateTimeFormat = NativeDateTimeFormat;
    }
  }

  function expectWallClock(isolated) {
    expect(isolated.stationWallClock(EVENING, PUJ)).toBe('2026-11-16 19:46');
    expect(isolated.stationWallClock(AFTER_MIDNIGHT, PUJ)).toBe('2026-11-17 00:05');
    expect(isolated.stationWallClock('2026-11-16T16:30:00.000Z', PUJ)).toBe('2026-11-16 12:30');
    expect(isolated.stationWallClockToInstant('2026-11-16 19:46', PUJ)).toBe(EVENING);
    expect(isolated.stationWallClockToInstant('2026-11-17 00:05', PUJ)).toBe(AFTER_MIDNIGHT);
    expect(isolated.stationWallClockToInstant('2026-11-16 12:30', PUJ)).toBe('2026-11-16T16:30:00.000Z');
    expect(isolated.stationWallClockToInstant('2026-11-01 01:30', NEW_YORK)).toBe('2026-11-01T05:30:00.000Z');
    expect(isolated.stationWallClockToInstant('2026-03-08 02:30', NEW_YORK)).toBeUndefined();
  }

  // Asks for the hour cycle the engine prefers instead of the one requested.
  const hourCycleEngine = hourCycle => class extends NativeDateTimeFormat {
    constructor(locale, options = {}) {
      super(locale, options.hourCycle ? { ...options, hourCycle } : options);
    }
  };
  // The same engine without `formatToParts`.
  const withoutParts = Engine => {
    const Partless = class extends Engine {};
    Object.defineProperty(Partless.prototype, 'formatToParts', { value: undefined });
    return Partless;
  };

  test('a runtime without formatToParts reads the formatted text', () => {
    withEngine(withoutParts(NativeDateTimeFormat), expectWallClock);
  });

  test('a runtime that counts to 24 still reads midnight as 00', () => {
    withEngine(hourCycleEngine('h24'), expectWallClock);
    withEngine(withoutParts(hourCycleEngine('h24')), expectWallClock);
  });

  test('a runtime that writes «07:46 PM» still reads 19:46', () => {
    withEngine(hourCycleEngine('h12'), expectWallClock);
    withEngine(withoutParts(hourCycleEngine('h12')), expectWallClock);
  });
});
