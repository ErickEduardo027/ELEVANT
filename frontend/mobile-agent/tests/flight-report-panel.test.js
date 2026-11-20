// The «Reporte de vuelo» panel: one tap records a milestone at ELEVANT's time (3-N18); the adjustment stays inside the
// operation's window (3-N25), and a correction round records the times of the flight, never «AHORA» (3-N09). A time or
// the flight data the tablet could not keep says whether the session ended or the device's storage failed (N6). A
// push-back with the flight still half recorded asks first, with its reasons (N2, decision 23).
const React = require('react');
const renderer = require('react-test-renderer');

const mockRecord = jest.fn();
const mockSaveFlightData = jest.fn();
let mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };
let mockNow = Date.parse('2026-11-09T14:00:00.000Z');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
// The four phases of the flight report, with fewer milestones than the form: two on stand and one at departure.
jest.mock('@elevant/api-client', () => ({
  FLIGHT_REPORT_PHASES: [
    { id: 'arrival', label: 'Llegada' }, { id: 'on_stand', label: 'En posición' },
    { id: 'departure', label: 'Salida' }, { id: 'pushback', label: 'Retroempuje' },
  ],
  FLIGHT_REPORT_MILESTONES: [
    { code: 'BLOCK_ON', label: 'Bloqueo', phase: 'arrival' },
    { code: 'FIRST_CUSTOMS', label: 'Primeras aduanas', phase: 'on_stand' },
    { code: 'LOAD_SHEET', label: 'Hoja de carga', phase: 'on_stand' },
    { code: 'BOARDING', label: 'Abordaje', phase: 'departure' },
    { code: 'PUSHBACK', label: 'Push-back', phase: 'pushback' },
  ],
  IATA_DELAY_CODES: [{ code: '93', label: 'Rotación de la aeronave' }],
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../src/services/flight-report', () => ({
  recordMilestone: (...args) => mockRecord(...args),
  saveFlightData: (...args) => mockSaveFlightData(...args),
  subscribeFlightReport: listener => { listener(mockSnapshot); return () => {}; },
}));
jest.mock('../src/services/mobile-service-error', () => ({
  MobileServiceError: class MobileServiceError extends Error {
    constructor(code) { super(code); this.code = code; }
  },
}));
jest.mock('../src/synchronization/server-clock', () => ({
  EVIDENCE_CLOCK_TOLERANCE_MS: 120_000,
  serverNow: () => new Date(mockNow),
}));
jest.mock('../src/services/ramp-incidents', () => ({ loadRampIncidentCenter: jest.fn(), reserveRampIncident: jest.fn() }));
jest.mock('../src/services/aircraft-types', () => ({ getRampAircraftTypes: jest.fn(), aircraftTypeLabel: () => '' }));

const { DeviationAction, FlightDataCard, FlightReportPanel } = require('../src/components/flight-report/flight-report-panel');
const { loadRampIncidentCenter, reserveRampIncident } = require('../src/services/ramp-incidents');
const { getRampAircraftTypes } = require('../src/services/aircraft-types');
const { MobileServiceError } = require('../src/services/mobile-service-error');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const TIME_ZONE = 'America/Santo_Domingo';

function operation({ milestones = [], review = null, arrivalAt = null, startedAt = '2026-11-07T20:00:00.000Z',
  services = [], stand = null } = {}) {
  return {
    operation: { id: OPERATION_ID, status: 'InProgress', actualStartAt: startedAt, actualEndAt: null },
    turnaround: { arrival: arrivalAt ? { actualAt: arrivalAt } : null, aircraft: null, stand },
    review, milestones, services,
  };
}

async function render(props) {
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(FlightReportPanel, { timeZone: TIME_ZONE, editable: true, ...props }));
  });
  return tree;
}

const pressable = (tree, label) => tree.root.findAll(node => typeof node.props.onPress === 'function' &&
  (node.props.accessibilityLabel === label || node.props.title === label))[0];
const tab = (tree, label) => tree.root.findAll(node => node.props.accessibilityRole === 'tab' &&
  String(node.props.accessibilityLabel).startsWith(label) && typeof node.props.onPress === 'function')[0];
const text = tree => JSON.stringify(tree.toJSON());
const press = async node => { await renderer.act(async () => { node.props.onPress(); }); };

beforeEach(() => {
  jest.clearAllMocks();
  mockNow = Date.parse('2026-11-09T14:00:00.000Z');
  mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };
  mockRecord.mockResolvedValue(undefined);
  mockSaveFlightData.mockResolvedValue(undefined);
});

describe('correction round (3-N09)', () => {
  const returned = { submissionId: '80000000-0000-4000-8000-000000000001', revisionNumber: 1, status: 'Returned',
    returnReason: 'Falta el bloqueo' };

  test('an empty milestone opens the adjustment at the last recorded time instead of recording «AHORA»', async () => {
    // Started on Saturday, pushed back two hours later, returned by OCC and corrected on Monday.
    const tree = await render({ operation: operation({ review: returned,
      milestones: [{ code: 'PUSHBACK', actualAt: '2026-11-07T22:00:00.000Z' }] }) });
    expect(text(tree)).toContain('Corrección: registra cada hora como ocurrió en el vuelo, no la hora actual.');
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo. Toca para registrar su hora.'));
    expect(mockRecord).not.toHaveBeenCalled();
    expect(pressable(tree, 'AHORA')).toBeUndefined();
    // ELEVANT takes a milestone of the correction until the first hand-off, not until now.
    expect(text(tree)).toContain('hasta tu primera entrega a OCC (hora de la estación).');
    expect(text(tree)).not.toContain('hasta ahora');
    // Saturday 18:00 at the station (UTC−4): the time the push-back was recorded, two days ago.
    expect(text(tree)).toContain('18:00');
    await press(pressable(tree, 'Menos 60 minutos'));
    await press(pressable(tree, 'Menos 10 minutos'));
    await press(pressable(tree, 'GUARDAR HORA'));
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'BLOCK_ON', new Date('2026-11-07T20:50:00.000Z'), TIME_ZONE);
  });

  test('the adjustment never goes before the operation’s window nor after now', async () => {
    const tree = await render({ operation: operation({ review: returned, arrivalAt: '2026-11-07T19:30:00.000Z',
      milestones: [{ code: 'PUSHBACK', actualAt: '2026-11-07T22:00:00.000Z' }] }) });
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo. Toca para registrar su hora.'));
    for (let step = 0; step < 4; step += 1) await press(pressable(tree, 'Menos 60 minutos'));
    await press(pressable(tree, 'GUARDAR HORA'));
    // The recorded arrival opened the window, with the server's two-minute tolerance.
    expect(mockRecord).toHaveBeenLastCalledWith(OPERATION_ID, 'BLOCK_ON', new Date('2026-11-07T19:28:00.000Z'), TIME_ZONE);
  });
});

describe('a running operation', () => {
  test('a recorded milestone adjusts up to now by ELEVANT’s clock', async () => {
    mockNow = Date.parse('2026-11-07T21:00:00.000Z');
    const tree = await render({ operation: operation({ milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-07T20:55:00.000Z' }] }) });
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo, 16:55, Confirmado. Toca para ajustar.'));
    expect(pressable(tree, 'AHORA')).toBeDefined();
    expect(text(tree)).toContain('hasta ahora (hora de la estación).');
    await press(pressable(tree, 'Más 60 minutos'));
    await press(pressable(tree, 'GUARDAR HORA'));
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'BLOCK_ON', new Date('2026-11-07T21:00:00.000Z'), TIME_ZONE);
  });

  test('the adjustment writes the day as «sáb, 7 nov», without forced capitals (N11)', async () => {
    mockNow = Date.parse('2026-11-07T21:00:00.000Z');
    const tree = await render({ operation: operation({ milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-07T20:55:00.000Z' }] }) });
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo, 16:55, Confirmado. Toca para ajustar.'));
    const day = tree.root.findAll(node => node.type === 'Text' && /^sáb\.?, 7 nov\.?$/.test(node.props.children))[0];
    expect(day).toBeDefined();
    expect(require('react-native').StyleSheet.flatten(day.props.style).textTransform).toBeUndefined();
    // The window opened two minutes before the 16:00 start, at the station.
    expect(text(tree)).toMatch(/Hora válida desde sáb\.?, 7 nov\.? 15:58 hasta ahora \(hora de la estación\)\./);
  });
});

describe('a tablet whose clock runs ahead (3-N18)', () => {
  beforeEach(() => {
    // The device says 14:11; ELEVANT, 14:00. Only the date is faked: React still schedules with real timers.
    jest.useFakeTimers({ now: mockNow + 11 * 60_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
  });
  afterEach(() => { jest.useRealTimers(); });

  test('«AHORA» records ELEVANT’s time, not the tablet’s', async () => {
    const tree = await render({ operation: operation() });
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo. Toca para registrar ahora.'));
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'BLOCK_ON', new Date('2026-11-09T14:00:00.000Z'), TIME_ZONE);
  });

  test('a deviation reaches OCC with ELEVANT’s time', async () => {
    reserveRampIncident.mockResolvedValue([]);
    loadRampIncidentCenter.mockResolvedValue(null);
    let tree;
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(DeviationAction, { operationId: OPERATION_ID, editable: true }));
    });
    const open = tree.root.findAll(node => node.props.accessibilityRole === 'button' && typeof node.props.onPress === 'function'
      && node.findAll(child => child.props.children === 'Reportar desviación').length > 0)[0];
    await press(open);
    await press(tree.root.findAll(node => node.props.accessibilityRole === 'radio' && typeof node.props.onPress === 'function')[0]);
    const note = tree.root.findAll(node => node.props.accessibilityLabel === 'Qué pasó'
      && typeof node.props.onChangeText === 'function')[0];
    await renderer.act(async () => { note.props.onChangeText('Esperando la rotación de la aeronave'); });
    await press(pressable(tree, 'ENVIAR A OCC'));
    expect(reserveRampIncident).toHaveBeenCalledWith(OPERATION_ID, expect.objectContaining({
      incidentType: 'Deviation', delayCode: '93', occurredAt: '2026-11-09T14:00:00.000Z' }));
  });
});

describe('a time or the flight data the tablet could not keep (N6)', () => {
  /** What the old panel said whatever happened: it blamed the device. */
  const BLAMES_THE_DEVICE = /No se pudo guardar en el dispositivo|Desbloque/;
  // The first card a run renders loads React Native's lists, which can exceed 5 s on a cold cache (flight-data-card).
  const COLD_RENDER_MS = 30_000;

  async function tapBlockOn() {
    const tree = await render({ operation: operation() });
    await press(tab(tree, 'Llegada'));
    await press(pressable(tree, 'Bloqueo. Toca para registrar ahora.'));
    await renderer.act(async () => {});
    return tree;
  }

  async function saveFlightDataCard() {
    getRampAircraftTypes.mockResolvedValue({ types: [], available: false, fromCache: false });
    const flight = operation();
    let tree;
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(FlightDataCard, { editable: true, operation: {
        ...flight, operation: { ...flight.operation, passengersIn: 120, passengersOut: 118, mtowKg: 70000 },
      } }));
    });
    await press(pressable(tree, 'GUARDAR DATOS DEL VUELO'));
    await renderer.act(async () => {});
    return tree;
  }

  test.each(['session_expired', 'unauthenticated'])('a milestone after the session ended (%s) says so', async code => {
    mockRecord.mockRejectedValue(new MobileServiceError(code));
    const tree = await tapBlockOn();
    expect(mockRecord).toHaveBeenCalled();
    expect(text(tree)).toContain('Tu sesión terminó y la hora no se guardó. Entra de nuevo con tu cuenta para registrarla.');
    expect(text(tree)).not.toMatch(BLAMES_THE_DEVICE);
  }, COLD_RENDER_MS);

  test('a milestone the device’s storage could not keep says what to do', async () => {
    mockRecord.mockRejectedValue(new MobileServiceError('storage_unavailable'));
    const tree = await tapBlockOn();
    expect(text(tree)).toContain('La tablet no pudo guardar la hora. Vuelve a intentarlo; si sigue fallando, cierra la app, ' +
      'ábrela de nuevo y avisa a OCC.');
    expect(text(tree)).not.toMatch(BLAMES_THE_DEVICE);
  }, COLD_RENDER_MS);

  test('the flight data after the session ended says so', async () => {
    mockSaveFlightData.mockRejectedValue(new MobileServiceError('session_expired'));
    const tree = await saveFlightDataCard();
    expect(mockSaveFlightData).toHaveBeenCalled();
    expect(text(tree)).toContain('Tu sesión terminó y los datos del vuelo no se guardaron. Entra de nuevo con tu cuenta ' +
      'para guardarlos.');
    expect(text(tree)).not.toMatch(BLAMES_THE_DEVICE);
  }, COLD_RENDER_MS);

  test('the flight data the device’s storage could not keep says what to do', async () => {
    mockSaveFlightData.mockRejectedValue(new MobileServiceError('storage_unavailable'));
    const tree = await saveFlightDataCard();
    expect(text(tree)).toContain('La tablet no pudo guardar los datos del vuelo. Vuelve a intentarlo; si sigue fallando, ' +
      'cierra la app, ábrela de nuevo y avisa a OCC.');
    expect(text(tree)).not.toMatch(BLAMES_THE_DEVICE);
  }, COLD_RENDER_MS);
});

describe('push-back (decisión 23)', () => {
  // N2 (D-N2): a push-back recorded with «En posición» and «Salida» empty and every service still planned released the
  // stand in OCC, closed the ground time and fixed the Service Order's departure time. Before the first record of the
  // push-back, outside a correction round, the panel asks and lists its reasons; with none, one tap still records it.
  // The server keeps its rule: only BLOCK_ON ≤ PUSHBACK (3-N25).
  const TITLE = '¿Registrar el push-back ahora?';
  const STAND = { code: 'A11', terminal: { code: 'A' } };
  const SECOND_SERVICE = '71000000-0000-4000-8000-000000000002';
  const service = (status, id = '71000000-0000-4000-8000-000000000001') => ({ id, status });
  /** What a normal push-back finds recorded: the block-on and a milestone of «En posición» and of «Salida». */
  const SEQUENCE = [
    { code: 'BLOCK_ON', actualAt: '2026-11-09T12:00:00.000Z' },
    { code: 'LOAD_SHEET', actualAt: '2026-11-09T13:10:00.000Z' },
    { code: 'BOARDING', actualAt: '2026-11-09T13:30:00.000Z' },
  ];
  const ORDER_REASON = 'Orden de Servicio: ya tiene firma; el push-back cambia su hora de salida y hay que volver a ' +
    'firmarla.';
  const SIGNATURE = { role: 'AirlineRepresentative', signerName: 'Ana Pérez', signedAt: '2026-11-09T13:40:00.000Z' };
  /** The operation's forms as the device last read them: the Service Order with these signatures on its content. */
  const forms = (signatures, staleRoles = []) => ({ [OPERATION_ID]: { operationId: OPERATION_ID, damageMarks: [],
    documents: [{ kind: 'ServiceOrder', title: 'Orden de Servicio', isFullySigned: false, staleRoles,
      requiredRoles: ['AirlineRepresentative', 'AviamAgent'], signatures }] } });
  const queuedSignature = state => ({ idempotencyKey: '76000000-0000-4000-8000-000000000001', state, attempts: 0,
    createdAt: '2026-11-09T13:40:00.000Z', command: { kind: 'signature', operationId: OPERATION_ID,
      documentKind: 'ServiceOrder', role: 'AirlineRepresentative', signerName: 'Ana Pérez', documentSha256: 'a'.repeat(64),
      strokes: [[0.1, 0.1, 0.2, 0.2]] } });

  const modal = tree => tree.root.findAll(node => node.type === 'Modal')[0];
  const textOf = scope => scope.findAll(node => node.type === 'Text').flatMap(node => [node.props.children].flat())
    .filter(child => typeof child === 'string').join(' ');
  /** The push-back sheet, while it is open. */
  const pushbackSheet = tree => {
    const open = modal(tree);
    return open && textOf(open).includes(TITLE) ? open : undefined;
  };
  /** What the sheet lists, each reason as a screen reader says it. */
  const reasons = scope => scope.findAll(node => node.type === 'View' && node.props.accessible === true &&
    node.props.accessibilityRole !== 'button' && typeof node.props.accessibilityLabel === 'string')
    .map(node => node.props.accessibilityLabel);
  const sheetButton = (tree, title) => pushbackSheet(tree).findAll(node => node.props?.title === title &&
    typeof node.props.onPress === 'function')[0];
  const EMPTY_PUSHBACK = 'Push-back. Toca para registrar ahora.';
  async function tapPushback(tree) {
    await press(tab(tree, 'Retroempuje'));
    await press(pressable(tree, EMPTY_PUSHBACK));
  }

  test('the sheet lists the reasons in the order of the flight and what the push-back does, and records nothing', async () => {
    mockSnapshot = { ...mockSnapshot, documents: forms([SIGNATURE]) };
    const tree = await render({ operation: operation({ stand: STAND,
      services: [service('Planned'), service('Planned', SECOND_SERVICE)] }) });
    await tapPushback(tree);
    expect(mockRecord).not.toHaveBeenCalled();
    const sheet = pushbackSheet(tree);
    expect(sheet).toBeDefined();
    expect(textOf(sheet)).toContain('Antes de registrarlo, revisa:');
    expect(reasons(sheet)).toEqual([
      'Llegada: falta «Bloqueo».',
      'En posición: 0 de 2 hitos registrados.',
      'Salida: 0 de 1 hito registrado.',
      'Servicios: ninguno de los 2 se inició.',
      ORDER_REASON,
    ]);
    // What recording it does: decision 23 releases the stand, and correcting the time does not take it back.
    expect(textOf(sheet)).toContain('Registrarlo libera la posición A11 en OCC, cierra el tiempo en tierra y fija la ' +
      'hora de salida de la Orden de Servicio. Corregir la hora después no vuelve a ocupar la posición.');
    expect(sheetButton(tree, 'VOLVER')).toBeDefined();
    expect(sheetButton(tree, 'REGISTRAR PUSH-BACK')).toBeDefined();
    expect(pressable(tree, 'Cerrar sin registrar')).toBeDefined();
  });

  test('VOLVER, the header’s button and Android’s back button close the sheet without recording', async () => {
    const tree = await render({ operation: operation({ stand: STAND }) });
    await tapPushback(tree);
    await press(sheetButton(tree, 'VOLVER'));
    expect(pushbackSheet(tree)).toBeUndefined();
    await press(pressable(tree, EMPTY_PUSHBACK));
    await press(pressable(tree, 'Cerrar sin registrar'));
    expect(pushbackSheet(tree)).toBeUndefined();
    await press(pressable(tree, EMPTY_PUSHBACK));
    await renderer.act(async () => { modal(tree).props.onRequestClose(); });
    expect(pushbackSheet(tree)).toBeUndefined();
    expect(mockRecord).not.toHaveBeenCalled();
    // The push-back is still empty, so the next tap asks again.
    await press(pressable(tree, EMPTY_PUSHBACK));
    expect(pushbackSheet(tree)).toBeDefined();
    expect(mockRecord).not.toHaveBeenCalled();
  });

  test('REGISTRAR PUSH-BACK records it at ELEVANT’s time when the agent confirms', async () => {
    // The device says 14:11; ELEVANT, 14:00. Only the date is faked: React still schedules with real timers.
    jest.useFakeTimers({ now: mockNow + 11 * 60_000, doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask',
      'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    try {
      const tree = await render({ operation: operation({ stand: STAND }) });
      await tapPushback(tree);
      // The agent reads the reasons for a minute by ELEVANT's clock: «ahora» is when the agent confirms.
      mockNow += 60_000;
      await press(sheetButton(tree, 'REGISTRAR PUSH-BACK'));
      expect(mockRecord).toHaveBeenCalledTimes(1);
      expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'PUSHBACK', new Date('2026-11-09T14:01:00.000Z'), TIME_ZONE);
      expect(pushbackSheet(tree)).toBeUndefined();
    } finally {
      jest.useRealTimers();
    }
  });

  test('without services there is no reason about them, and without a stand none about releasing it', async () => {
    const tree = await render({ operation: operation() });
    await tapPushback(tree);
    const sheet = pushbackSheet(tree);
    expect(reasons(sheet)).toEqual([
      'Llegada: falta «Bloqueo».',
      'En posición: 0 de 2 hitos registrados.',
      'Salida: 0 de 1 hito registrado.',
    ]);
    expect(textOf(sheet)).toContain('Registrarlo cierra el tiempo en tierra y fija la hora de salida de la Orden de ' +
      'Servicio.');
    expect(textOf(sheet)).not.toMatch(/libera la posición|vuelve a ocupar/);
  });

  test('a Service Order already signed is a reason, also while its signature waits on the device', async () => {
    const complete = operation({ stand: STAND, milestones: SEQUENCE, services: [service('Completed')] });
    mockSnapshot = { ...mockSnapshot, documents: forms([SIGNATURE]) };
    let tree = await render({ operation: complete });
    await tapPushback(tree);
    expect(reasons(pushbackSheet(tree))).toEqual([ORDER_REASON]);
    await renderer.act(async () => tree.unmount());

    // Signed without signal: the signature waits in the queue and goes stale once the push-back reaches the Order.
    mockSnapshot = { ...mockSnapshot, documents: forms([]), items: [queuedSignature('pending')] };
    tree = await render({ operation: complete });
    await tapPushback(tree);
    expect(reasons(pushbackSheet(tree))).toEqual([ORDER_REASON]);
    await renderer.act(async () => tree.unmount());

    // A signature ELEVANT refused is not on the Order, and a stale one has to be given again anyway: one tap.
    mockSnapshot = { ...mockSnapshot, documents: forms([], ['AirlineRepresentative']), items: [queuedSignature('blocked')] };
    tree = await render({ operation: complete });
    await tapPushback(tree);
    expect(pushbackSheet(tree)).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'PUSHBACK', new Date('2026-11-09T14:00:00.000Z'), TIME_ZONE);
  });

  test('a push-back waiting in the queue opens the adjustment, not the sheet', async () => {
    mockSnapshot = { ...mockSnapshot, items: [{ idempotencyKey: '76000000-0000-4000-8000-000000000002', state: 'pending',
      attempts: 0, createdAt: '2026-11-09T13:55:00.000Z',
      command: { kind: 'milestone', operationId: OPERATION_ID, code: 'PUSHBACK', occurredAt: '2026-11-09T13:55:00.000Z' } }] };
    const tree = await render({ operation: operation({ stand: STAND }) });
    await press(tab(tree, 'Retroempuje'));
    await press(pressable(tree, 'Push-back, 09:55, En el dispositivo. Toca para ajustar.'));
    expect(pushbackSheet(tree)).toBeUndefined();
    await press(pressable(tree, 'GUARDAR HORA'));
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'PUSHBACK', new Date('2026-11-09T13:55:00.000Z'), TIME_ZONE);
  });

  test('a correction round records the push-back from the adjustment, without the sheet', async () => {
    const returned = { submissionId: '80000000-0000-4000-8000-000000000001', revisionNumber: 1, status: 'Returned',
      returnReason: 'Falta el push-back' };
    const tree = await render({ operation: operation({ review: returned, stand: STAND,
      milestones: [{ code: 'BOARDING', actualAt: '2026-11-07T21:30:00.000Z' }] }) });
    await press(tab(tree, 'Retroempuje'));
    await press(pressable(tree, 'Push-back. Toca para registrar su hora.'));
    expect(pushbackSheet(tree)).toBeUndefined();
    await press(pressable(tree, 'GUARDAR HORA'));
    expect(pushbackSheet(tree)).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'PUSHBACK', new Date('2026-11-07T21:30:00.000Z'), TIME_ZONE);
  });

  test('a complete sequence records the push-back with one tap', async () => {
    // One service started is enough: «ninguno se inició» is not true.
    const tree = await render({ operation: operation({ stand: STAND, milestones: SEQUENCE,
      services: [service('Completed'), service('Planned', SECOND_SERVICE)] }) });
    await tapPushback(tree);
    expect(pushbackSheet(tree)).toBeUndefined();
    expect(mockRecord).toHaveBeenCalledWith(OPERATION_ID, 'PUSHBACK', new Date('2026-11-09T14:00:00.000Z'), TIME_ZONE);
  });

  test('pushbackConcerns: each reason once, the services only when none left «planificado»', () => {
    const { pushbackConcerns } = require('../src/features/assigned-operations/pushback');
    const met = new Set(SEQUENCE.map(item => item.code));
    expect(pushbackConcerns({ recorded: new Set(), services: [], orderSigned: false }).map(item => item.kind))
      .toEqual(['blockOn', 'on_stand', 'departure']);
    expect(pushbackConcerns({ recorded: met, services: [], orderSigned: false })).toEqual([]);
    // One milestone of a phase is enough for it; the push-back's own phase is not asked about.
    expect(pushbackConcerns({ recorded: new Set(['BLOCK_ON', 'FIRST_CUSTOMS', 'BOARDING']), services: [],
      orderSigned: false })).toEqual([]);
    expect(pushbackConcerns({ recorded: met, services: [service('Planned')], orderSigned: false }))
      .toEqual([{ kind: 'services', text: 'Servicios: el servicio no se inició.' }]);
    // A service not performed or in an exception was decided on: the agent got to the services.
    for (const status of ['InProgress', 'Completed', 'NotPerformed', 'Exception']) {
      expect({ status, concerns: pushbackConcerns({ recorded: met,
        services: [service('Planned'), service(status, SECOND_SERVICE)], orderSigned: false }) })
        .toEqual({ status, concerns: [] });
    }
    expect(pushbackConcerns({ recorded: met, services: [], orderSigned: true }))
      .toEqual([{ kind: 'signedOrder', text: ORDER_REASON }]);
  });
});
