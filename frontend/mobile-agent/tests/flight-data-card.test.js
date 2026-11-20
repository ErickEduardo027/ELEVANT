// «Datos del vuelo»: passengers, MTOW, registration and the aircraft type, typed once (ADR-0031, 3-B). Since S1 every
// field is read exactly (src/utils/flight-data.ts) and says its own error, nothing the agent typed is lost when the
// queue moves, and the card says what is still missing and what is not saved yet.
const React = require('react');
const renderer = require('react-test-renderer');

// The first modal list a run renders loads React Native's virtualized list.
jest.setTimeout(30000);

const mockSave = jest.fn();
const mockTypes = jest.fn();
let mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {} };
/** The card's subscriptions to the queue, so a test moves it as the service does. */
const mockListeners = new Set();

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => ({ FLIGHT_REPORT_MILESTONES: [], FLIGHT_REPORT_PHASES: [], IATA_DELAY_CODES: [] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../src/services/flight-report', () => ({
  recordMilestone: jest.fn(),
  saveFlightData: (...args) => mockSave(...args),
  subscribeFlightReport: listener => {
    mockListeners.add(listener);
    listener(mockSnapshot);
    return () => { mockListeners.delete(listener); };
  },
}));
jest.mock('../src/services/ramp-incidents', () => ({ loadRampIncidentCenter: jest.fn(), reserveRampIncident: jest.fn() }));
jest.mock('../src/services/aircraft-types', () => ({
  getRampAircraftTypes: (...args) => mockTypes(...args),
  aircraftTypeLabel: type => `${type.manufacturer} ${type.model} · ${type.icaoCode}`,
}));

const { StyleSheet, TextInput } = require('react-native');
const { FlightDataCard } = require('../src/components/flight-report/flight-report-panel');
const { colors } = require('../src/theme/colors');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const A320 = { id: '60000000-0000-4000-8000-000000000001', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320-200' };
const B738 = { id: '60000000-0000-4000-8000-000000000002', icaoCode: 'B738', iataCode: null, manufacturer: 'Boeing', model: '737-800' };
const operation = aircraft => ({
  operation: { id: OPERATION_ID, passengersIn: 120, passengersOut: 118, mtowKg: 70000 },
  turnaround: { aircraft },
});

async function render(props) {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(FlightDataCard, props)); });
  return tree;
}

const byLabel = (tree, label) => tree.root.findAll(node => node.props.accessibilityLabel === label &&
  typeof node.props.onPress === 'function')[0];
const text = tree => JSON.stringify(tree.toJSON());

/** Flight data waiting in the device's queue, as the service keeps it. */
const waiting = data => ({ idempotencyKey: '90000000-0000-4000-8000-000000000002', createdAt: '2026-11-16T19:00:00.000Z',
  state: 'pending', attempts: 0, command: { kind: 'flightData', operationId: OPERATION_ID, ...data } });

/** The queue moves, as the service announces it: the queue read from the device after the first render, or a save. */
async function publish(snapshot) {
  mockSnapshot = snapshot;
  await renderer.act(async () => { for (const listener of mockListeners) listener(mockSnapshot); });
}

beforeEach(() => {
  jest.clearAllMocks();
  mockListeners.clear();
  mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {} };
  // Like the service: the saved command is in the queue, and the queue announced, before the save resolves.
  mockSave.mockImplementation(async (_operationId, data) => {
    mockSnapshot = { ...mockSnapshot, items: [waiting(data)] };
    for (const listener of mockListeners) listener(mockSnapshot);
  });
});

it('lets the agent choose the aircraft type while the operation runs and sends it with the flight data (3-B)', async () => {
  mockTypes.mockResolvedValue({ types: [A320, B738], available: true, fromCache: false });
  const tree = await render({ operation: operation({ ...A320, registration: 'HI1055' }), editable: true });
  expect(text(tree)).toContain('Airbus A320-200 · A320');
  await renderer.act(async () => { byLabel(tree, 'Tipo de avión: Airbus A320-200 · A320').props.onPress(); });
  await renderer.act(async () => { byLabel(tree, 'Boeing 737-800 · B738').props.onPress(); });
  expect(text(tree)).toContain('Boeing 737-800 · B738');
  await renderer.act(async () => { byLabel(tree, 'GUARDAR DATOS DEL VUELO').props.onPress(); });
  expect(mockSave).toHaveBeenCalledWith(OPERATION_ID, { passengersIn: 120, passengersOut: 118, mtowKg: 70000,
    aircraftRegistration: 'HI1055', aircraftTypeId: B738.id });
  // Saved: the type waiting on the device is the one shown.
  expect(text(tree)).toContain('Boeing 737-800 · B738');
});

it('without touching the type the flight data keeps the body older versions sent', async () => {
  mockTypes.mockResolvedValue({ types: [A320, B738], available: true, fromCache: false });
  const tree = await render({ operation: operation(null), editable: true });
  expect(text(tree)).toContain('Sin tipo de avión registrado');
  await renderer.act(async () => { byLabel(tree, 'GUARDAR DATOS DEL VUELO').props.onPress(); });
  expect(mockSave).toHaveBeenCalledWith(OPERATION_ID, { passengersIn: 120, passengersOut: 118, mtowKg: 70000,
    aircraftRegistration: null });
});

it('shows the current type read-only without the catalog (no signal, older server) or once the operation ended', async () => {
  mockTypes.mockResolvedValue({ types: [], available: false, fromCache: false });
  let tree = await render({ operation: operation({ ...A320, registration: 'HI1055' }), editable: true });
  expect(byLabel(tree, 'Tipo de avión: Airbus A320-200 · A320')).toBeUndefined();
  expect(text(tree)).toContain('Airbus A320-200 · A320');
  expect(text(tree)).toContain('no se puede cambiar desde la tablet');

  mockTypes.mockResolvedValue({ types: [A320, B738], available: true, fromCache: true });
  tree = await render({ operation: operation({ ...A320, registration: 'HI1055' }), editable: false });
  expect(byLabel(tree, 'Tipo de avión: Airbus A320-200 · A320')).toBeUndefined();
  expect(text(tree)).toContain('guardada en el dispositivo');
});

it('keeps the type of the flight data still waiting on the device', async () => {
  mockTypes.mockResolvedValue({ types: [A320, B738], available: true, fromCache: false });
  mockSnapshot = { ...mockSnapshot, items: [{ idempotencyKey: '90000000-0000-4000-8000-000000000001', createdAt: 'x',
    state: 'pending', attempts: 0, command: { kind: 'flightData', operationId: OPERATION_ID, passengersIn: 1, passengersOut: 2,
      mtowKg: 70000, aircraftRegistration: null, aircraftTypeId: B738.id } }] };
  const tree = await render({ operation: operation({ ...A320, registration: null }), editable: true });
  expect(text(tree)).toContain('Boeing 737-800 · B738');
});

// S1: the Service Order was signed with «Pasajeros —» and «MTOW —». One generic error did not say which field failed or
// its range, «1.5» was read as 15, and the card was seeded once, before the queue arrived.
describe('one error per field and nothing typed is lost (S1)', () => {
  const PASSENGERS_IN = 'Pasajeros que llegan';
  const PASSENGERS_OUT = 'Pasajeros que salen';
  const MTOW = 'MTOW (kg)';
  const flight = (data = {}) => ({
    operation: { id: OPERATION_ID, passengersIn: null, passengersOut: null, mtowKg: null, ...data },
    turnaround: { aircraft: null },
  });
  const input = (tree, label) => tree.root.findAll(node => node.type === TextInput &&
    node.props.accessibilityLabel === label)[0];
  const valueOf = (tree, label) => input(tree, label).props.value;
  const type = async (tree, label, value) => {
    await renderer.act(async () => { input(tree, label).props.onChangeText(value); });
  };
  const save = async tree => {
    await renderer.act(async () => { byLabel(tree, 'GUARDAR DATOS DEL VUELO').props.onPress(); });
  };
  const textOf = node => [].concat(node.props.children).filter(child => typeof child === 'string').join('');
  const texts = scope => scope.findAll(node => node.type === 'Text').map(textOf);
  /** The field's box: the nearest host View above its input. */
  const fieldOf = (tree, label) => {
    let box = input(tree, label).parent;
    while (box && box.type !== 'View') box = box.parent;
    return box;
  };
  /** The message under a field, if it has one: the texts of its box other than its label. */
  const errorOf = (tree, label) => texts(fieldOf(tree, label)).filter(value => value !== label)[0];
  const borderOf = (tree, label) => StyleSheet.flatten(input(tree, label).props.style).borderColor;
  const focus = () => TextInput.prototype.focus;

  beforeEach(() => mockTypes.mockResolvedValue({ types: [], available: false, fromCache: false }));

  test('«142138» passengers and a 78 MTOW give one message each, save nothing and focus «Pasajeros que llegan»',
    async () => {
      const tree = await render({ operation: flight(), editable: true });
      await type(tree, PASSENGERS_IN, '142138');
      await type(tree, MTOW, '78');
      await save(tree);
      expect(mockSave).not.toHaveBeenCalled();
      expect(errorOf(tree, PASSENGERS_IN)).toBe('Debe ser de 0 a 999 pasajeros.');
      expect(errorOf(tree, MTOW)).toBe('¿Toneladas? El MTOW va en kg: 78 t son 78,000 kg.');
      expect(errorOf(tree, PASSENGERS_OUT)).toBeUndefined();
      // A red edge on each wrong field, and its message for the screen reader.
      for (const label of [PASSENGERS_IN, MTOW]) {
        expect(borderOf(tree, label)).toBe(colors.danger);
        expect(input(tree, label).props.accessibilityHint).toBe(errorOf(tree, label));
      }
      expect(borderOf(tree, PASSENGERS_OUT)).not.toBe(colors.danger);
      // A summary beside the button, and the focus on the first wrong field.
      expect(texts(tree.root)).toContain('No se guardó: revisa Pasajeros que llegan y MTOW (kg).');
      expect(focus()).toHaveBeenCalledTimes(1);
      expect(focus().mock.contexts[0]).toBe(input(tree, PASSENGERS_IN).instance);
      // Fixing a field clears its message at once.
      await type(tree, PASSENGERS_IN, '142');
      expect(errorOf(tree, PASSENGERS_IN)).toBeUndefined();
      expect(texts(tree.root)).toContain('No se guardó: revisa MTOW (kg).');
    });

  test.each(['-5', '1.5', 'abc'])('«%s» passengers are refused, never read as another number', async value => {
    const tree = await render({ operation: flight(), editable: true });
    await type(tree, PASSENGERS_OUT, value);
    await save(tree);
    expect(mockSave).not.toHaveBeenCalled();
    expect(errorOf(tree, PASSENGERS_OUT)).toBe('Escribe un número entero de 0 a 999, sin puntos ni decimales.');
    expect(focus().mock.contexts[0]).toBe(input(tree, PASSENGERS_OUT).instance);
  });

  // react-test-renderer does not apply maxLength: the props are what the device enforces.
  test('each field limits its length, shows its range and unit, and Next goes to the following field', async () => {
    const tree = await render({ operation: flight(), editable: true });
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW, 'Matrícula'].map(label => input(tree, label).props.maxLength))
      .toEqual([4, 4, 9, 10]);
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW, 'Matrícula'].map(label => input(tree, label).props.placeholder))
      .toEqual(['0 a 999', '0 a 999', '1,000 a 700,000 kg', 'Como HI1055']);
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW].map(label => input(tree, label).props.returnKeyType))
      .toEqual(['next', 'next', 'next']);
    await renderer.act(async () => { input(tree, PASSENGERS_OUT).props.onSubmitEditing(); });
    expect(focus().mock.contexts[0]).toBe(input(tree, MTOW).instance);
  });

  test('«351,500» is saved as 351500, and 0 passengers is a value', async () => {
    const tree = await render({ operation: flight(), editable: true });
    await type(tree, PASSENGERS_IN, '0');
    await type(tree, PASSENGERS_OUT, ' 0 ');
    await type(tree, MTOW, '351,500');
    await save(tree);
    expect(mockSave).toHaveBeenCalledWith(OPERATION_ID, { passengersIn: 0, passengersOut: 0, mtowKg: 351500,
      aircraftRegistration: null });
    expect(texts(tree.root).filter(value => value.startsWith('Falta'))).toEqual([]);
  });

  test('clearing a confirmed value sends null', async () => {
    const tree = await render({ operation: flight({ passengersIn: 120, passengersOut: 118, mtowKg: 70000 }), editable: true });
    expect(valueOf(tree, MTOW)).toBe('70000');
    await type(tree, MTOW, '');
    await save(tree);
    expect(mockSave).toHaveBeenCalledWith(OPERATION_ID, { passengersIn: 120, passengersOut: 118, mtowKg: null,
      aircraftRegistration: null });
  });

  test('the queue read after the first render shows, without overwriting what the agent typed', async () => {
    const tree = await render({ operation: flight({ passengersIn: 120, passengersOut: 118, mtowKg: 70000 }), editable: true });
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW].map(label => valueOf(tree, label))).toEqual(['120', '118', '70000']);
    // Untouched: the values still waiting on the device replace the operation's as soon as the queue is read.
    await publish({ ...mockSnapshot, items: [waiting({ passengersIn: 130, passengersOut: 128, mtowKg: 71000,
      aircraftRegistration: null })] });
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW].map(label => valueOf(tree, label))).toEqual(['130', '128', '71000']);
    // What the agent typed stays when the queue moves again; the fields not touched follow it.
    await type(tree, PASSENGERS_IN, '135');
    await publish({ ...mockSnapshot, items: [waiting({ passengersIn: 140, passengersOut: 138, mtowKg: 72000,
      aircraftRegistration: null })] });
    expect([PASSENGERS_IN, PASSENGERS_OUT, MTOW].map(label => valueOf(tree, label))).toEqual(['135', '138', '72000']);
    await save(tree);
    expect(mockSave).toHaveBeenCalledWith(OPERATION_ID, { passengersIn: 135, passengersOut: 138, mtowKg: 72000,
      aircraftRegistration: null });
  });

  test('«Faltan» names what is still missing and «Sin guardar» shows until a save is accepted; the chip stays', async () => {
    const tree = await render({ operation: flight({ passengersIn: 120 }), editable: true });
    expect(texts(tree.root)).toContain('Faltan: pasajeros que salen y MTOW.');
    // One value saved is still «Confirmado»: the chip says where the saved data stands, not whether it is complete.
    expect(texts(tree.root)).toContain('Confirmado');
    expect(texts(tree.root)).not.toContain('Sin guardar');

    await type(tree, MTOW, '70000');
    expect(texts(tree.root)).toContain('Sin guardar');
    expect(texts(tree.root)).toContain('Confirmado');
    expect(texts(tree.root)).toContain('Faltan: pasajeros que salen y MTOW.');

    await save(tree);
    expect(texts(tree.root)).not.toContain('Sin guardar');
    expect(texts(tree.root)).toContain('Faltan: pasajeros que salen.');
    expect(texts(tree.root)).toContain('En el dispositivo');
    expect(valueOf(tree, MTOW)).toBe('70000');
  });

  test('a save the tablet could not keep stays «Sin guardar» and keeps what was typed', async () => {
    mockSave.mockRejectedValue(new Error('disk'));
    const tree = await render({ operation: flight({ passengersIn: 120 }), editable: true });
    await type(tree, MTOW, '70000');
    await save(tree);
    expect(mockSave).toHaveBeenCalled();
    expect(texts(tree.root)).toContain('Sin guardar');
    expect(texts(tree.root)).toContain('No se pudieron guardar los datos del vuelo. Vuelve a intentarlo.');
    expect(valueOf(tree, MTOW)).toBe('70000');
  });

  test('a value ELEVANT confirmed as cleared stays empty, even with an older read of the operation', async () => {
    mockSnapshot = { ...mockSnapshot, confirmed: { [OPERATION_ID]: { receiptId: '91000000-0000-4000-8000-000000000001',
      operationId: OPERATION_ID, milestones: [], passengersIn: null, passengersOut: 118, mtowKg: 70000,
      aircraftRegistration: null } } };
    const tree = await render({ operation: flight({ passengersIn: 120, passengersOut: 118, mtowKg: 70000 }), editable: true });
    expect(valueOf(tree, PASSENGERS_IN)).toBe('');
    expect(texts(tree.root)).toContain('Faltan: pasajeros que llegan.');
  });

  test('once the operation ended the card shows what is saved and nothing unsaved', async () => {
    const tree = await render({ operation: flight({ passengersIn: 120 }), editable: false });
    expect(input(tree, PASSENGERS_IN).props.editable).toBe(false);
    expect(texts(tree.root)).not.toContain('Sin guardar');
    expect(texts(tree.root)).toContain('Faltan: pasajeros que salen y MTOW.');
  });
});
