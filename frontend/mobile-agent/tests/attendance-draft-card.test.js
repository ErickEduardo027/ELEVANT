const React = require('react');
const renderer = require('react-test-renderer');

const mockRead = jest.fn();
const mockSave = jest.fn();
const mockReadPending = jest.fn();
const mockClearPending = jest.fn();
const mockSubscribe = jest.fn(() => () => {});

jest.mock('../src/services/ramp-attendance-draft', () => ({
  readRampAttendanceDraft: (...args) => mockRead(...args),
  saveRampAttendanceDraft: (...args) => mockSave(...args),
}));
jest.mock('../src/storage/attendance-draft', () => ({
  readPendingAttendanceDraft: (...args) => mockReadPending(...args),
  clearPendingAttendanceDraft: (...args) => mockClearPending(...args),
}));
jest.mock('../src/services/mobile-change-feed', () => ({
  subscribeMobileChanges: (...args) => mockSubscribe(...args),
}));
jest.mock('../src/services/mobile-service-error', () => ({
  MobileServiceError: class MobileServiceError extends Error {
    constructor(code, options = {}) { super(code); this.code = code; this.status = options.status; }
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { AttendanceDraftCard } = require('../src/components/attendance-draft-card');
const { MobileServiceError } = require('../src/services/mobile-service-error');
const operationId = '70000000-0000-4000-8000-000000000005';
const assignmentId = '70000000-0000-4000-8000-000000000006';
const contribution = (revision, incidentNote) => ({ revision, incidentNote,
  observedStartAt: null, observedEndAt: null,
  authorAccountId: '20000000-0000-4000-8000-000000000001',
  recordedAt: '2026-10-05T10:00:00Z' });
const snapshot = (rampAgent = null) => ({ operationId, assignmentId,
  stationId: '71000000-0000-4000-8000-000000000001',
  occ: contribution(1, 'Turno confirmado por OCC'), rampAgent });
const key = '82000000-0000-4000-8000-000000000001';
let tree;

function textContent() {
  return tree.root.findAllByType('Text').map(node => node.props.children)
    .flat(Infinity).filter(value => typeof value === 'string').join(' ');
}
function press(label) {
  const node = tree.root.findAll(node => node.props.accessibilityLabel === label)[0];
  expect(node).toBeDefined();
  return node.props.onPress();
}
async function render(props = {}) {
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(AttendanceDraftCard,
      { operationId, assignmentId, ...props }));
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockRead.mockResolvedValue(snapshot());
  mockReadPending.mockResolvedValue(null);
  mockClearPending.mockResolvedValue(true);
  mockSave.mockResolvedValue({ contribution: contribution(1, 'Observado'), replayed: false });
  tree = null;
});
afterEach(async () => {
  if (tree) await renderer.act(async () => tree.unmount());
});

test('shows the canonical OCC lane read-only and saves a manual start with timezone', async () => {
  await render();
  expect(textContent()).toContain('Aporte de OCC');
  expect(textContent()).toContain('Turno confirmado por OCC');
  expect(textContent()).toContain('observación manual');
  await renderer.act(async () => press('Registrar inicio ahora'));
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Inicio observado en rampa'));
  await renderer.act(async () => press('Guardar observación'));
  const request = mockSave.mock.calls[0][2];
  expect(request.expectedRevision).toBe(0);
  expect(request.incidentNote).toBe('Inicio observado en rampa');
  expect(request.observedStartAt).toMatch(/(Z|[+-]\d\d:\d\d)$/);
  expect(textContent()).toContain('Guardado');
});

test('shows pending confirmation after an uncertain write and retries the same body', async () => {
  const pending = { idempotencyKey: key,
    request: { expectedRevision: 0, observedStartAt: null, observedEndAt: null,
      incidentNote: 'En revisión' } };
  mockSave.mockRejectedValueOnce(new MobileServiceError('network_unavailable'));
  mockReadPending.mockResolvedValueOnce(null).mockResolvedValue(pending);
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('En revisión'));
  await renderer.act(async () => press('Guardar observación'));
  expect(textContent()).toContain('Pendiente de confirmar');
  await renderer.act(async () => press('Reintentar confirmación'));
  expect(mockSave).toHaveBeenCalledTimes(2);
  expect(mockSave.mock.calls[1][2]).toEqual(pending.request);
});

test('keeps the attempted note visible beside the current revision after 409', async () => {
  mockSave.mockRejectedValueOnce(new MobileServiceError('conflict', { status: 409 }));
  mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(
    snapshot(contribution(2, 'Versión remota')));
  mockReadPending.mockResolvedValueOnce(null).mockResolvedValue({ idempotencyKey: key,
    request: { expectedRevision: 0, observedStartAt: null, observedEndAt: null,
      incidentNote: 'Mi versión' } });
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Mi versión'));
  await renderer.act(async () => press('Guardar observación'));
  expect(textContent()).toContain('Conflicto');
  expect(textContent()).toContain('Mi versión');
  expect(textContent()).toContain('Versión remota');
  expect(mockClearPending).not.toHaveBeenCalled();
});

test('requires an explicit rebase choice before saving against revision two', async () => {
  mockSave.mockRejectedValueOnce(new MobileServiceError('conflict', { status: 409 }));
  mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce(
    snapshot(contribution(2, 'Versión remota')));
  mockReadPending.mockResolvedValueOnce(null).mockResolvedValueOnce({ idempotencyKey: key,
    request: { expectedRevision: 0, observedStartAt: null, observedEndAt: null,
      incidentNote: 'Mi versión' } });
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Mi versión'));
  await renderer.act(async () => press('Guardar observación'));
  expect(mockSave).toHaveBeenCalledTimes(1);
  await renderer.act(async () => press('Usar revisión actual y conservar mi intento'));
  expect(mockClearPending).toHaveBeenCalledWith(operationId, assignmentId, key);
  await renderer.act(async () => press('Guardar observación'));
  expect(mockSave.mock.calls[1][2]).toMatchObject({
    expectedRevision: 2, incidentNote: 'Mi versión',
  });
});

test('never paints the previous operation after a delayed read resolves', async () => {
  let resolveFirst;
  mockRead.mockReturnValueOnce(new Promise(resolve => { resolveFirst = resolve; }))
    .mockResolvedValueOnce({ ...snapshot(), operationId: '70000000-0000-4000-8000-000000000007',
      occ: contribution(1, 'Solo nuevo vuelo') });
  await render();
  await renderer.act(async () => tree.update(React.createElement(AttendanceDraftCard,
    { operationId: '70000000-0000-4000-8000-000000000007', assignmentId })));
  await renderer.act(async () => resolveFirst(snapshot()));
  expect(textContent()).toContain('Solo nuevo vuelo');
  expect(textContent()).not.toContain('Turno confirmado por OCC');
});

test('does not enable a new write when the pending-command store is unreadable', async () => {
  mockReadPending.mockRejectedValue(new Error('raw storage detail'));
  await render();
  expect(mockRead).not.toHaveBeenCalled();
  expect(textContent()).toContain('No se pudo leer la observación pendiente');
  expect(mockSave).not.toHaveBeenCalled();
});

test('re-reads the canonical snapshot on a durable hint without overwriting unsaved input', async () => {
  mockRead.mockResolvedValueOnce(snapshot()).mockResolvedValueOnce({
    ...snapshot(), occ: contribution(2, 'Nueva observación OCC'),
  });
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Mi nota sin guardar'));
  const listener = mockSubscribe.mock.calls[0][0];
  await renderer.act(async () => listener(['attendance_draft']));
  expect(textContent()).toContain('Nueva observación OCC');
  expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0]
    .props.value).toBe('Mi nota sin guardar');
});

test('never replays a displayed pending command after its session scope disappears', async () => {
  const pending = { idempotencyKey: key,
    request: { expectedRevision: 0, observedStartAt: null, observedEndAt: null,
      incidentNote: 'Anterior sesión' } };
  mockReadPending.mockResolvedValueOnce(pending).mockResolvedValueOnce(null);
  await render();
  expect(textContent()).toContain('Pendiente de confirmar');
  await renderer.act(async () => press('Reintentar confirmación'));
  expect(mockSave).not.toHaveBeenCalled();
  expect(textContent()).toContain('sesión');
});
