// N6: when the tablet cannot keep a start, a service change or the hand-off, the operation's screen says what happened
// and what to do, in plain words: never «Desbloquea» (on Android the lock is never the cause) nor «payload». N13: nor
// «comando», «canónico» or «fuente de verdad» when ELEVANT refused, changed or did not confirm something. The screen
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
  mockSubmit.mockRejectedValue(new MobileServiceError('storage_unavailable'));
  const tree = await render(assigned('InProgress', 'Completed'));
  await press(tree, 'ENTREGAR A OCC');
  // N1: the agent confirms the hand-off in the tablet's own sheet, not in a native dialog.
  const [sheet] = tree.root.findAll(node => node.type === 'Modal');
  const [confirm] = sheet.findAll(node => node.props?.title === 'ENTREGAR A OCC' && typeof node.props.onPress === 'function');
  await renderer.act(async () => { confirm.props.onPress(); });

  expect(mockSubmit).toHaveBeenCalled();
  const text = screenText(tree);
  expect(text).toContain('Entrega no guardada');
  expect(text).toContain(`La tablet no pudo guardar la entrega. ${WHAT_TO_DO}`);
  expect(text).not.toMatch(JARGON_OR_LOCK);
  await renderer.act(async () => tree.unmount());
}, 30_000);

// N13 (D-N13): a review of the PR 1 found «comando reservado» and «estado canónico» still on this screen. Each state
// that showed them says the same in plain words, with tú.
describe('plain words when ELEVANT refused, changed or did not confirm something (N13, D-N13)', () => {
  const { Alert } = require('react-native');
  const submission = () => require('../src/services/ramp-operation-submission');
  const correction = () => require('../src/services/ramp-operation-correction');
  const returned = { ...assigned('Returned', 'Completed'), review: { submissionId: '78000000-0000-4000-8000-000000000001',
    revisionNumber: 1, status: 'Returned', returnReason: 'Falta la firma de la aerolínea.' } };
  const twoServices = () => {
    const operation = assigned('InProgress', 'Planned');
    return { ...operation, services: [...operation.services, { ...operation.services[0],
      id: '73000000-0000-4000-8000-000000000002', lineNumber: 2, serviceDefinitionId: '73000000-0000-4000-8000-000000000002',
      code: 'FUEL', name: 'Combustible' }] };
  };
  /** ENTREGAR on the card opens the tablet's sheet (N1); its own ENTREGAR A OCC hands off. */
  async function handOff(tree) {
    await press(tree, 'ENTREGAR A OCC');
    const [sheet] = tree.root.findAll(node => node.type === 'Modal');
    const [confirm] = sheet.findAll(node => node.props?.title === 'ENTREGAR A OCC' && typeof node.props.onPress === 'function');
    await renderer.act(async () => { confirm.props.onPress(); });
  }

  beforeEach(() => {
    mockStart.mockReset();
    mockTransition.mockReset();
    mockSubmit.mockReset();
    submission().readRampOperationPendingSubmission.mockReset();
    submission().readRampOperationPendingSubmission.mockResolvedValue(null);
    correction().readPendingRampCorrection.mockReset();
    correction().readPendingRampCorrection.mockResolvedValue(false);
  });

  test.each([
    ['a service ELEVANT changed meanwhile', () => assigned('InProgress', 'Planned'),
      () => { mockTransition.mockRejectedValue(new MobileServiceError('conflict')); },
      tree => press(tree, 'INICIAR SERVICIO'),
      ['El servicio cambió', 'Actualizamos el servicio con lo que tiene ELEVANT. Revísalo antes de registrar otro resultado.']],
    ['a service change ELEVANT did not take', () => assigned('InProgress', 'Planned'),
      () => { mockTransition.mockRejectedValue(new MobileServiceError('malformed_response')); },
      tree => press(tree, 'INICIAR SERVICIO'),
      ['Servicio no actualizado', 'No pudimos registrar el cambio. Actualiza el detalle y revisa el servicio antes de continuar.']],
    ['another service still changing', twoServices,
      () => { mockTransition.mockReturnValue(new Promise(() => {})); },
      tree => press(tree, 'INICIAR SERVICIO'),
      ['Espera a que termine el cambio del otro servicio.']],
    ['a start ELEVANT changed meanwhile', () => assigned('Assigned'),
      () => { mockStart.mockRejectedValue(new MobileServiceError('conflict')); },
      tree => press(tree, 'INICIAR OPERACIÓN'),
      ['La operación cambió', 'Actualizamos la operación con lo que tiene ELEVANT. Revísala antes de volver a intentarlo.']],
    ['a start whose answer the connection lost', () => assigned('Assigned'),
      () => { mockStart.mockRejectedValue(new MobileServiceError('network_unavailable')); },
      tree => press(tree, 'INICIAR OPERACIÓN'),
      ['Inicio pendiente de confirmación', 'Se perdió la conexión antes de que ELEVANT confirmara el inicio. Reconecta y ' +
        'vuelve a intentarlo sin cerrar sesión: el inicio no se duplica.']],
    ['a start ELEVANT answered too late', () => assigned('Assigned'),
      () => { mockStart.mockRejectedValue(new MobileServiceError('request_timeout')); },
      tree => press(tree, 'INICIAR OPERACIÓN'),
      ['Inicio pendiente de confirmación', 'ELEVANT tardó demasiado en responder. Vuelve a intentarlo sin cerrar sesión: el ' +
        'inicio no se duplica.']],
    ['a hand-off whose copy the tablet cannot read back', () => assigned('InProgress', 'Completed'),
      () => {
        mockSubmit.mockRejectedValue(new MobileServiceError('request_failed'));
        return () => submission().readRampOperationPendingSubmission.mockRejectedValueOnce(new Error('storage'));
      },
      handOff,
      ['Entrega por confirmar', 'No pudimos confirmar la entrega guardada en esta tablet. Actualiza el detalle antes de ' +
        'volver a enviarla.', 'Para entregar, actualiza el detalle con señal y espera a que terminen los cambios en curso.']],
    ['a hand-off ELEVANT did not confirm, kept on the tablet', () => assigned('InProgress', 'Completed'),
      () => {
        mockSubmit.mockRejectedValue(new MobileServiceError('network_unavailable'));
        return () => submission().readRampOperationPendingSubmission.mockResolvedValueOnce({
          idempotencyKey: '50000000-0000-4000-8000-000000000001', request: { agentNote: undefined } });
      },
      handOff,
      ['Entrega pendiente de confirmación', 'La entrega quedó guardada en esta tablet. Vuelve a intentarlo sin cerrar ' +
        'sesión: se envía la misma, sin duplicarla.']],
    ['a correction ELEVANT did not confirm, kept on the tablet', () => returned,
      () => {
        correction().reopenRampOperationCorrection.mockRejectedValueOnce(new MobileServiceError('network_unavailable'));
        return () => correction().readPendingRampCorrection.mockResolvedValueOnce(true);
      },
      tree => press(tree, 'ABRIR CORRECCIÓN'),
      ['Corrección por confirmar', 'ELEVANT no confirmó la corrección. Vuelve a intentarlo sin cerrar sesión: no se ' +
        'abre dos veces.']],
    ['a correction whose copy the tablet cannot read back', () => returned,
      () => {
        correction().reopenRampOperationCorrection.mockRejectedValueOnce(new MobileServiceError('request_failed'));
        return () => correction().readPendingRampCorrection.mockRejectedValueOnce(new Error('storage'));
      },
      tree => press(tree, 'ABRIR CORRECCIÓN'),
      ['Corrección sin confirmar', 'No pudimos confirmar la corrección guardada en esta tablet. Actualiza el detalle ' +
        'antes de volver a intentarlo.']],
  ])('%s says so in plain words', async (_description, operation, arrange, act, expected) => {
    // The correction asks first in a native dialog; the agent confirms it.
    const alert = jest.spyOn(Alert, 'alert').mockImplementation((_title, _message, buttons) => buttons?.[1]?.onPress?.());
    try {
      // What the services answer; a case whose doubles must be set once the screen loaded returns that step.
      const afterRender = arrange();
      const tree = await render(operation());
      if (typeof afterRender === 'function') afterRender();
      await act(tree);
      await renderer.act(async () => { await new Promise(resolve => setTimeout(resolve, 0)); });
      const text = screenText(tree);
      for (const line of expected) expect(text).toContain(line);
      expect(text).not.toMatch(JARGON_OR_LOCK);
      await renderer.act(async () => tree.unmount());
    } finally {
      alert.mockRestore();
    }
  }, 30_000);
});
