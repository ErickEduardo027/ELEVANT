// CN-22: once the operation started, its screen goes in five tabs fixed under its card (Resumen, Vuelo, Servicios,
// Documentos, Cierre), each with its progress; before the start the screen is the one it always was. Every section
// stays mounted and a hidden tab is only not displayed, so switching tabs never loses what the agent typed. CN-25: the
// assignment's position in Spanish. The screen is real; its services are doubles, as in flight-screen-notices.test.js.
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
  router: { push: jest.fn(), replace: jest.fn(), canDismiss: jest.fn(() => true), dismissAll: jest.fn() },
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
// N1: the close reads the operation's checklist and counts its incident reports still on the device.
jest.mock('../src/services/ramp-operation-checklist', () => ({
  getRampOperationChecklist: jest.fn(async () => ({ fromCache: false, checklist: { status: 'Submitted' } })),
}));
jest.mock('../src/services/ramp-incidents', () => ({ countUnsentRampIncidents: jest.fn(async () => 0) }));

const { MobileServiceError } = require('../src/services/mobile-service-error');
const Screen = require('../src/app/flight/[id]').default;

const operationId = '70000000-0000-4000-8000-000000000005';
const serviceId = '73000000-0000-4000-8000-000000000001';
/**
 * The jargon and the advice the old notices gave: neither belongs in front of a ramp agent (N6); nor do «comando»,
 * «canónico» and «fuente de verdad» (N13).
 */
const JARGON_OR_LOCK = /payload|idempotente|Desbloque|canónic|comando|fuente de verdad/i;
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

const { StyleSheet } = require('react-native');
const tabButton = (tree, id) => tree.root.findAll(node => node.props?.testID === `operation-tab-${id}` &&
  typeof node.props.onPress === 'function')[0];
/** Whether a node sits in a section the screen does not display. */
function hidden(node) {
  for (let current = node; current; current = current.parent) {
    if (current.type === 'View' && StyleSheet.flatten(current.props.style)?.display === 'none') return true;
  }
  return false;
}
const titled = (tree, title) => tree.root.findAll(node => node.props?.title === title &&
  typeof node.props.onPress === 'function')[0];
const noteInput = tree => tree.root.findAll(node => node.type === 'TextInput' &&
  node.props.accessibilityLabel === 'Nota opcional para OCC')[0];

test('before the start there are no tabs and every section shows, as always', async () => {
  const tree = await render(assigned('Assigned', 'Planned'));
  expect(tabButton(tree, 'resumen')).toBeUndefined();
  expect(hidden(titled(tree, 'INICIAR OPERACIÓN'))).toBe(false);
  expect(screenText(tree)).toContain('Servicios contratados');
  expect(hidden(titled(tree, 'ABRIR CHECKLIST'))).toBe(false);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('a started operation opens on its summary, with each tab saying its progress', async () => {
  const tree = await render(assigned('InProgress', 'Planned'));
  const tabs = ['resumen', 'vuelo', 'servicios', 'documentos', 'cierre'].map(id => tabButton(tree, id));
  expect(tabs.every(Boolean)).toBe(true);
  expect(tabs[0].props.accessibilityState).toEqual({ selected: true });
  expect(tabs[2].props.accessibilityLabel).toBe('Servicios, 0 de 1 terminado');
  expect(tabs[4].props.accessibilityLabel).toMatch(/^Cierre, \d requisitos? pendientes? para entregar$/);
  expect(screenText(tree)).toContain('0/1');
  // The summary shows; the services and the close are mounted, not displayed.
  expect(hidden(titled(tree, 'INICIAR SERVICIO'))).toBe(true);
  expect(hidden(titled(tree, 'ENTREGAR A OCC'))).toBe(true);

  await renderer.act(async () => { tabButton(tree, 'servicios').props.onPress(); });
  expect(tabButton(tree, 'servicios').props.accessibilityState).toEqual({ selected: true });
  expect(hidden(titled(tree, 'INICIAR SERVICIO'))).toBe(false);
  expect(hidden(titled(tree, 'ENTREGAR A OCC'))).toBe(true);
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('switching tabs keeps what the agent typed and the flow of the hand-off', async () => {
  const tree = await render(assigned('InProgress', 'Completed'));
  await renderer.act(async () => { tabButton(tree, 'cierre').props.onPress(); });
  await renderer.act(async () => { noteInput(tree).props.onChangeText('Rampa mojada'); });
  await renderer.act(async () => { tabButton(tree, 'vuelo').props.onPress(); });
  await renderer.act(async () => { tabButton(tree, 'cierre').props.onPress(); });
  expect(noteInput(tree).props.value).toBe('Rampa mojada');
  expect(hidden(titled(tree, 'ENTREGAR A OCC'))).toBe(false);
  expect(tabButton(tree, 'servicios').props.accessibilityLabel).toBe('Servicios, 1 de 1 terminado');
  await renderer.act(async () => tree.unmount());
}, 30_000);

test('the assignment names the position in Spanish (CN-25)', async () => {
  const operation = assigned('InProgress', 'Planned');
  const tree = await render({ ...operation, assignment: { ...operation.assignment,
    position: { id: '70000000-0000-4000-8000-000000000007', code: 'RAMP-AGENT', name: 'Ramp agent' } } });
  const text = screenText(tree);
  expect(text).toContain('Agente de rampa');
  expect(text).not.toContain('Ramp agent');
  await renderer.act(async () => tree.unmount());
}, 30_000);
