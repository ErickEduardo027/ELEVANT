// N11 (D-N11, D-S6): the start screen writes its times like the rest of the tablet, on a 24-hour clock and in the
// station's local time: the saved copy's «última actualización» and the windows of «Mis posiciones de hoy». The zone
// comes from the operations the tablet already has; a station it knows no zone for uses AVIAM's calendar.
const React = require('react');
const renderer = require('react-test-renderer');

const mockGetAssigned = jest.fn();
const mockGetOwnCoverage = jest.fn();

jest.mock('@elevant/api-client', () => ({ ElevantApiError: class ElevantApiError extends Error {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/services/mobile-change-feed', () => ({ subscribeMobileChanges: () => () => {} }));
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockGetAssigned(...args),
}));
jest.mock('../src/services/ramp-coverage', () => ({ getOwnCoverage: (...args) => mockGetOwnCoverage(...args) }));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSession: jest.fn(async () => ({ actor: {
    accountId: '10000000-0000-4000-8000-000000000001', email: 'ramp.agent@dev.elevant.test', displayName: 'Agente de prueba',
    stationScopes: [{ stationId: '20000000-0000-4000-8000-000000000001', stationCode: 'JFK' }],
  } })),
  logoutMobileAgent: jest.fn(),
  readUnsentRecords: jest.fn(async () => null),
  MobileServiceError: jest.requireActual('../src/services/mobile-service-error').MobileServiceError,
}));
jest.mock('../src/utils/app-exit', () => ({ exitApplication: jest.fn() }));
jest.mock('../src/utils/session-navigation', () => ({ resetToLogin: jest.fn() }));
jest.mock('../src/app/flight/[id]', () => ({ OperationDetail: () => null }));
// The header's sync state has its own test (connection-badge.test.js).
jest.mock('../src/components/flight-report/connection-badge', () => ({ ConnectionBadge: () => null }));

const HomeScreen = require('../src/app/home').default;

// A station outside the Dominican Republic: New York is UTC−5 in November, the device is not.
function operation() {
  return {
    operation: { id: '70000000-0000-4000-8000-000000000001', status: 'Assigned', plannedStartAt: '2026-11-17T00:46:00Z',
      plannedEndAt: null, actualStartAt: null, actualEndAt: null },
    assignment: { id: '70000000-0000-4000-8000-000000000002', assignmentRole: 'primary', position: null,
      assignedAt: '2026-11-16T12:00:00Z' },
    services: [],
    review: null,
    turnaround: { operationCode: 'EV-001', operationDate: '2026-11-16',
      station: { code: 'JFK', name: 'John F. Kennedy', ianaTimeZone: 'America/New_York' },
      airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null, stand: null, aircraft: null },
  };
}

function coverage(id, stationCode) {
  return { id, stationCode, terminalCode: 'T4', stands: ['B21'], startsAt: '2026-11-16T23:00:00Z',
    endsAt: '2026-11-17T07:00:00Z', partner: null, vehicleCode: null, isReinforcement: false };
}

function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join('');
}

async function render() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(HomeScreen)); });
  return tree;
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAssigned.mockResolvedValue({ source: 'cache', updatedAt: '2026-11-17T00:46:00.000Z', operations: [operation()] });
  mockGetOwnCoverage.mockResolvedValue({ coverages: [coverage('c1', 'JFK')] });
});

test('the saved copy says when it was updated in the station’s time, on a 24-hour clock', async () => {
  const tree = await render();
  expect(screenText(tree)).toMatch(/Sin conexión · última actualización 16 nov\.?,? 19:46/);
  expect(screenText(tree)).not.toMatch(/[ap]\.\s?m\./);
  await renderer.act(async () => tree.unmount());
});

test('«Mis posiciones de hoy» shows each window in its station’s time', async () => {
  mockGetOwnCoverage.mockResolvedValue({ coverages: [coverage('c1', 'JFK'), coverage('c2', 'SDQ')] });
  const tree = await render();
  const text = screenText(tree);
  // JFK: 18:00 to 02:00 in New York. SDQ: no operation names its zone, so AVIAM's calendar (UTC−4).
  expect(text).toContain('Terminal T4 · 18:00–02:00');
  expect(text).toContain('Terminal T4 · 19:00–03:00');
  await renderer.act(async () => tree.unmount());
});
