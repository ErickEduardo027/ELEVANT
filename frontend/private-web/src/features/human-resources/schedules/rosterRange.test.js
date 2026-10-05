import { expect, it } from 'vitest';
import { getRosterRange, shiftRosterAnchor } from './rosterRange';

it('keeps the selected local week and a fifteen-day window on date-only keys', () => {
  const anchor = new Date(2026, 7, 18, 12);
  expect(getRosterRange('week', anchor)).toMatchObject({
    from: '2026-08-17', to: '2026-08-23',
  });
  expect(getRosterRange('fortnight', anchor)).toMatchObject({
    from: '2026-08-18', to: '2026-09-01',
  });
  expect(getRosterRange('week', shiftRosterAnchor('week', anchor, 1))).toMatchObject({
    from: '2026-08-24', to: '2026-08-30',
  });
  expect(getRosterRange('fortnight', shiftRosterAnchor('fortnight', anchor, 1))).toMatchObject({
    from: '2026-09-02', to: '2026-09-16',
  });
});

it('uses the actual first and final local day of leap and thirty-one-day months', () => {
  expect(getRosterRange('month', new Date(2028, 1, 17, 12))).toMatchObject({
    from: '2028-02-01', to: '2028-02-29',
  });
  expect(getRosterRange('month', new Date(2026, 9, 31, 12))).toMatchObject({
    from: '2026-10-01', to: '2026-10-31',
  });
  expect(getRosterRange('month', shiftRosterAnchor('month',
    new Date(2026, 9, 31, 12), 1))).toMatchObject({
    from: '2026-11-01', to: '2026-11-30',
  });
});
