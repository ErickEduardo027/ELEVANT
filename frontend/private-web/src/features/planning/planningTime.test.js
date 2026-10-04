import { describe, expect, it } from 'vitest';
import { formatPlanningClock, formatPlanningDate } from './planningTime';

describe('planning time formatting', () => {
  it('formats an instant in the station IANA time zone', () => {
    expect(formatPlanningClock('2026-08-19T16:00:00Z', 'America/Santo_Domingo')).toBe('12:00');
  });

  it('fails closed for invalid instants or time zones', () => {
    expect(formatPlanningClock(null, 'America/Santo_Domingo')).toBe('—');
    expect(formatPlanningClock('not-an-instant', 'America/Santo_Domingo')).toBe('—');
    expect(formatPlanningClock('2026-08-19T16:00:00Z', 'Invalid/Zone')).toBe('—');
  });

  it('formats only canonical civil dates', () => {
    expect(formatPlanningDate('2026-08-19')).toBe('19/08/2026');
    expect(formatPlanningDate('2026-8-19')).toBe('—');
    expect(formatPlanningDate(null)).toBe('—');
  });
});