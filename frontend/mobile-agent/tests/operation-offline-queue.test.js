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
  assignment: { id: '70000000-0000-4000-8000-000000000006', assignmentRole: 'primary', position: null,
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

describe('one date and time format (N11, D-N11)', () => {
  test('the start and the assignment read «5 oct, 10:00» in the station’s time, on a 24-hour clock', async () => {
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation('InProgress')] });
    const tree = await render();
    const text = screenText(tree);
    // 14:00 UTC is 10:00 at Punta Cana; OCC assigned it at 06:00.
    expect(text).toMatch(/Inicio registrado 5 oct\.?,? 10:00/);
    expect(text).toMatch(/Asignada 5 oct\.?,? 06:00/);
    expect(text).toMatch(/lun\.?, 5 oct/);
    expect(text).not.toMatch(/[ap]\.\s?m\./);
    await renderer.act(async () => tree.unmount());
  });

  test('a start kept on the device shows its time in the same format', async () => {
    mockGetAssigned.mockResolvedValue({ source: 'cache', operations: [operation()] });
    mockQueue = { revisions: {}, items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000001', state: 'pending',
      attempts: 0, createdAt: '2026-10-05T14:00:00.000Z',
      command: { kind: 'start', operationId, occurredAt: '2026-10-05T14:00:00.000Z' } }] };
    const tree = await render();
    expect(screenText(tree)).toMatch(/Inicio guardado en el dispositivo 5 oct\.?,? 10:00 · se envía a ELEVANT/);
    await renderer.act(async () => tree.unmount());
  });

  test('an airport name is not cut to a fixed 76 dp column', async () => {
    const withLeg = operation('InProgress');
    withLeg.turnaround = { ...withLeg.turnaround, arrival: { flightNumber: 'EV101', scheduledAt: '2026-10-05T13:30:00Z',
      estimatedAt: null, actualAt: null, origin: { iataCode: 'BWI', name: 'Baltimore/Washington International' },
      destination: { iataCode: 'PUJ', name: 'Punta Cana Development' } } };
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [withLeg] });
    const tree = await render();
    const name = tree.root.findAll(node => node.type === 'Text' && node.props.children === 'Punta Cana Development')[0];
    let airport = name.parent;
    while (airport && airport.type !== 'View') airport = airport.parent;
    const style = require('react-native').StyleSheet.flatten(airport.props.style);
    expect(style.width).toBeUndefined();
    expect(style).toEqual(expect.objectContaining({ flexShrink: 1, minWidth: 76, maxWidth: '40%' }));
    await renderer.act(async () => tree.unmount());
  });
});

describe('billing units in Spanish (S5, D-S5)', () => {
  test('a service reads «0 / 1 operación» and the manifest never shows the unit code', async () => {
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation('InProgress')] });
    const tree = await render();
    const text = screenText(tree);
    expect(text).toContain('0 / 1 operación');
    expect(text).not.toMatch(/\boperation\b/);
    await renderer.act(async () => tree.unmount());
  });
});

describe('a readable assignment (N9, D-N9)', () => {
  const { Card } = require('../src/components/ui');
  const ASSIGNED_AT = /^Asignada 5 oct\.?,? 06:00$/;

  function assigned(assignment) {
    const value = operation('InProgress');
    return { ...value, assignment: { ...value.assignment, ...assignment } };
  }

  // The lines of the «Asignación» card, the one that says when OCC assigned the operation.
  function assignmentLines(tree) {
    const lines = node => node.findAll(child => child.type === 'Text' && typeof child.props.children === 'string')
      .map(child => child.props.children);
    const [card] = tree.root.findAll(node => node.type === Card)
      .filter(node => lines(node).some(line => line.startsWith('Asignada ')));
    return lines(card);
  }

  test('the role reads «Agente principal» and the position only by its name', async () => {
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [assigned({ assignmentRole: 'primary',
      position: { id: '74000000-0000-4000-8000-000000000001', code: 'RAMP-AGENT', name: 'Ramp agent' } })] });
    const tree = await render();
    const lines = assignmentLines(tree);
    expect(lines).toEqual(['Agente principal', 'Ramp agent', expect.stringMatching(ASSIGNED_AT)]);
    // The 12-hour check, scoped to the card: «Asignada …» is on a 24-hour clock.
    expect(lines.join(' ')).not.toMatch(/[ap]\.\s?m\./);
    const text = screenText(tree);
    expect(text).not.toMatch(/\bprimary\b/i);
    expect(text).not.toContain('RAMP-AGENT');
    await renderer.act(async () => tree.unmount());
  });

  test('without a position the card says so, and a role this version does not know is left out', async () => {
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [assigned({ assignmentRole: 'RampAgent',
      position: null })] });
    const tree = await render();
    expect(assignmentLines(tree)).toEqual(['Posición operativa no especificada', expect.stringMatching(ASSIGNED_AT)]);
    expect(screenText(tree)).not.toContain('RampAgent');
    await renderer.act(async () => tree.unmount());
  });
});
