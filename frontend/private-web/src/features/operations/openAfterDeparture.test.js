import { describe, expect, it } from 'vitest';
import { isOpenAfterDeparture, OPEN_AFTER_DEPARTURE_MARGIN_MS, OPEN_OPERATION_STATUSES } from './openAfterDeparture';

// The aircraft left its stand at 16:22 in Punta Cana (synthetic).
const LEFT = Date.parse('2026-11-16T20:22:00Z');
const MINUTE = 60_000;

describe('isOpenAfterDeparture (N30)', () => {
  it('is an operation still on the agent’s side more than an hour after its aircraft left', () => {
    expect(OPEN_AFTER_DEPARTURE_MARGIN_MS).toBe(60 * MINUTE);
    expect(OPEN_OPERATION_STATUSES).toEqual(['Assigned', 'InProgress', 'Returned']);
    for (const status of OPEN_OPERATION_STATUSES) {
      // Within the hour of D-N30 the agent may still hand it off: exactly an hour after is not more than the margin.
      expect(isOpenAfterDeparture(status, LEFT, LEFT + 59 * MINUTE), status).toBe(false);
      expect(isOpenAfterDeparture(status, LEFT, LEFT + 60 * MINUTE), status).toBe(false);
      expect(isOpenAfterDeparture(status, LEFT, LEFT + 60 * MINUTE + 1), status).toBe(true);
      expect(isOpenAfterDeparture(status, LEFT, LEFT + 8 * 60 * MINUTE), status).toBe(true);
    }
  });

  it('is never an operation handed off, approved, cancelled or never assigned, nor one without a departure', () => {
    const late = LEFT + 8 * 60 * MINUTE;
    for (const status of ['PendingReview', 'InReview', 'Approved', 'Cancelled', 'Planned', 'Paused', '', null, undefined]) {
      expect(isOpenAfterDeparture(status, LEFT, late), String(status)).toBe(false);
    }
    // Without the instant the aircraft left, or without the server's time, nothing is open after a departure.
    for (const left of [null, undefined, Number.NaN, '2026-11-16T20:22:00Z']) {
      expect(isOpenAfterDeparture('InProgress', left, late), String(left)).toBe(false);
    }
    expect(isOpenAfterDeparture('InProgress', LEFT, Number.NaN)).toBe(false);
    expect(isOpenAfterDeparture('InProgress', LEFT, undefined)).toBe(false);
    // A departure still ahead (a demo clock that already decided it) is not a departure yet.
    expect(isOpenAfterDeparture('InProgress', late, LEFT)).toBe(false);
    // The API's enum names are read in any case and spacing, as the OCC status vocabulary reads them.
    expect(isOpenAfterDeparture('in_progress', LEFT, late)).toBe(true);
    expect(isOpenAfterDeparture(' Returned ', LEFT, late)).toBe(true);
  });
});
