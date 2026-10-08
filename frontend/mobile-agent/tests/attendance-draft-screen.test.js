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
