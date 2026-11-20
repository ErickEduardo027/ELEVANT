// 3-I: the operation screen works from the saved copy. «Iniciar» and the services are saved in the device's queue with
// their time, the queue is shown applied on ELEVANT's view, and what ELEVANT refused is explained.
const React = require('react');
const renderer = require('react-test-renderer');
const mockGetAssigned = jest.fn();
const mockStart = jest.fn();
const mockTransition = jest.fn();
const mockChecklist = jest.fn();
const mockUnsentIncidents = jest.fn();
let mockQueue = { items: [], revisions: {} };
// The screen's subscriptions, so a test moves the queue or announces a change of the operation.
const mockQueueListeners = new Set();
const mockChangeListeners = new Set();

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
  router: { push: jest.fn(), replace: jest.fn(), dismissAll: jest.fn() },
  useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000005' }),
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/services/flight-report', () => ({
  subscribeFlightReport: listener => {
    mockQueueListeners.add(listener);
    listener(mockQueue);
    return () => { mockQueueListeners.delete(listener); };
  },
}));
jest.mock('../src/services/mobile-change-feed', () => ({
  subscribeMobileChanges: listener => {
    mockChangeListeners.add(listener);
    return () => { mockChangeListeners.delete(listener); };
  },
}));
// N1: the screen reads the operation's checklist and counts the incident reports still on the device.
jest.mock('../src/services/ramp-operation-checklist', () => ({
  getRampOperationChecklist: (...args) => mockChecklist(...args),
}));
jest.mock('../src/services/ramp-incidents', () => ({
  countUnsentRampIncidents: (...args) => mockUnsentIncidents(...args),
}));
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
  mockQueueListeners.clear();
  mockChangeListeners.clear();
  // ELEVANT already has the checklist as sent and nothing of the operation's incidents waits on the device.
  mockChecklist.mockReset();
  mockChecklist.mockResolvedValue({ operationId, fromCache: false,
    checklist: { id: '72000000-0000-4000-8000-000000000001', status: 'Submitted' } });
  mockUnsentIncidents.mockReset();
  mockUnsentIncidents.mockResolvedValue(0);
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
    expect(screenText(tree)).toContain('Falta 1 registro por enviar a ELEVANT: abre Sincronización.');
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

  // N3 (D-N3): the forms that say «No hace falta para entregar a OCC» really do not hold the hand-off.
  test('an unsigned Flight Report or bridge checklist does not hold the hand-off', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, items: [], documents: { [operationId]: { operationId, damageMarks: [], documents: [
      { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [] },
      { kind: 'FlightReport', isFullySigned: false, staleRoles: [] },
      { kind: 'BridgeChecklist', isFullySigned: false, staleRoles: ['BridgeOperator'] },
    ] } } };
    const tree = await render();
    expect(screenText(tree)).not.toContain('Falta firmar');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(false);
    await renderer.act(async () => tree.unmount());
  });

  test('the forms panel hears the execution is open only while the operation is in progress', async () => {
    const { DocumentsPanel } = require('../src/components/documents/operation-documents');
    mockGetAssigned.mockResolvedValue(ready());
    let tree = await render();
    expect(tree.root.findByType(DocumentsPanel).props).toEqual(expect.objectContaining({ operationId, editable: true,
      executionOpen: true }));
    await renderer.act(async () => tree.unmount());

    // Handed off: the forms can still be signed, but the hand-off is behind.
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [operation('PendingReview', 'Completed')] });
    tree = await render();
    expect(tree.root.findByType(DocumentsPanel).props).toEqual(expect.objectContaining({ operationId, editable: true,
      executionOpen: false }));
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

// N1: with the checklist at 0/21 the close asked only for the signature, a native dialog asked the agent to confirm
// what the tablet can check, and after the hand-off the checklist no longer opened. The close now lists every
// requirement with its state, checks them, and confirms in the tablet's own sheet.
describe('the close lists and checks every requirement (N1)', () => {
  const { Alert } = require('react-native');
  const { MobileServiceError } = require('../src/services/mobile-service-error');
  const router = () => require('expo-router').router;
  const submission = () => require('../src/services/ramp-operation-submission');
  const correction = () => require('../src/services/ramp-operation-correction');
  const CHECKLIST_ID = '72000000-0000-4000-8000-000000000001';
  const read = (status, fromCache = false) => ({ operationId, fromCache, checklist: { id: CHECKLIST_ID, status } });
  const signedOrder = { [operationId]: { operationId, damageMarks: [], documents: [
    { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [] }] } };
  const ROW = /^(Servicios terminados|Checklist enviado|Incidencias enviadas|Orden de Servicio firmada|Registros enviados a ELEVANT): /;

  /** What each requirement row says to a screen reader: «label: state[. detail]». */
  const rows = scope => scope.findAll(node => node.type === 'View' && node.props.accessible === true &&
    ROW.test(node.props.accessibilityLabel ?? '')).map(node => node.props.accessibilityLabel);
  const missing = scope => rows(scope).filter(label => /^[^:]+: falta\b/.test(label));
  const modal = tree => tree.root.findAll(node => node.type === 'Modal')[0];
  const textOf = scope => scope.findAll(node => node.type === 'Text').flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string').join(' ');
  /** What a screen reader says for each button that shows this title. */
  const spoken = (scope, title) => scope.findAll(node => node.type === 'View' && node.props.accessibilityRole === 'button' &&
    node.findAll(child => child.type === 'Text' && child.props.children === title).length > 0)
    .map(node => node.props.accessibilityLabel);
  const pressable = (scope, label) => scope.findAll(node => node.props?.accessibilityLabel === label &&
    typeof node.props.onPress === 'function')[0];
  const sheetButton = (tree, title) => modal(tree).findAll(node => node.props?.title === title &&
    typeof node.props.onPress === 'function')[0];
  const press = async node => { await renderer.act(async () => { node.props.onPress(); }); };
  const settle = () => renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
  const ready = (status = 'InProgress', serviceStatus = 'Completed') =>
    ({ source: 'network', operations: [operation(status, serviceStatus)] });
  const handedOff = { operationId, submissionId: '78000000-0000-4000-8000-000000000001', revisionNumber: 1,
    status: 'PendingReview', actualEndAt: '2026-10-05T15:00:00Z' };

  beforeEach(() => {
    submission().readRampOperationPendingSubmission.mockReset();
    submission().readRampOperationPendingSubmission.mockResolvedValue(null);
    submission().submitRampOperation.mockReset();
    submission().submitRampOperation.mockResolvedValue(handedOff);
  });

  test('a service still running and the checklist not sent hold ENTREGAR; ABRIR CHECKLIST opens the checklist', async () => {
    mockGetAssigned.mockResolvedValue(ready('InProgress', 'InProgress'));
    mockChecklist.mockResolvedValue(read('InProgress'));
    const tree = await render();
    expect(missing(tree.root)).toEqual([
      'Servicios terminados: falta. Falta terminar 1 servicio.',
      'Checklist enviado: falta. Sin enviar: ábrelo, complétalo y envíalo.',
    ]);
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    // The card's button and the requirement's are told apart by a screen reader.
    const labels = spoken(tree.root, 'ABRIR CHECKLIST');
    expect(labels).toHaveLength(2);
    expect(new Set(labels).size).toBe(2);
    await press(pressable(tree.root, 'Abrir el checklist que falta para entregar'));
    expect(router().push).toHaveBeenCalledWith({ pathname: '/checklist/[id]', params: { id: operationId } });
    await renderer.act(async () => tree.unmount());
  });

  test('with the checklist sent and the Service Order signed every requirement is met and ENTREGAR is on', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, items: [], documents: signedOrder };
    const tree = await render();
    expect(rows(tree.root)).toEqual(['Servicios terminados: listo', 'Checklist enviado: listo',
      'Incidencias enviadas: listo', 'Orden de Servicio firmada: listo', 'Registros enviados a ELEVANT: listo']);
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(false);
    await renderer.act(async () => tree.unmount());
  });

  test('ENTREGAR opens the tablet’s own sheet, never Alert.alert, and the sheet hands off', async () => {
    const alert = jest.spyOn(Alert, 'alert');
    try {
      mockGetAssigned.mockResolvedValue(ready());
      mockQueue = { revisions: {}, items: [], documents: signedOrder };
      const tree = await render();
      await press(button(tree, 'ENTREGAR A OCC'));
      expect(alert).not.toHaveBeenCalled();
      expect(submission().submitRampOperation).not.toHaveBeenCalled();
      // The sheet lists what the tablet checked and says the execution closes.
      const sheet = modal(tree);
      expect(rows(sheet)).toHaveLength(5);
      expect(missing(sheet)).toEqual([]);
      expect(textOf(sheet)).toContain('Al entregar, la ejecución queda cerrada para la revisión de OCC: ya no podrás ' +
        'cambiar los servicios, los cargos ni el checklist.');
      await press(sheetButton(tree, 'ENTREGAR A OCC'));
      expect(submission().submitRampOperation).toHaveBeenCalledWith(operationId, { agentNote: undefined },
        expect.objectContaining({ signal: expect.anything() }));
      expect(modal(tree)).toBeUndefined();
      expect(alert).not.toHaveBeenCalled();
      await renderer.act(async () => tree.unmount());
    } finally {
      alert.mockRestore();
    }
  });

  test('SEGUIR REVISANDO closes the sheet without handing off', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, items: [], documents: signedOrder };
    const tree = await render();
    await press(button(tree, 'ENTREGAR A OCC'));
    await press(sheetButton(tree, 'SEGUIR REVISANDO'));
    expect(modal(tree)).toBeUndefined();
    // The header's close button and Android's back button close it too.
    await press(button(tree, 'ENTREGAR A OCC'));
    await renderer.act(async () => { modal(tree).props.onRequestClose(); });
    expect(modal(tree)).toBeUndefined();
    expect(submission().submitRampOperation).not.toHaveBeenCalled();
    await renderer.act(async () => tree.unmount());
  });

  test('REINTENTAR ENTREGA still sends the reserved hand-off without the sheet', async () => {
    submission().readRampOperationPendingSubmission.mockResolvedValue({
      idempotencyKey: '50000000-0000-4000-8000-000000000001', request: { agentNote: 'Nota fija' } });
    mockGetAssigned.mockResolvedValue(ready());
    const tree = await render();
    await press(button(tree, 'REINTENTAR ENTREGA'));
    expect(modal(tree)).toBeUndefined();
    expect(submission().submitRampOperation).toHaveBeenCalledWith(operationId, { agentNote: 'Nota fija' },
      expect.objectContaining({ signal: expect.anything() }));
    await renderer.act(async () => tree.unmount());
  });

  test('after the hand-off the checklist still opens, to be read: VER CHECKLIST', async () => {
    mockGetAssigned.mockResolvedValue(ready('PendingReview'));
    const tree = await render();
    expect(button(tree, 'ABRIR CHECKLIST')).toBeUndefined();
    const view = button(tree, 'VER CHECKLIST');
    expect(view.props.disabled).toBe(false);
    await press(view);
    expect(router().push).toHaveBeenCalledWith({ pathname: '/checklist/[id]', params: { id: operationId } });
    expect(screenText(tree)).toContain('Enviado a ELEVANT');
    await renderer.act(async () => tree.unmount());
  });

  test('before the start the checklist stays off', async () => {
    mockGetAssigned.mockResolvedValue(ready('Assigned', 'Planned'));
    const tree = await render();
    expect(button(tree, 'ABRIR CHECKLIST').props.disabled).toBe(true);
    expect(button(tree, 'VER CHECKLIST')).toBeUndefined();
    await renderer.act(async () => tree.unmount());
  });

  test.each([
    ['sent', read('Submitted'), [], 'Enviado a ELEVANT'],
    ['not sent', read('NotStarted'), [], 'Sin enviar'],
    ['waiting in the queue', read('InProgress'), [{ idempotencyKey: '91000000-0000-4000-8000-000000000003',
      state: 'pending', attempts: 0, createdAt: '2026-10-05T14:30:00.000Z',
      command: { kind: 'checklistSubmit', operationId, checklistId: CHECKLIST_ID, answers: [] } }],
    'Envío guardado en el dispositivo'],
  ])('the checklist card says where the checklist stands: %s', async (_description, checklist, items, standing) => {
    mockGetAssigned.mockResolvedValue(ready());
    mockChecklist.mockResolvedValue(checklist);
    mockQueue = { revisions: {}, items };
    const tree = await render();
    expect(screenText(tree)).toContain(standing);
    await renderer.act(async () => tree.unmount());
  });

  test('a checklist submission waiting in the queue is covered by the queue requirement', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockChecklist.mockResolvedValue(read('InProgress'));
    mockQueue = { revisions: {}, documents: signedOrder, items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000003',
      state: 'pending', attempts: 0, createdAt: '2026-10-05T14:30:00.000Z',
      command: { kind: 'checklistSubmit', operationId, checklistId: CHECKLIST_ID, answers: [] } }] };
    const tree = await render();
    expect(missing(tree.root)).toEqual([
      'Registros enviados a ELEVANT: falta. Falta 1 registro por enviar a ELEVANT: abre Sincronización.']);
    expect(rows(tree.root)).toContain('Checklist enviado: por confirmar. Envío guardado en el dispositivo: sale a ' +
      'ELEVANT con los registros por enviar.');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    await renderer.act(async () => tree.unmount());
  });

  test('an incident report still on the device shows its requirement and holds ENTREGAR', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    mockUnsentIncidents.mockResolvedValue(1);
    mockQueue = { revisions: {}, items: [], documents: signedOrder };
    const tree = await render();
    expect(mockUnsentIncidents).toHaveBeenCalledWith(operationId);
    expect(missing(tree.root)).toEqual([
      'Incidencias enviadas: falta. 1 incidencia sin enviar a ELEVANT: abre Incidencias.']);
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    await press(pressable(tree.root, 'Abrir las incidencias que faltan por enviar'));
    expect(router().push).toHaveBeenCalledWith({ pathname: '/incident/[id]', params: { id: operationId } });
    await renderer.act(async () => tree.unmount());
  });

  test('opening the correction reads the checklist again: the new one is missing', async () => {
    const review = { submissionId: '78000000-0000-4000-8000-000000000001', revisionNumber: 1, status: 'Returned',
      returnReason: 'Falta la firma de la aerolínea.' };
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [{ ...operation('Returned', 'Completed'), review }] });
    const tree = await render();
    expect(mockChecklist).toHaveBeenCalledTimes(1);
    expect(button(tree, 'VER CHECKLIST').props.disabled).toBe(false);

    correction().reopenRampOperationCorrection.mockResolvedValue({ operationId, status: 'InProgress', revisionNumber: 2 });
    mockGetAssigned.mockResolvedValue({ source: 'network', operations: [{ ...operation('InProgress', 'Completed'), review }] });
    mockChecklist.mockResolvedValue(read('NotStarted'));
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
    try {
      await press(button(tree, 'ABRIR CORRECCIÓN'));
      await settle();
    } finally {
      alert.mockRestore();
    }
    expect(mockChecklist).toHaveBeenCalledTimes(2);
    expect(missing(tree.root)).toEqual(['Checklist enviado: falta. Sin enviar: ábrelo, complétalo y envíalo.']);
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(true);
    await renderer.act(async () => tree.unmount());
  });

  test.each([
    ['session_expired', 'session_expired'],
    ['unauthenticated', 'session_expired'],
    ['forbidden', 'access_revoked'],
  ])('a checklist read refused with %s goes to the access screen', async (code, notice) => {
    mockGetAssigned.mockResolvedValue(ready());
    mockChecklist.mockRejectedValue(new MobileServiceError(code));
    const tree = await render();
    expect(router().replace).toHaveBeenCalledWith({ pathname: '/', params: { notice } });
    await renderer.act(async () => tree.unmount());
  });

  test.each([
    ['without signal', () => mockChecklist.mockRejectedValue(new MobileServiceError('network_unavailable'))],
    ['from the saved copy', () => mockChecklist.mockResolvedValue(read('NotStarted', true))],
  ])('a checklist the tablet cannot confirm %s holds nothing', async (_description, arrange) => {
    arrange();
    mockGetAssigned.mockResolvedValue(ready());
    mockQueue = { revisions: {}, items: [], documents: signedOrder };
    const tree = await render();
    expect(missing(tree.root)).toEqual([]);
    expect(rows(tree.root)).toContain('Checklist enviado: por confirmar. La tablet no pudo leerlo ahora; lo comprueba al entregar.');
    expect(button(tree, 'ENTREGAR A OCC').props.disabled).toBe(false);
    await renderer.act(async () => tree.unmount());
  });

  test('the checklist is read on focus and when the queue moves, never when the feed reloads the operation', async () => {
    mockGetAssigned.mockResolvedValue(ready());
    const tree = await render();
    expect(mockChecklist).toHaveBeenCalledTimes(1);
    expect(mockChecklist).toHaveBeenCalledWith(operationId, expect.objectContaining({ signal: expect.anything() }));

    await renderer.act(async () => { for (const listener of mockChangeListeners) listener(['ramp_operations']); });
    expect(mockGetAssigned).toHaveBeenCalledTimes(2);
    expect(mockChecklist).toHaveBeenCalledTimes(1);

    // ELEVANT confirmed a command of the operation that went out from the queue, such as the checklist itself.
    await renderer.act(async () => {
      for (const listener of mockQueueListeners) listener({ items: [], revisions: { [operationId]: 1 } });
    });
    expect(mockChecklist).toHaveBeenCalledTimes(2);
    await renderer.act(async () => tree.unmount());
  });

  test.each([
    ['InProgress', undefined],
    ['PendingReview', 'closed'],
    ['Approved', 'closed'],
    ['Returned', 'returned'],
  ])('the charges card hears whether the execution closed: %s', async (status, executionClosed) => {
    const { RampOperationChargesCard } = require('../src/components/ramp-operation-charges-card');
    mockGetAssigned.mockResolvedValue(ready(status));
    const tree = await render();
    expect(tree.root.findByType(RampOperationChargesCard).props.executionClosed).toBe(executionClosed);
    await renderer.act(async () => tree.unmount());
  });
});
