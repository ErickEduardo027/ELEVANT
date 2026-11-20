import { describe, expect, it } from 'vitest';
import { bestLegTime, planningBandRows, planningBandWindow, visitState } from './planningViews';

// Synthetic turnarounds of one day at the station: identifiers, flights and times are invented.
const leg = (flightNumber, scheduledAt, extra = {}) => ({ flightNumber, scheduledAt, estimatedAt: null, actualAt: null, ...extra });
const visit = (id, stand, arrival, departure, extra = {}) => ({ id, turnaroundId: id, stand: stand ? { code: stand } : null,
  position: stand, arrival, departure, status: 'Planned', isDemo: false, ...extra });

const DAY = [
  visit('t-1', 'A10', leg('ZZ101', '2026-11-16T14:00:00Z'), leg('ZZ102', '2026-11-16T15:00:00Z')),
  visit('t-2', 'A2', leg('ZZ201', '2026-11-16T12:00:00Z', { actualAt: '2026-11-16T12:05:00Z' }),
    leg('ZZ202', '2026-11-16T13:00:00Z', { estimatedAt: '2026-11-16T13:20:00Z' }), { isDemo: true, status: 'InProgress' }),
  visit('t-3', null, leg('ZZ301', '2026-11-16T16:00:00Z'), null),
  visit('t-4', 'A2', leg('ZZ401', '2026-11-16T09:00:00Z', { actualAt: '2026-11-16T09:02:00Z' }),
    leg('ZZ402', '2026-11-16T10:00:00Z', { actualAt: '2026-11-16T10:04:00Z' }), { status: 'Completed' }),
];

describe('planningViews', () => {
  it('takes the best time of a leg: real, then estimated, then scheduled', () => {
    expect(bestLegTime(DAY[1].arrival)).toEqual({ at: '2026-11-16T12:05:00Z', kind: 'actual' });
    expect(bestLegTime(DAY[1].departure)).toEqual({ at: '2026-11-16T13:20:00Z', kind: 'estimated' });
    expect(bestLegTime(DAY[0].arrival)).toEqual({ at: '2026-11-16T14:00:00Z', kind: 'scheduled' });
    expect(bestLegTime(null)).toBeNull();
  });

  it('says where a visit is: departed once it left or closed, on stand once it arrived, else planned', () => {
    expect(DAY.map(visitState)).toEqual(['planned', 'onStand', 'planned', 'departed']);
  });

  it('draws one row per stand in natural order, its visits by time, and leaves out a visit without stand', () => {
    const rows = planningBandRows(DAY);
    expect(rows.map(row => row.id)).toEqual(['A2', 'A10']);
    expect(rows[0].bars.map(bar => bar.turnaroundId)).toEqual(['t-4', 't-2']);
    expect(rows[0].bars[1]).toMatchObject({ arrivalFlight: 'ZZ201', departureFlight: 'ZZ202', startKind: 'actual',
      endKind: 'estimated', state: 'onStand', estimated: true, demo: true, inOperation: true, conflict: null });
    expect(rows[1].bars[0]).toMatchObject({ startAt: '2026-11-16T14:00:00Z', endAt: '2026-11-16T15:00:00Z', state: 'planned' });
  });

  it('labels a row by the code the map draws and keeps the stored code as its id (N27)', () => {
    const rows = planningBandRows([visit('t-5', 'A02', leg('ZZ501', '2026-11-16T11:00:00Z'), null),
      visit('t-6', 'E2E-XXXX-1', leg('ZZ601', '2026-11-16T12:00:00Z'), null)]);
    expect(rows.map(row => [row.id, row.label])).toEqual([['A02', 'A2'], ['E2E-XXXX-1', 'E2E-XXXX-1']]);
  });

  it('shows the station day, widened to the visits that fall outside it', () => {
    const rows = planningBandRows(DAY);
    expect(planningBandWindow(rows, '2026-11-16', 'America/Santo_Domingo')).toEqual({
      windowStart: Date.parse('2026-11-16T04:00:00Z'), windowEnd: Date.parse('2026-11-17T04:00:00Z'),
    });
    const late = planningBandRows([visit('t-9', 'B1', leg('ZZ901', '2026-11-17T05:00:00Z'), leg('ZZ902', '2026-11-17T06:00:00Z'))]);
    expect(planningBandWindow(late, '2026-11-16', 'America/Santo_Domingo').windowEnd).toBe(Date.parse('2026-11-17T06:30:00Z'));
    expect(planningBandWindow(rows, '', 'UTC')).toBeNull();
  });
});
