const React = require('react');
const renderer = require('react-test-renderer');
const mockGetAssigned = jest.fn();
const mockReadSubmission = jest.fn(async () => null);
const mockReadCorrection = jest.fn(async () => false);
const mockCard = jest.fn(() => null);

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000005' }),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
// 3-I: the screen projects the device's queue; here it is empty.
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/services/flight-report', () => ({
  subscribeFlightReport: listener => { listener({ items: [], revisions: {} }); return () => {}; },
}));
jest.mock('../src/services/mobile-service-error', () => ({ explainsProblem: () => false }));
jest.mock('../src/services/mobile-change-feed', () => ({ subscribeMobileChanges: () => () => {} }));
jest.mock('../src/components/flight-report/connection-badge', () => ({ ConnectionBadge: () => null }));
jest.mock('../src/components/documents/operation-documents', () => ({ DocumentsPanel: () => null, WalkaroundCard: () => null }));
jest.mock('../src/components/documents/charter-card', () => ({ CharterCard: () => null }));
jest.mock('../src/components/flight-report/flight-report-panel', () => ({
  FlightReportPanel: () => null, FlightDataCard: () => null, DeviationAction: () => null,
}));
jest.mock('../src/components/attendance-draft-card', () => ({
  AttendanceDraftCard: props => mockCard(props),
}));
jest.mock('../src/components/ramp-operation-charges-card', () => ({
  RampOperationChargesCard: () => null,
}));
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockGetAssigned(...args),
}));
jest.mock('../src/services/ramp-operation-submission', () => ({
  readRampOperationPendingSubmission: (...args) => mockReadSubmission(...args),
  submitRampOperation: jest.fn(),
}));
jest.mock('../src/services/ramp-operation-correction', () => ({
  readPendingRampCorrection: (...args) => mockReadCorrection(...args),
  reopenRampOperationCorrection: jest.fn(),
}));
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: class MobileServiceError extends Error {},
}));
jest.mock('../src/services/ramp-operation-start', () => ({
  startAssignedRampOperation: jest.fn(),
}));
jest.mock('../src/services/ramp-operation-service-execution', () => ({
  readRampOperationServicePendingTransition: jest.fn(async () => null),
  transitionRampOperationService: jest.fn(),
}));
// N1: the close reads the operation's checklist and counts its incident reports still on the device.
jest.mock('../src/services/ramp-operation-checklist', () => ({
  getRampOperationChecklist: jest.fn(async () => ({ fromCache: false, checklist: { status: 'Submitted' } })),
}));
jest.mock('../src/services/ramp-incidents', () => ({ countUnsentRampIncidents: jest.fn(async () => 0) }));

const Screen = require('../src/app/flight/[id]').default;
const operationId = '70000000-0000-4000-8000-000000000005';
const assignmentId = '70000000-0000-4000-8000-000000000006';
function assigned(assignment = assignmentId) {
  return { operation: { id: operationId, status: 'Assigned',
    plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null },
  assignment: { id: assignment, assignmentRole: 'Agente', position: null,
    assignedAt: '2026-10-05T10:00:00Z' }, services: [], review: null,
  turnaround: { operationCode: 'EV-001', operationDate: '2026-10-05',
    station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null,
    stand: null, aircraft: null } };
}

beforeEach(() => { jest.clearAllMocks(); mockGetAssigned.mockResolvedValue({
  source: 'network', operations: [assigned()],
}); });

test('mounts assistance only for the assigned operation and assignment IDs', async () => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  expect(mockCard).toHaveBeenCalled();
  expect(mockCard.mock.lastCall[0]).toMatchObject({ operationId, assignmentId, active: true });
  await renderer.act(async () => tree.unmount());
});

test('does not mount assistance if the assignment identifier is missing', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [assigned(null)] });
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  expect(mockCard).not.toHaveBeenCalled();
  await renderer.act(async () => tree.unmount());
});

// S6 (D-S6): the card gets the station's zone and code, and the flights' times say whose clock they use, «Hora local
// de PUJ», never the zone's IANA id.
test('passes the station’s zone and code to assistance and names the station’s clock', async () => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  expect(mockCard.mock.lastCall[0]).toMatchObject({ timeZone: 'America/Santo_Domingo', stationCode: 'PUJ' });
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  const texts = collect(tree.toJSON());
  expect(texts).toContain('Hora local de PUJ');
  expect(texts.join(' ')).not.toContain('America/Santo_Domingo');
  expect(texts.join(' ')).not.toContain('Horario local');
  await renderer.act(async () => tree.unmount());
});

// N8: the card shows OCC's hours on the operation's day without their date, so it needs that day.
test('passes the operation’s day to assistance', async () => {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  expect(mockCard.mock.lastCall[0]).toMatchObject({ operationDate: '2026-10-05' });
  await renderer.act(async () => tree.unmount());
});
