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
// 3-N18: «ahora» is ELEVANT's time, whatever the tablet's clock says.
const mockServerNow = Date.parse('2026-10-05T14:07:00.000Z');
jest.mock('../src/synchronization/server-clock', () => ({ serverNow: () => new Date(mockServerNow) }));

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
  expect(Date.parse(request.observedStartAt)).toBe(mockServerNow);
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

test('requires a choice when the agent lane changes before an unsaved local edit is sent', async () => {
  mockRead.mockResolvedValueOnce(snapshot(contribution(1, 'Inicial')))
    .mockResolvedValueOnce(snapshot(contribution(2, 'Nueva versión')));
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Mi edición'));
  const listener = mockSubscribe.mock.calls[0][0];
  await renderer.act(async () => listener(['attendance_draft']));
  expect(textContent()).toContain('Nueva versión');
  expect(note.props.value).toBe('Mi edición');
  expect(textContent()).toContain('Conflicto');
  expect(mockSave).not.toHaveBeenCalled();
  await renderer.act(async () => press('Usar revisión actual y conservar mi intento'));
  expect(mockClearPending).not.toHaveBeenCalled();
  await renderer.act(async () => press('Guardar observación'));
  expect(mockSave.mock.calls[0][2]).toMatchObject({ expectedRevision: 2, incidentNote: 'Mi edición' });
});

test('does not resolve a 409 against an old snapshot when canonical reload fails', async () => {
  const pending = { idempotencyKey: key,
    request: { expectedRevision: 1, observedStartAt: null, observedEndAt: null,
      incidentNote: 'Mi versión' } };
  mockRead.mockResolvedValueOnce(snapshot(contribution(1, 'Inicial')))
    .mockRejectedValueOnce(new MobileServiceError('network_unavailable'))
    .mockResolvedValueOnce(snapshot(contribution(2, 'Nueva versión')));
  mockSave.mockRejectedValueOnce(new MobileServiceError('conflict', { status: 409 }));
  mockReadPending.mockResolvedValueOnce(null).mockResolvedValue(pending);
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Mi versión'));
  await renderer.act(async () => press('Guardar observación'));
  const choice = tree.root.findAll(node => node.props.accessibilityLabel ===
    'Usar revisión actual y conservar mi intento')[0];
  expect(choice.props.disabled).toBe(true);
  await renderer.act(async () => press('Usar revisión actual y conservar mi intento'));
  expect(mockClearPending).not.toHaveBeenCalled();
  await renderer.act(async () => press('Actualizar observaciones'));
  expect(choice.props.disabled).toBe(false);
});

test('compares attempted and canonical hours even when the notes are unchanged', async () => {
  mockRead.mockResolvedValueOnce(snapshot({ ...contribution(1, 'Igual'),
    observedStartAt: '2026-10-05T10:00:00Z' }))
    .mockResolvedValueOnce(snapshot({ ...contribution(2, 'Igual'),
      observedStartAt: '2026-10-05T11:00:00Z' }));
  await render();
  const start = tree.root.findAll(node => node.props.accessibilityLabel === 'Inicio observado')[0];
  await renderer.act(async () => start.props.onChangeText('2026-10-05 12:00'));
  const listener = mockSubscribe.mock.calls[0][0];
  await renderer.act(async () => listener(['attendance_draft']));
  expect(textContent()).toContain('Inicio guardado:');
  // S6: the attempt reads like the saved side, «5 oct, 12:00» (no zone given: AVIAM's calendar).
  expect(textContent()).toMatch(/Inicio de tu intento:\s+5 oct\.?,? 12:00/);
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

test('removes the former session snapshot if a refresh is cancelled by a session switch', async () => {
  mockRead.mockResolvedValueOnce(snapshot(contribution(1, 'Dato anterior')))
    .mockRejectedValueOnce(new MobileServiceError('cancelled'));
  await render();
  expect(tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0]
    .props.value).toBe('Dato anterior');
  const listener = mockSubscribe.mock.calls[0][0];
  await renderer.act(async () => listener(['attendance_draft']));
  expect(tree.root.findAllByType('TextInput')).toHaveLength(0);
  expect(textContent()).toContain('Observaciones no disponibles');
  expect(mockSave).not.toHaveBeenCalled();
});

test('removes the former session snapshot if a write is cancelled by a session switch', async () => {
  mockRead.mockResolvedValue(snapshot(contribution(1, 'Dato anterior')));
  mockSave.mockRejectedValueOnce(new MobileServiceError('cancelled'));
  await render();
  const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
  await renderer.act(async () => note.props.onChangeText('Intento previo'));
  await renderer.act(async () => press('Guardar observación'));
  expect(tree.root.findAllByType('TextInput')).toHaveLength(0);
  expect(textContent()).toContain('Observaciones no disponibles');
});

// S6 (D-S6): the card edits and shows its times on the station's clock, «hora local de PUJ», never in the device's
// zone, and still saves UTC instants. The device here is not in the stations' zones below.
describe('the station’s clock (S6, D-S6)', () => {
  const IANA_ID = /\b(?:Africa|America|Asia|Atlantic|Australia|Europe|Indian|Pacific|Etc)\/[A-Za-z_]+/;
  const field = label => tree.root.findAll(node =>
    node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0];
  const type = (label, value) => renderer.act(async () => field(label).props.onChangeText(value));
  function conflictText() {
    const alert = tree.root.findAll(node => node.props.accessibilityRole === 'alert' && node.type === 'View')[0];
    expect(alert).toBeDefined();
    return alert.findAll(node => node.type === 'Text').map(node => node.props.children)
      .flat(Infinity).filter(value => typeof value === 'string').join(' ');
  }

  test('in Kathmandu the card names the station’s clock, never the device’s zone', async () => {
    mockRead.mockResolvedValue({ ...snapshot({ ...contribution(1, 'Mi nota'), observedEndAt: '2026-10-05T12:00:00Z' }),
      occ: { ...contribution(1, 'Turno confirmado por OCC'), observedStartAt: '2026-10-05T10:00:00Z' } });
    await render({ timeZone: 'Asia/Kathmandu', stationCode: 'KTM' });
    const text = textContent();
    expect(text).toContain('Las horas están en hora local de KTM.');
    expect(text).toContain('Inicio observado · hora local de KTM');
    expect(text).toContain('Fin observado · hora local de KTM');
    expect(text).not.toContain('zona de este dispositivo');
    expect(text).not.toContain(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(text).not.toMatch(IANA_ID);
    // OCC's 10:00 UTC and the agent's 12:00 UTC on Kathmandu's clock (UTC+5:45).
    expect(text).toMatch(/Inicio:\s+5 oct\.?,? 15:45/);
    expect(field('Fin observado').props.value).toBe('2026-10-05 17:45');
    // The labels the screen reader announces do not change.
    expect(field('Inicio observado')).toBeDefined();
    expect(field('Nota del agente')).toBeDefined();
  });

  test('«ahora» is the station’s wall clock and is saved as the same instant', async () => {
    await render({ timeZone: 'Asia/Kathmandu', stationCode: 'KTM' });
    await renderer.act(async () => press('Registrar inicio ahora'));
    // ELEVANT's 14:07 UTC is 19:52 in Kathmandu.
    expect(field('Inicio observado').props.value).toBe('2026-10-05 19:52');
    await renderer.act(async () => press('Guardar observación'));
    expect(mockSave.mock.calls[0][2].observedStartAt).toBe(new Date(mockServerNow).toISOString());
  });

  test('a time typed at the station is saved as its UTC instant', async () => {
    await render({ timeZone: 'America/New_York', stationCode: 'JFK' });
    // December: New York is UTC−5, an hour off Santo Domingo.
    await type('Inicio observado', '2026-12-05 10:00');
    await type('Fin observado', '2026-12-05 10:45');
    await renderer.act(async () => press('Guardar observación'));
    expect(mockSave.mock.calls[0][2]).toMatchObject({
      observedStartAt: '2026-12-05T15:00:00.000Z', observedEndAt: '2026-12-05T15:45:00.000Z',
    });
  });

  test('02:30 on 8 March does not exist in New York and is not saved', async () => {
    await render({ timeZone: 'America/New_York', stationCode: 'JFK' });
    await type('Inicio observado', '2026-03-08 02:30');
    await renderer.act(async () => press('Guardar observación'));
    expect(mockSave).not.toHaveBeenCalled();
    expect(textContent()).toContain('Comprueba fecha, hora y nota antes de guardar.');
  });

  test('a retry sends the reserved request exactly, whatever the station’s clock shows', async () => {
    const pending = { idempotencyKey: key,
      request: { expectedRevision: 0, observedStartAt: '2026-10-05T10:00:00.000Z', observedEndAt: null,
        incidentNote: 'Reservado en otra versión' } };
    mockReadPending.mockResolvedValue(pending);
    await render({ timeZone: 'Asia/Kathmandu', stationCode: 'KTM' });
    expect(field('Inicio observado').props.value).toBe('2026-10-05 15:45');
    await renderer.act(async () => press('Reintentar confirmación'));
    expect(mockSave).toHaveBeenCalledTimes(1);
    expect(mockSave.mock.calls[0][2]).toStrictEqual(pending.request);
  });

  test('the conflict shows both sides in one format, on the station’s clock', async () => {
    mockRead.mockResolvedValueOnce(snapshot({ ...contribution(1, 'Igual'), observedStartAt: '2026-10-05T10:00:00Z' }))
      .mockResolvedValueOnce(snapshot({ ...contribution(2, 'Igual'), observedStartAt: '2026-10-05T11:00:00Z' }));
    await render({ timeZone: 'America/New_York', stationCode: 'JFK' });
    expect(field('Inicio observado').props.value).toBe('2026-10-05 06:00');
    await type('Inicio observado', '2026-10-05T08:00');
    const listener = mockSubscribe.mock.calls[0][0];
    await renderer.act(async () => listener(['attendance_draft']));
    const text = conflictText();
    // 11:00 UTC is 07:00 in New York; the attempt typed at the station reads the same way.
    expect(text).toMatch(/Inicio guardado:\s+5 oct\.?,? 07:00/);
    expect(text).toMatch(/Inicio de tu intento:\s+5 oct\.?,? 08:00/);
    expect(text).toMatch(/Guardado:\s+5 oct\.?,? 06:00/);
    expect(text).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test('a zone the tablet does not know does not break the card: AVIAM’s calendar', async () => {
    await render({ timeZone: 'Mars/Olympus_Mons', stationCode: 'PUJ' });
    expect(textContent()).toContain('Las horas están en hora local de PUJ.');
    expect(textContent()).not.toContain('Mars/Olympus_Mons');
    await renderer.act(async () => press('Registrar inicio ahora'));
    // 14:07 UTC is 10:07 in Santo Domingo.
    expect(field('Inicio observado').props.value).toBe('2026-10-05 10:07');
    await renderer.act(async () => press('Guardar observación'));
    expect(mockSave.mock.calls[0][2].observedStartAt).toBe('2026-10-05T14:07:00.000Z');
  });
});
