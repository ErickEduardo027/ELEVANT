// The «Reporte de vuelo» panel: one tap records a milestone at ELEVANT's time (3-N18); the adjustment stays inside the
// operation's window (3-N25), and a correction round records the times of the flight, never «AHORA» (3-N09). A time or
// the flight data the tablet could not keep says whether the session ended or the device's storage failed (N6).
const React = require('react');
const renderer = require('react-test-renderer');

const mockRecord = jest.fn();
const mockSaveFlightData = jest.fn();
let mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };
let mockNow = Date.parse('2026-11-09T14:00:00.000Z');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => ({
  FLIGHT_REPORT_PHASES: [{ id: 'arrival', label: 'Llegada' }, { id: 'pushback', label: 'Retroempuje' }],
  FLIGHT_REPORT_MILESTONES: [
    { code: 'BLOCK_ON', label: 'Bloqueo', phase: 'arrival' },
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

function operation({ milestones = [], review = null, arrivalAt = null, startedAt = '2026-11-07T20:00:00.000Z' } = {}) {
  return {
    operation: { id: OPERATION_ID, status: 'InProgress', actualStartAt: startedAt, actualEndAt: null },
    turnaround: { arrival: arrivalAt ? { actualAt: arrivalAt } : null, aircraft: null },
    review, milestones, services: [],
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
