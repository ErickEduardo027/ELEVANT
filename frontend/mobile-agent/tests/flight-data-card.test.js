const React = require('react');
const renderer = require('react-test-renderer');

// The first modal list a run renders loads React Native's virtualized list.
jest.setTimeout(30000);

const mockSave = jest.fn();
const mockTypes = jest.fn();
let mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {} };

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => ({ FLIGHT_REPORT_MILESTONES: [], FLIGHT_REPORT_PHASES: [], IATA_DELAY_CODES: [] }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../src/services/flight-report', () => ({
  recordMilestone: jest.fn(),
  saveFlightData: (...args) => mockSave(...args),
  subscribeFlightReport: listener => { listener(mockSnapshot); return () => {}; },
}));
jest.mock('../src/services/ramp-incidents', () => ({ loadRampIncidentCenter: jest.fn(), reserveRampIncident: jest.fn() }));
jest.mock('../src/services/aircraft-types', () => ({
  getRampAircraftTypes: (...args) => mockTypes(...args),
  aircraftTypeLabel: type => `${type.manufacturer} ${type.model} · ${type.icaoCode}`,
}));

const { FlightDataCard } = require('../src/components/flight-report/flight-report-panel');

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

beforeEach(() => {
  jest.clearAllMocks();
  mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {} };
  mockSave.mockResolvedValue(undefined);
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
