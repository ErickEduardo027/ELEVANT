// What the tablet reads about the flight at a glance, only from what ELEVANT already sends: the delay of each leg
// against its schedule, the phase from the milestones, the ground time, the countdown and the progress counters.
jest.mock('@elevant/api-client', () => ({
  FLIGHT_REPORT_MILESTONES: [
    { code: 'BLOCK_ON', phase: 'arrival', label: 'Bloqueo' },
    { code: 'LOAD_SHEET', phase: 'on_stand', label: 'Hoja de carga' },
    { code: 'BOARDING', phase: 'departure', label: 'Abordaje' },
    { code: 'PAX_DOOR_CLOSED', phase: 'departure', label: 'Cierre puerta pax' },
    { code: 'PUSHBACK', phase: 'pushback', label: 'Push-back' },
  ],
}));

const {
  airlineBadge,
  delayReading,
  flightPhase,
  formatDuration,
  groundTimeMinutes,
  legDelayMinutes,
  milestoneProgress,
  nextEvent,
  serviceProgress,
} = require('../src/features/assigned-operations/flight-status');

const leg = times => ({ flightNumber: 'CM1', scheduledAt: '2026-11-24T15:00:00.000Z', estimatedAt: null,
  actualAt: null, ...times });
const operation = ({ arrival = null, departure = null, status = 'InProgress', milestones = [] } = {}) => ({
  operation: { status }, turnaround: { arrival, departure }, milestones,
});

test('the delay is the actual (else estimated) time against the schedule, in whole minutes', () => {
  expect(legDelayMinutes(leg({}))).toBeNull();
  expect(legDelayMinutes(leg({ estimatedAt: '2026-11-24T15:12:00.000Z' }))).toBe(12);
  expect(legDelayMinutes(leg({ estimatedAt: '2026-11-24T15:12:00.000Z', actualAt: '2026-11-24T14:55:00.000Z' })))
    .toBe(-5);
});

test.each([
  [0, 'A tiempo', 'success'],
  [-4, '−4 min', 'success'],
  [9, '+9 min', 'warning'],
  [15, '+15 min', 'danger'],
])('a delay of %i minutes reads «%s» in %s', (minutes, text, tone) => {
  expect(delayReading(minutes)).toMatchObject({ text, tone });
});

describe('the phase', () => {
  test('follows the record, latest first', () => {
    expect(flightPhase(operation({ arrival: leg({}) }))).toBe('scheduled');
    expect(flightPhase(operation({ arrival: leg({ estimatedAt: '2026-11-24T15:10:00.000Z' }) }))).toBe('enroute');
    expect(flightPhase(operation({ arrival: leg({ actualAt: '2026-11-24T15:10:00.000Z' }) }))).toBe('landed');
    expect(flightPhase(operation({ milestones: [{ code: 'BLOCK_ON' }] }))).toBe('onstand');
    expect(flightPhase(operation({ milestones: [{ code: 'BLOCK_ON' }, { code: 'BOARDING' }] }))).toBe('boarding');
    expect(flightPhase(operation({ milestones: [{ code: 'PAX_DOOR_CLOSED' }] }))).toBe('closed');
    expect(flightPhase(operation({ milestones: [{ code: 'PUSHBACK' }] }))).toBe('pushback');
    expect(flightPhase(operation({ departure: leg({ actualAt: '2026-11-24T16:00:00.000Z' }) }))).toBe('departed');
  });

  test('a cancelled operation is cancelled whatever was recorded', () => {
    expect(flightPhase(operation({ status: 'Cancelled', milestones: [{ code: 'PUSHBACK' }] }))).toBe('cancelled');
  });
});

test('the ground time goes from the arrival’s best time to the departure’s', () => {
  const turnaround = {
    arrival: leg({ actualAt: '2026-11-24T15:05:00.000Z' }),
    departure: leg({ scheduledAt: '2026-11-24T16:30:00.000Z' }),
  };
  expect(groundTimeMinutes(turnaround)).toBe(85);
  expect(formatDuration(85)).toBe('1 h 25 min');
  expect(formatDuration(120)).toBe('2 h');
  expect(formatDuration(45)).toBe('45 min');
  expect(groundTimeMinutes({ arrival: turnaround.arrival, departure: null })).toBeNull();
});

test('the countdown is to the next movement, and says so once its time passed without an actual', () => {
  const now = Date.parse('2026-11-24T14:40:00.000Z');
  const turnaround = { arrival: leg({}), departure: leg({ scheduledAt: '2026-11-24T16:00:00.000Z' }) };
  expect(nextEvent(operation(turnaround), now)).toMatchObject({ text: 'Llega en 20 min', tone: 'info' });
  expect(nextEvent(operation({ ...turnaround, milestones: [{ code: 'BLOCK_ON' }] }), now))
    .toMatchObject({ text: 'Sale en 1 h 20 min' });
  expect(nextEvent(operation(turnaround), Date.parse('2026-11-24T15:07:00.000Z')))
    .toMatchObject({ text: 'Llegada prevista hace 7 min', tone: 'danger' });
  expect(nextEvent(operation({ departure: leg({ actualAt: '2026-11-24T16:00:00.000Z' }) }), now)).toBeNull();
});

test('the progress counts milestones of the catalog and finished services', () => {
  expect(milestoneProgress([{ code: 'BLOCK_ON' }, { code: 'BLOCK_ON' }, { code: 'UNKNOWN' }]))
    .toEqual({ done: 1, total: 5 });
  expect(serviceProgress([{ status: 'Completed' }, { status: 'NotPerformed' }, { status: 'InProgress' }]))
    .toEqual({ done: 2, total: 3 });
});

test('the airline badge is its code on a colour of its own, the same every time', () => {
  const copa = airlineBadge({ iataCode: 'CM', name: 'Copa Airlines' });
  expect(copa.initials).toBe('CM');
  expect(airlineBadge({ iataCode: 'CM' }).color).toBe(copa.color);
  expect(airlineBadge({ iataCode: '', name: 'Demo Airlines' }).initials).toBe('DA');
});
