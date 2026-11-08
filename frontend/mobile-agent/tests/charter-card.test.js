// The charter card (ADR-0033): the agent adds services at Finance's base tariff while the prepayment is pending; once
// Finance confirmed it, no service is added until Finance reopens the quotation (3-N24, `charter_prepayment_confirmed`).
const React = require('react');
const renderer = require('react-test-renderer');

const mockAdd = jest.fn();
let mockSnapshot;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
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
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('../src/services/flight-report', () => ({
  addCharterService: (...args) => mockAdd(...args),
  loadCharter: jest.fn(() => Promise.resolve()),
  saveCharterDetails: jest.fn(),
  subscribeFlightReport: listener => { listener(mockSnapshot); return () => {}; },
}));

const { CharterCard } = require('../src/components/documents/charter-card');
const { MobileServiceError } = require('../src/services/mobile-service-error');

const OPERATION_ID = '70000000-0000-4000-8000-000000000009';
const TOW = '71000000-0000-4000-8000-000000000001';
const GPU = '71000000-0000-4000-8000-000000000002';

function snapshot(prepaymentStatus) {
  return {
    items: [], syncing: false, confirmed: {}, revisions: {},
    documents: { [OPERATION_ID]: { documents: [{ kind: 'CharterServiceRequest' }] } },
    charters: { [OPERATION_ID]: {
      prepaymentStatus, currencyCode: 'USD', carrierAddress: null, chargesPayableBy: null,
      catalog: [
        { serviceDefinitionId: TOW, name: 'Remolque', unitPrice: 150, minimumQuantity: 1 },
        { serviceDefinitionId: GPU, name: 'GPU', unitPrice: 40, minimumQuantity: 1 },
      ],
    } },
  };
}

async function render(props) {
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(CharterCard,
      { operationId: OPERATION_ID, editable: true, existingServiceIds: [TOW], ...props }));
  });
  return tree;
}

const text = tree => JSON.stringify(tree.toJSON());
const button = (tree, label) => tree.root.findAll(node => node.props.accessibilityRole === 'button' &&
  node.props.accessibilityLabel === label && typeof node.props.onPress === 'function')[0];

beforeEach(() => jest.clearAllMocks());

describe('charter card prepayment (3-N24)', () => {
  test('with the prepayment pending the agent adds a service', async () => {
    mockSnapshot = snapshot('Pending');
    const tree = await render();
    expect(text(tree)).toContain('Prepago pendiente');
    expect(text(tree)).toContain('Agregado');
    expect(button(tree, 'Agregar Remolque')).toBeUndefined();
    await renderer.act(async () => { button(tree, 'Agregar GPU').props.onPress(); });
    expect(mockAdd).toHaveBeenCalledWith(OPERATION_ID, GPU, 1);
  });

  test('with the prepayment confirmed «Agregar» is hidden and the agent is told to ask Finance', async () => {
    mockSnapshot = snapshot('Confirmed');
    const tree = await render();
    expect(text(tree)).toContain('Prepago confirmado');
    expect(text(tree)).toContain('Prepago confirmado: pide a Finanzas una nueva cotización para agregar servicios.');
    expect(button(tree, 'Agregar GPU')).toBeUndefined();
    // What was already added stays listed.
    expect(text(tree)).toContain('Agregado');
    expect(mockAdd).not.toHaveBeenCalled();
  });

  test('a read-only card says nothing about adding services', async () => {
    mockSnapshot = snapshot('Confirmed');
    const tree = await render({ editable: false });
    expect(text(tree)).not.toContain('pide a Finanzas una nueva cotización');
  });

  test('a service the server refused for the confirmed prepayment is explained in Spanish', () => {
    const error = new MobileServiceError('conflict', { status: 409, problemCode: 'charter_prepayment_confirmed' });
    expect(error.message).toBe(
      'El prepago del charter ya está confirmado: pide a Finanzas una nueva cotización para agregar servicios.');
  });
});
