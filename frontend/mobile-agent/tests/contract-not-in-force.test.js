// 3-N04: when the airline's contract is no longer in force the server refuses «Iniciar» with 409
// `contract_not_in_force`; the tablet keeps the code and explains it in Spanish, while every screen keeps reacting to
// the generic conflict the deployed APK already knows.
const React = require('react');
const renderer = require('react-test-renderer');
const mockGetAssigned = jest.fn();
const mockStart = jest.fn();

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind, status, traceId, code }) {
      super(`Elevant API error ${status}`);
      this.name = 'ElevantApiError';
      this.kind = kind;
      this.status = status;
      this.traceId = traceId;
      this.code = code;
    }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000005' }),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
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
  submitRampOperation: jest.fn(),
}));
jest.mock('../src/services/ramp-operation-correction', () => ({
  readPendingRampCorrection: jest.fn(async () => false),
  reopenRampOperationCorrection: jest.fn(),
}));
// The screen sees the real error class, so the notice comes from the code the service kept.
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: jest.requireActual('../src/services/mobile-service-error').MobileServiceError,
}));
jest.mock('../src/services/ramp-operation-start', () => ({
  startAssignedRampOperation: (...args) => mockStart(...args),
}));
jest.mock('../src/services/ramp-operation-service-execution', () => ({
  readRampOperationServicePendingTransition: jest.fn(async () => null),
  transitionRampOperationService: jest.fn(),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { asMobileServiceError, MobileServiceError } = require('../src/services/mobile-service-error');
const Screen = require('../src/app/flight/[id]').default;

const CONTRACT_MESSAGE = 'El contrato de la aerolínea no está vigente. No inicies la operación y avisa a OCC.';
const operationId = '70000000-0000-4000-8000-000000000005';

function assigned() {
  return { operation: { id: operationId, status: 'Assigned',
    plannedStartAt: null, plannedEndAt: null, actualStartAt: null, actualEndAt: null },
  assignment: { id: '70000000-0000-4000-8000-000000000006', assignmentRole: 'Agente', position: null,
    assignedAt: '2026-10-05T10:00:00Z' }, services: [], review: null,
  turnaround: { operationCode: 'EV-001', operationDate: '2026-10-05',
    station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null,
    stand: null, aircraft: null } };
}

/** The rendered text of the screen (the host tree carries circular props, so only its children are read). */
function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === "string" ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(" ");
}

beforeEach(() => {
  jest.clearAllMocks();
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [assigned()] });
});

describe('Problem Details code of a refused command', () => {
  test('keeps contract_not_in_force on the conflict and explains it in Spanish', () => {
    const error = asMobileServiceError(
      new ElevantApiError({ kind: 'http', status: 409, code: 'contract_not_in_force' }));
    expect(error).toBeInstanceOf(MobileServiceError);
    expect(error).toMatchObject({ code: 'conflict', status: 409, problemCode: 'contract_not_in_force',
      retryable: false, message: CONTRACT_MESSAGE });
  });

  test('a conflict without a code, or with one the tablet does not know, keeps the generic message', () => {
    const plain = asMobileServiceError(new ElevantApiError({ kind: 'http', status: 409 }));
    expect(plain).toMatchObject({ code: 'conflict', problemCode: undefined,
      message: 'La operación cambió y debe actualizarse.' });
    const unknown = asMobileServiceError(new ElevantApiError({ kind: 'http', status: 409, code: 'some_new_rule' }));
    expect(unknown).toMatchObject({ code: 'conflict', problemCode: 'some_new_rule',
      message: 'La operación cambió y debe actualizarse.' });
  });

  test('drops a code that is not a Problem Details code and never names the cause of a session failure', () => {
    expect(new MobileServiceError('conflict', { problemCode: 'Bad <code>' }).problemCode).toBeUndefined();
    expect(asMobileServiceError(new ElevantApiError({ kind: 'http', status: 404, code: 'not_found' })))
      .toMatchObject({ code: 'not_found', problemCode: 'not_found', message: 'La operación ya no está disponible.' });
    expect(asMobileServiceError(new ElevantApiError({ kind: 'http', status: 401, code: 'contract_not_in_force' })))
      .toMatchObject({ code: 'unauthenticated', problemCode: undefined });
  });
});

describe('«Iniciar» of an operation whose contract is no longer in force', () => {
  test('shows why it does not start and reads the operation again', async () => {
    mockStart.mockRejectedValue(new MobileServiceError('conflict', { status: 409, problemCode: 'contract_not_in_force' }));
    let tree;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
    const start = tree.root.findAll(node => node.props?.title === 'INICIAR OPERACIÓN' &&
      typeof node.props.onPress === 'function')[0];
    expect(start).toBeDefined();
    await renderer.act(async () => { start.props.onPress(); });

    expect(mockStart).toHaveBeenCalledWith(operationId, expect.objectContaining({ signal: expect.anything() }));
    const text = screenText(tree);
    expect(text).toContain('Contrato no vigente');
    expect(text).toContain(CONTRACT_MESSAGE);
    expect(text).not.toContain('La operación cambió');
    // The conflict is a refresh signal, as for the deployed APK: the detail is read again.
    expect(mockGetAssigned).toHaveBeenCalledTimes(2);
    await renderer.act(async () => tree.unmount());
  });

  test('a conflict without the code keeps the generic notice', async () => {
    mockStart.mockRejectedValue(new MobileServiceError('conflict', { status: 409 }));
    let tree;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
    const start = tree.root.findAll(node => node.props?.title === 'INICIAR OPERACIÓN' &&
      typeof node.props.onPress === 'function')[0];
    await renderer.act(async () => { start.props.onPress(); });
    const text = screenText(tree);
    expect(text).toContain('La operación cambió');
    expect(text).not.toContain('Contrato no vigente');
    await renderer.act(async () => tree.unmount());
  });
});
