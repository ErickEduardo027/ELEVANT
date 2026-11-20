// N6: when the tablet cannot keep a start, a service change or the hand-off, the operation's screen says what happened
// and what to do, in plain words: never «Desbloquea» (on Android the lock is never the cause) nor «payload». The screen
// is real; its services are doubles, as in contract-not-in-force.test.js.
const React = require('react');
const renderer = require('react-test-renderer');
const mockGetAssigned = jest.fn();
const mockStart = jest.fn();
const mockTransition = jest.fn();
const mockSubmit = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {},
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
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
jest.mock('../src/services/mobile-change-feed', () => ({ subscribeMobileChanges: () => () => {} }));
jest.mock('../src/components/flight-report/connection-badge', () => ({ ConnectionBadge: () => null }));
jest.mock('../src/components/documents/operation-documents', () => ({ DocumentsPanel: () => null, WalkaroundCard: () => null }));
jest.mock('../src/components/documents/charter-card', () => ({ CharterCard: () => null }));
jest.mock('../src/components/flight-report/flight-report-panel', () => ({
  FlightReportPanel: () => null, FlightDataCard: () => null, DeviationAction: () => null,
}));
jest.mock('../src/components/attendance-draft-card', () => ({ AttendanceDraftCard: () => null }));
jest.mock('../src/components/ramp-operation-charges-card', () => ({ RampOperationChargesCard: () => null }));
jest.mock('../src/services/assigned-operations', () => ({
  getAssignedOperations: (...args) => mockGetAssigned(...args),
}));
jest.mock('../src/services/ramp-operation-submission', () => ({
  readRampOperationPendingSubmission: jest.fn(async () => null),
  submitRampOperation: (...args) => mockSubmit(...args),
}));
jest.mock('../src/services/ramp-operation-correction', () => ({
  readPendingRampCorrection: jest.fn(async () => false),
  reopenRampOperationCorrection: jest.fn(),
}));
// The screen sees the real error class, so each notice comes from the code the service kept.
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: jest.requireActual('../src/services/mobile-service-error').MobileServiceError,
}));
jest.mock('../src/services/ramp-operation-start', () => ({
  startAssignedRampOperation: (...args) => mockStart(...args),
}));
jest.mock('../src/services/ramp-operation-service-execution', () => ({
  readRampOperationServicePendingTransition: jest.fn(async () => null),
  transitionRampOperationService: (...args) => mockTransition(...args),
}));

const { Alert } = require('react-native');
const { MobileServiceError } = require('../src/services/mobile-service-error');
const Screen = require('../src/app/flight/[id]').default;

const operationId = '70000000-0000-4000-8000-000000000005';
const serviceId = '73000000-0000-4000-8000-000000000001';
/** The jargon and the advice the old notices gave: neither belongs in front of a ramp agent (N6). */
const JARGON_OR_LOCK = /payload|idempotente|Desbloque/i;
const WHAT_TO_DO = 'Vuelve a intentarlo; si sigue fallando, cierra la app, ábrela de nuevo y avisa a OCC.';

function assigned(status, serviceStatus) {
  return { operation: { id: operationId, status,
    plannedStartAt: null, plannedEndAt: null, actualStartAt: status === 'Assigned' ? null : '2026-10-05T10:05:00Z',
    actualEndAt: null },
  assignment: { id: '70000000-0000-4000-8000-000000000006', assignmentRole: 'Agente', position: null,
    assignedAt: '2026-10-05T10:00:00Z' },
  services: serviceStatus ? [{ id: serviceId, lineNumber: 1, serviceDefinitionId: serviceId, code: 'BAGGAGE',
    name: 'Equipaje', contractedQuantity: 1, executedQuantity: serviceStatus === 'Completed' ? 1 : 0,
    billingUnit: 'operation', status: serviceStatus }] : [],
  review: null,
  turnaround: { operationCode: 'EV-001', operationDate: '2026-10-05',
    station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null,
    stand: null, aircraft: null } };
}

/** The rendered text of the screen (the host tree carries circular props, so only its children are read). */
function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}

async function render(operation) {
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation] });
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  return tree;
}

async function press(tree, title) {
  const [button] = tree.root.findAll(node => node.props?.title === title && typeof node.props.onPress === 'function');
  expect(button).toBeDefined();
  await renderer.act(async () => { button.props.onPress(); });
}

beforeEach(() => {
  jest.clearAllMocks();
});

test('a start the tablet could not keep says so and what to do, without jargon', async () => {
  mockStart.mockRejectedValue(new MobileServiceError('storage_unavailable'));
  const tree = await render(assigned('Assigned'));
  await press(tree, 'INICIAR OPERACIÓN');

  const text = screenText(tree);
  expect(text).toContain('Inicio no guardado');
  expect(text).toContain(`La tablet no pudo guardar el inicio. ${WHAT_TO_DO}`);
  expect(text).not.toMatch(JARGON_OR_LOCK);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('a service change the tablet could not keep says so and what to do, without jargon', async () => {
  mockTransition.mockRejectedValue(new MobileServiceError('storage_unavailable'));
  const tree = await render(assigned('InProgress', 'Planned'));
  await press(tree, 'INICIAR SERVICIO');

  expect(mockTransition).toHaveBeenCalledWith(operationId, serviceId, { targetStatus: 'InProgress' },
    expect.objectContaining({ serviceName: 'Equipaje' }));
  const text = screenText(tree);
  expect(text).toContain('Cambio no guardado');
  expect(text).toContain(`La tablet no pudo guardar el cambio del servicio. ${WHAT_TO_DO}`);
  expect(text).not.toMatch(JARGON_OR_LOCK);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('a hand-off the tablet could not keep says so and what to do, without jargon', async () => {
  // The agent confirms the hand-off in the dialog.
  const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
  try {
    mockSubmit.mockRejectedValue(new MobileServiceError('storage_unavailable'));
    const tree = await render(assigned('InProgress', 'Completed'));
    await press(tree, 'ENTREGAR A OCC');

    expect(mockSubmit).toHaveBeenCalled();
    const text = screenText(tree);
    expect(text).toContain('Entrega no guardada');
    expect(text).toContain(`La tablet no pudo guardar la entrega. ${WHAT_TO_DO}`);
    expect(text).not.toMatch(JARGON_OR_LOCK);
    await renderer.act(async () => tree.unmount());
  } finally {
    alert.mockRestore();
  }
}, 30_000);
