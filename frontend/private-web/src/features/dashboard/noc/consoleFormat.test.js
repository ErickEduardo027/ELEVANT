import { describe, expect, it } from 'vitest';
import { formatConsoleDate } from './consoleFormat';

describe('formatConsoleDate', () => {
  it('writes the operational date of the station, whatever the time zone of the device', () => {
    expect(formatConsoleDate('2026-11-14', 'es-DO')).toMatch(/^sáb.* 14 nov/);
    expect(formatConsoleDate('2026-11-14', 'en-US')).toMatch(/^Sat, Nov 14$/);
    // Read at noon UTC: the first of the month stays the first, also far west or east of UTC.
    expect(formatConsoleDate('2026-10-01', 'en-US')).toContain('Oct 1');
  });

  it('gives back what is not a date as it came', () => {
    expect(formatConsoleDate('mañana', 'es-DO')).toBe('mañana');
    expect(formatConsoleDate(null, 'es-DO')).toBe('');
  });
});
