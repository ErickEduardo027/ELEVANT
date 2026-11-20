const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

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

// N13 (D-N13): when the tablet cannot read the observation it keeps pending, the card says what happens in plain words;
// it never names a «comando».
describe('plain words when the pending observation cannot be read (N13, D-N13)', () => {
  const WAITS = 'No se enviará otra observación mientras tanto.';

  test('on opening the card', async () => {
    mockReadPending.mockRejectedValue(new Error('raw storage detail'));
    await render();
    expect(textContent()).toContain(`No se pudo leer la observación pendiente. ${WAITS}`);
    expect(textContent()).not.toMatch(/comando/i);
  });

  test('after a save ELEVANT did not confirm', async () => {
    await render();
    const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Nota del agente')[0];
    await renderer.act(async () => note.props.onChangeText('Inicio observado en rampa'));
    mockSave.mockRejectedValueOnce(new MobileServiceError('request_failed'));
    mockReadPending.mockRejectedValueOnce(new Error('raw storage detail'));
    await renderer.act(async () => press('Guardar observación'));
    expect(textContent()).toContain(`No se pudo verificar la observación pendiente. ${WAITS}`);
    expect(textContent()).not.toMatch(/comando/i);
  });
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
    // OCC's 10:00 UTC and the agent's 12:00 UTC on Kathmandu's clock (UTC+5:45). Without the operation's day, OCC's
    // time carries its date (N8).
    expect(text).toMatch(/Inicio 5 oct\.?,? 15:45 · Fin —/);
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

// N8 (D-N8, in part): the card is drawn like the rest of the tablet. Every text takes its size and weight from the
// type tokens and its colour from the palette, and the fields are 56 dp high (touch.min, ADR-0031) with the
// typography of «Datos del vuelo». OCC's lane says «OCC aún no registra horas.» in one line instead of five empty
// ones; with data it reads «Inicio 19:48 · Fin —», with the date when it is not the operation's day, the note and
// «Registrado 16 nov, 19:50». The revision counters stay, and the hours are still typed: no time picker yet.
describe('the app’s style and OCC’s lane (N8, D-N8)', () => {
  const tokens = require('../src/theme/tokens');
  const { colors } = require('../src/theme/colors');
  const TYPE_TOKENS = Object.values(tokens.type).map(token => `${token.fontSize}/${token.fontWeight}`);
  const PALETTE = Object.values(colors);
  const PUJ = { timeZone: 'America/Santo_Domingo', stationCode: 'PUJ' };
  const occ = overrides => ({ ...contribution(1, null), ...overrides });
  // A text as the agent reads it, numbers included: textContent() drops a number child such as «Revisión {1}».
  const lineOf = node => [].concat(node.props.children).flat(Infinity)
    .filter(value => typeof value === 'string' || typeof value === 'number').join('');
  const box = node => {
    let parent = node.parent;
    while (parent && parent.type !== 'View') parent = parent.parent;
    return parent;
  };
  /** The lines of the lane headed `title`, the title first. */
  function lane(title) {
    const heading = tree.root.findAll(node => node.type === 'Text' && lineOf(node) === title)[0];
    expect(heading).toBeDefined();
    return box(heading).findAll(node => node.type === 'Text').map(lineOf);
  }
  /** The texts drawn with the system's font, or in a colour that is not the palette's. */
  function offTokenTexts() {
    return tree.root.findAll(node => node.type === 'Text').filter(node => {
      const style = StyleSheet.flatten(node.props.style) ?? {};
      return !TYPE_TOKENS.includes(`${style.fontSize}/${style.fontWeight}`) || !PALETTE.includes(style.color);
    }).map(lineOf);
  }
  const input = label => tree.root.findAll(node =>
    node.props.accessibilityLabel === label && typeof node.props.onChangeText === 'function')[0];
  const reread = () => renderer.act(async () => mockSubscribe.mock.calls[0][0](['attendance_draft']));

  // A test that stops half-way must not leave its queued answers to the next one.
  beforeEach(() => {
    mockRead.mockReset().mockResolvedValue(snapshot());
    mockReadPending.mockReset().mockResolvedValue(null);
    mockSave.mockReset().mockResolvedValue({ contribution: contribution(1, 'Observado'), replayed: false });
  });

  test('without OCC’s contribution the lane says so in one line', async () => {
    mockRead.mockResolvedValue({ ...snapshot(), occ: null });
    await render(PUJ);
    expect(textContent()).toContain('OCC aún no registra horas.');
    // «Inicio: Sin registrar», «Fin: Sin registrar», «Sin nota de OCC», «Guardado: Sin registrar» and «Revisión 0»
    // are gone.
    expect(lane('Aporte de OCC')).toEqual(['Aporte de OCC', 'OCC aún no registra horas.']);
  });

  test('a note without hours is shown, with when OCC recorded it and its revision', async () => {
    // snapshot(): OCC wrote a note at 10:00 UTC, 06:00 at PUJ, and no hours.
    await render({ ...PUJ, operationDate: '2026-10-05' });
    expect(lane('Aporte de OCC')).toEqual(['Aporte de OCC', 'Inicio — · Fin —', 'Turno confirmado por OCC',
      expect.stringMatching(/^Registrado 5 oct\.?,? 06:00$/), 'Revisión 1']);
    expect(textContent()).not.toContain('OCC aún no registra horas');
  });

  test('OCC’s hours read «Inicio 19:48 · Fin —» on the operation’s day, with their date on another', async () => {
    mockRead.mockResolvedValueOnce({ ...snapshot(), occ: occ({ revision: 2,
      observedStartAt: '2026-11-16T23:48:00Z', recordedAt: '2026-11-16T23:50:00Z' }) })
      .mockResolvedValueOnce({ ...snapshot(), occ: occ({ revision: 3, observedStartAt: '2026-11-16T23:48:00Z',
        observedEndAt: '2026-11-17T04:30:00Z', incidentNote: 'Relevo después de medianoche',
        recordedAt: '2026-11-17T04:35:00Z' }) });
    await render({ ...PUJ, operationDate: '2026-11-16' });
    expect(lane('Aporte de OCC')).toEqual(['Aporte de OCC', 'Inicio 19:48 · Fin —',
      expect.stringMatching(/^Registrado 16 nov\.?,? 19:50$/), 'Revisión 2']);
    await reread();
    // 04:30 UTC is 00:30 on 17 November at PUJ, the day after the operation's.
    expect(lane('Aporte de OCC')).toEqual(['Aporte de OCC',
      expect.stringMatching(/^Inicio 19:48 · Fin 17 nov\.?,? 00:30$/), 'Relevo después de medianoche',
      expect.stringMatching(/^Registrado 17 nov\.?,? 00:35$/), 'Revisión 3']);
  });

  test('the operation’s day is the station’s, never UTC’s or the device’s', async () => {
    mockRead.mockResolvedValue({ ...snapshot(), occ: occ({
      // 01:45 on 5 October in Kathmandu (UTC+5:45): still 4 October in UTC and on this device.
      observedStartAt: '2026-10-04T20:00:00Z',
      // 00:45 on 6 October in Kathmandu: still 5 October in UTC and on this device.
      observedEndAt: '2026-10-05T19:00:00Z' }) });
    await render({ timeZone: 'Asia/Kathmandu', stationCode: 'KTM', operationDate: '2026-10-05' });
    expect(lane('Aporte de OCC')[1]).toMatch(/^Inicio 01:45 · Fin 6 oct\.?,? 00:45$/);
  });

  test('the fields are 56 dp high (touch.min, ADR-0031) and use the typography of «Datos del vuelo»', async () => {
    await render(PUJ);
    const fields = tree.root.findAll(node => node.type === 'TextInput');
    expect(fields.map(node => node.props.accessibilityLabel))
      .toEqual(['Inicio observado', 'Fin observado', 'Nota del agente']);
    for (const field of fields) {
      const style = StyleSheet.flatten(field.props.style);
      expect(style.minHeight).toBeGreaterThanOrEqual(56);
      expect(style).toMatchObject({ fontSize: 18, fontWeight: '700', color: colors.ink });
    }
  });

  test('both revision counters stay (D-N8)', async () => {
    mockRead.mockResolvedValue({ ...snapshot(contribution(4, 'Mi nota')),
      occ: occ({ revision: 2, observedStartAt: '2026-10-05T10:00:00Z' }) });
    await render({ ...PUJ, operationDate: '2026-10-05' });
    expect(lane('Aporte de OCC')).toContain('Revisión 2');
    expect(lane('Tu observación')).toContain('Revisión guardada 4');
  });

  const pending = { idempotencyKey: key,
    request: { expectedRevision: 0, observedStartAt: null, observedEndAt: null, incidentNote: 'En revisión' } };
  const states = {
    'loading': async () => {
      mockRead.mockReturnValue(new Promise(() => {}));
      await render(PUJ);
      return 'Cargando observaciones…';
    },
    'unavailable, with its notice': async () => {
      mockRead.mockRejectedValue(new MobileServiceError('network_unavailable'));
      await render(PUJ);
      return 'Observaciones no disponibles.';
    },
    'without OCC’s contribution': async () => {
      mockRead.mockResolvedValue({ ...snapshot(), occ: null });
      await render(PUJ);
      return 'OCC aún no registra horas.';
    },
    'with OCC’s hours, the agent’s revision and a validation error': async () => {
      mockRead.mockResolvedValue({ ...snapshot(contribution(1, 'Mi nota')),
        occ: occ({ observedStartAt: '2026-10-05T10:00:00Z', incidentNote: 'Turno confirmado por OCC' }) });
      await render({ ...PUJ, operationDate: '2026-10-05' });
      await renderer.act(async () => input('Inicio observado').props.onChangeText('mañana'));
      await renderer.act(async () => press('Guardar observación'));
      return 'Comprueba fecha, hora y nota antes de guardar. Usa AAAA-MM-DD HH:mm.';
    },
    'waiting for confirmation': async () => {
      mockReadPending.mockResolvedValue(pending);
      await render(PUJ);
      return 'Pendiente de confirmar';
    },
    'in conflict with the saved version': async () => {
      mockRead
        .mockResolvedValueOnce(snapshot({ ...contribution(1, 'Igual'), observedStartAt: '2026-10-05T10:00:00Z' }))
        .mockResolvedValueOnce(snapshot({ ...contribution(2, 'Igual'), observedStartAt: '2026-10-05T11:00:00Z' }));
      await render(PUJ);
      await renderer.act(async () => input('Inicio observado').props.onChangeText('2026-10-05 08:00'));
      await reread();
      return 'Conflicto con la revisión actual del agente.';
    },
    'in conflict before the saved version is read': async () => {
      mockRead.mockResolvedValueOnce(snapshot(contribution(1, 'Inicial')))
        .mockRejectedValueOnce(new MobileServiceError('network_unavailable'));
      mockSave.mockRejectedValueOnce(new MobileServiceError('conflict', { status: 409 }));
      mockReadPending.mockResolvedValueOnce(null).mockResolvedValue({ ...pending,
        request: { ...pending.request, expectedRevision: 1 } });
      await render(PUJ);
      await renderer.act(async () => input('Nota del agente').props.onChangeText('En revisión'));
      await renderer.act(async () => press('Guardar observación'));
      return 'Actualiza la versión guardada antes de decidir.';
    },
  };

  test.each(Object.keys(states))('every text takes its type from the tokens and its colour from the palette: %s',
    async name => {
      const shown = await states[name]();
      expect(textContent()).toContain(shown);
      expect(offTokenTexts()).toEqual([]);
    });
});
