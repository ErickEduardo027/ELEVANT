// S6 (D-S6): the incidents of an operation show their time on the station's clock, like the rest of the operation,
// never on the device's. When the tablet cannot find the operation, AVIAM's calendar (America/Santo_Domingo).
const React = require('react');
const renderer = require('react-test-renderer');

const mockGetAssigned = jest.fn();
const mockLoadCenter = jest.fn();
const operationId = '70000000-0000-4000-8000-000000000005';

jest.mock('expo-router', () => ({
  router: { back: jest.fn(), push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000005' }),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockGetAssigned(...args),
}));
jest.mock('../src/services/ramp-incidents', () => ({
  loadRampIncidentCenter: (...args) => mockLoadCenter(...args),
  reserveRampIncident: jest.fn(),
}));
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: class MobileServiceError extends Error {
    constructor(code) { super(code); this.code = code; }
  },
}));
jest.mock('../src/utils/session-navigation', () => ({ resetToLogin: jest.fn() }));
jest.mock('../src/synchronization/server-clock', () => ({ serverNow: () => new Date('2026-11-16T23:50:00.000Z') }));

const IncidentScreen = require('../src/app/incident/[id]').default;

// Monday 16 November, 23:46 UTC: 19:46 in Santo Domingo, 05:31 on the 17th in Kathmandu (UTC+5:45).
const REPORTED = '2026-11-16T23:46:00.000Z';

function operation(ianaTimeZone) {
  return {
    operation: { id: operationId, status: 'InProgress', plannedStartAt: null, plannedEndAt: null,
      actualStartAt: '2026-11-16T23:00:00Z', actualEndAt: null },
    assignment: { id: '70000000-0000-4000-8000-000000000006', assignmentRole: 'primary', position: null,
      assignedAt: '2026-11-16T12:00:00Z' },
    services: [],
    review: null,
    turnaround: { operationCode: 'EV-001', operationDate: '2026-11-16',
      station: { code: 'KTM', name: 'Tribhuvan', ianaTimeZone },
      airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null, stand: null, aircraft: null },
  };
}

function center() {
  return {
    incidents: [{ id: '90000000-0000-4000-8000-000000000001', status: 'Open', incidentType: 'Operational',
      severity: 'Medium', description: 'Retraso en la escalera', reportedAt: REPORTED }],
    outbox: [{ idempotencyKey: '82000000-0000-4000-8000-000000000001', state: 'pending', createdAt: REPORTED,
      request: { incidentType: 'Safety', severity: 'High', description: 'Derrame en la posición',
        occurredAt: REPORTED } }],
    online: true,
    sent: 0,
  };
}

function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON());
}

async function render() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(IncidentScreen)); });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLoadCenter.mockResolvedValue(center());
});

test('the reported and the saved incident read on the station’s clock', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation('Asia/Kathmandu')] });
  const tree = await render();
  const times = screenText(tree).filter(text => /^\d{1,2} [a-z]{3}\.?,? \d{2}:\d{2}$/.test(text));
  expect(times).toHaveLength(2);
  for (const time of times) expect(time).toMatch(/^17 nov\.?,? 05:31$/);
  await renderer.act(async () => tree.unmount());
});

test('without the operation the times are AVIAM’s, not the device’s', async () => {
  mockGetAssigned.mockRejectedValue(new Error('offline'));
  const tree = await render();
  const times = screenText(tree).filter(text => /^\d{1,2} [a-z]{3}\.?,? \d{2}:\d{2}$/.test(text));
  expect(times).toHaveLength(2);
  for (const time of times) expect(time).toMatch(/^16 nov\.?,? 19:46$/);
  await renderer.act(async () => tree.unmount());
});

test('a station whose zone the tablet does not know uses AVIAM’s calendar', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation('Mars/Olympus_Mons')] });
  const tree = await render();
  const times = screenText(tree).filter(text => /^\d{1,2} [a-z]{3}\.?,? \d{2}:\d{2}$/.test(text));
  expect(times).toHaveLength(2);
  for (const time of times) expect(time).toMatch(/^16 nov\.?,? 19:46$/);
  await renderer.act(async () => tree.unmount());
});
