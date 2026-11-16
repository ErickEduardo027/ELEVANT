// 3-I: the operation screen works from the saved copy. «Iniciar» and the services are saved in the device's queue with
// their time, the queue is shown applied on ELEVANT's view, and what ELEVANT refused is explained.
const React = require('react');
const renderer = require('react-test-renderer');
const mockGetAssigned = jest.fn();
const mockStart = jest.fn();
const mockTransition = jest.fn();
let mockQueue = { items: [], revisions: {} };

jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {},
}));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
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
jest.mock('../src/services/flight-report', () => ({
  subscribeFlightReport: listener => { listener(mockQueue); return () => {}; },
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
  submitRampOperation: jest.fn(),
}));
jest.mock('../src/services/ramp-operation-correction', () => ({
  readPendingRampCorrection: jest.fn(async () => false),
  reopenRampOperationCorrection: jest.fn(),
}));
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: jest.requireActual('../src/services/mobile-service-error').MobileServiceError,
}));
jest.mock('../src/services/ramp-operation-start', () => ({
  startAssignedRampOperation: (...args) => mockStart(...args),
}));
jest.mock('../src/services/ramp-operation-service-execution', () => ({
  transitionRampOperationService: (...args) => mockTransition(...args),
}));

const Screen = require('../src/app/flight/[id]').default;

const operationId = '70000000-0000-4000-8000-000000000005';
const serviceId = '73000000-0000-4000-8000-000000000001';

function operation(status = 'Assigned', serviceStatus = 'Planned') {
  return { operation: { id: operationId, status, plannedStartAt: null, plannedEndAt: null,
    actualStartAt: status === 'Assigned' ? null : '2026-10-05T14:00:00Z', actualEndAt: null },
  assignment: { id: '70000000-0000-4000-8000-000000000006', assignmentRole: 'Agente', position: null,
    assignedAt: '2026-10-05T10:00:00Z' },
  services: [{ id: serviceId, lineNumber: 1, serviceDefinitionId: serviceId, code: 'BAG', name: 'Equipaje',
    contractedQuantity: 1, executedQuantity: 0, billingUnit: 'operation', status: serviceStatus }],
  review: null,
  turnaround: { operationCode: 'EV-001', operationDate: '2026-10-05',
    station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
    airline: { name: 'ELEVANT Demo Airlines' }, arrival: null, departure: null, stand: null, aircraft: null } };
}

function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}

async function render() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(Screen)); });
  return tree;
}

const button = (tree, title) => tree.root.findAll(node => node.props?.title === title &&
  typeof node.props.onPress === 'function')[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockQueue = { items: [], revisions: {} };
});

test('without signal «Iniciar» stays available on the saved copy and the tap is kept on the device', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'cache', operations: [operation()] });
  mockStart.mockResolvedValue({ state: 'queued', startedAt: '2026-10-05T14:00:00.000Z' });
  const tree = await render();
  const start = button(tree, 'INICIAR OPERACIÓN');
  expect(start.props.disabled).toBe(false);
  await renderer.act(async () => { start.props.onPress(); });
  expect(mockStart).toHaveBeenCalledWith(operationId, expect.objectContaining({ timeZone: 'America/Santo_Domingo' }));
  expect(screenText(tree)).toContain('Inicio guardado en el dispositivo');
  await renderer.act(async () => tree.unmount());
});

test('a start waiting in the queue shows the operation running and its services can be recorded', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'cache', operations: [operation()] });
  mockQueue = { revisions: {}, items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000001', state: 'pending',
    attempts: 0, createdAt: '2026-10-05T14:00:00.000Z',
    command: { kind: 'start', operationId, occurredAt: '2026-10-05T14:00:00.000Z' } }] };
  mockTransition.mockResolvedValue({ state: 'queued' });
  const tree = await render();
  const text = screenText(tree);
  expect(text).toContain('Inicio guardado en el dispositivo');
  expect(text).toContain('se envía a ELEVANT en cuanto haya señal');
  const card = tree.root.findAll(node => node.props?.service?.id === serviceId && 'actionable' in node.props)[0];
  expect(card.props.actionable).toBe(true);
  await renderer.act(async () => { card.props.onTransition({ targetStatus: 'InProgress' }); });
  expect(mockTransition).toHaveBeenCalledWith(operationId, serviceId, { targetStatus: 'InProgress' },
    expect.objectContaining({ serviceName: 'Equipaje', timeZone: 'America/Santo_Domingo' }));
  expect(screenText(tree)).toContain('Guardado en el dispositivo');
  await renderer.act(async () => tree.unmount());
});

test('a start ELEVANT refused is explained and «Iniciar» is offered again', async () => {
  mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation()] });
  mockQueue = { revisions: {}, items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000001', state: 'blocked',
    attempts: 1, createdAt: '2026-10-05T14:00:00.000Z', lastError: 'La hora queda fuera de la ventana de la operación.',
    command: { kind: 'start', operationId, occurredAt: '2026-10-05T14:00:00.000Z' } }] };
  const tree = await render();
  expect(screenText(tree)).toContain('ELEVANT rechazó el inicio guardado en el dispositivo');
  expect(screenText(tree)).toContain('La hora queda fuera de la ventana de la operación.');
  expect(button(tree, 'INICIAR OPERACIÓN').props.disabled).toBe(false);
  await renderer.act(async () => tree.unmount());
});

describe('hand-off to OCC (3-N06)', () => {
  const ready = () => ({ source: 'network', operations: [operation('InProgress', 'Completed')] });
  const signed = isFullySigned => ({ [operationId]: { operationId, damageMarks: [],
    documents: [{ kind: 'ServiceOrder', isFullySigned, staleRoles: [] }] } });

  test('waits while records are still on the device and points to «Sincronización»', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, documents: signed(true), items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000002',
      state: 'pending', attempts: 1, createdAt: '2026-10-05T14:30:00.000Z',
      command: { kind: 'milestone', operationId, code: 'BLOCK_ON', occurredAt: '2026-10-05T14:30:00.000Z' } }] };
    const tree = await render();
    expect(screenText(tree)).toContain('Faltan 1 registro por enviar a ELEVANT: abre Sincronización.');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    await renderer.act(async () => { button(tree, 'ABRIR SINCRONIZACIÓN').props.onPress(); });
    expect(require('expo-router').router.push).toHaveBeenCalledWith('/sync');
    await renderer.act(async () => tree.unmount());
  });

  test('waits for the signed Service Order and hands off once everything reached ELEVANT', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, items: [], documents: signed(false) };
    let tree = await render();
    expect(screenText(tree)).toContain('Falta firmar la Orden de Servicio (aerolínea y AVIAM).');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    await renderer.act(async () => tree.unmount());

    mockQueue = { revisions: {}, items: [], documents: signed(true) };
    tree = await render();
    expect(screenText(tree)).not.toContain('Falta firmar');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(false);
    await renderer.act(async () => tree.unmount());
  });
});
