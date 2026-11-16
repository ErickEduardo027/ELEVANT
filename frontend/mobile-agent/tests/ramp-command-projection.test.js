// 3-I: the operation screen shows ELEVANT's view with what still waits in the device's queue applied on top.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));

const { projectRampOperation } = require('../src/synchronization/ramp-command-projection');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const OTHER_OPERATION_ID = '70000000-0000-4000-8000-000000000002';
const BAGGAGE = '73000000-0000-4000-8000-000000000001';
const FUEL = '73000000-0000-4000-8000-000000000002';

function view(status = 'Assigned', services = ['Planned', 'Planned']) {
  return {
    operation: { id: OPERATION_ID, status, plannedStartAt: null, plannedEndAt: null,
      actualStartAt: status === 'Assigned' ? null : '2026-11-04T15:00:00.000Z', actualEndAt: null },
    services: [BAGGAGE, FUEL].map((id, index) => ({ id, lineNumber: index + 1, serviceDefinitionId: id, code: `S${index}`,
      name: index === 0 ? 'Equipaje' : 'Combustible', contractedQuantity: 1, executedQuantity: 0, billingUnit: 'UN',
      status: services[index] })),
  };
}

let sequence = 0;
function item(command, state = 'pending') {
  sequence += 1;
  return { idempotencyKey: `91000000-0000-4000-8000-${String(sequence).padStart(12, '0')}`, command, state, attempts: 0,
    createdAt: '2026-11-04T16:00:30.000Z', ...(state === 'blocked' ? { lastError: 'Rechazado' } : {}) };
}

const start = (occurredAt = '2026-11-04T16:00:00.000Z', operationId = OPERATION_ID) =>
  ({ kind: 'start', operationId, occurredAt });
const transition = (serviceId, targetStatus, executedQuantity = null) =>
  ({ kind: 'serviceTransition', operationId: OPERATION_ID, serviceId, targetStatus, executedQuantity, note: null,
    occurredAt: '2026-11-04T16:05:00.000Z' });

test('a start waiting on the device shows the operation in progress from the tapped time', () => {
  const projected = projectRampOperation(view(), [item(start())]);
  expect(projected.view.operation).toMatchObject({ status: 'InProgress', actualStartAt: '2026-11-04T16:00:00.000Z' });
  expect(projected).toMatchObject({ startOnDevice: true, pending: 1, blocked: 0 });
});

test('a start an older version reserved shows the time it was saved; ELEVANT’s own start wins once it arrived', () => {
  expect(projectRampOperation(view(), [item(start(null))]).view.operation.actualStartAt).toBe('2026-11-04T16:00:30.000Z');
  const confirmed = projectRampOperation(view('InProgress'), [item(start())]);
  expect(confirmed.startOnDevice).toBe(false);
  expect(confirmed.view.operation.actualStartAt).toBe('2026-11-04T15:00:00.000Z');
});

test('queued transitions apply in order per service; a refused one keeps ELEVANT’s state and is reported', () => {
  const refused = item(transition(FUEL, 'Completed', 1), 'blocked');
  const projected = projectRampOperation(view('InProgress'), [item(transition(BAGGAGE, 'InProgress')),
    item(transition(BAGGAGE, 'Completed', 3)), refused]);
  expect(projected.view.services.map(service => [service.status, service.executedQuantity]))
    .toEqual([['Completed', 3], ['Planned', 0]]);
  expect([...projected.servicesOnDevice]).toEqual([BAGGAGE]);
  expect(projected.servicesRefused.get(FUEL)).toBe(refused);
  expect(projected).toMatchObject({ pending: 2, blocked: 1 });
});

test('a refused start leaves the operation assigned and is reported; another operation’s queue is ignored', () => {
  const refused = item(start(), 'blocked');
  const projected = projectRampOperation(view(), [refused, item(start('2026-11-04T16:01:00.000Z', OTHER_OPERATION_ID))]);
  expect(projected.view.operation.status).toBe('Assigned');
  expect(projected.startOnDevice).toBe(false);
  expect(projected.startRefused).toBe(refused);
  expect(projected).toMatchObject({ pending: 0, blocked: 1 });
});
