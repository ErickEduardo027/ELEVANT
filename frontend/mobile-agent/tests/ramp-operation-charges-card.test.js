const React = require('react');
const renderer = require('react-test-renderer');

const mockGet = jest.fn();
const mockChange = jest.fn();
let mockQueue = { items: [], revisions: {} };
const mockListeners = new Set();

jest.mock('../src/services/ramp-service-charges', () => ({
  getRampOperationCharges: (...args) => mockGet(...args),
  changeRampServiceCharge: (...args) => mockChange(...args),
}));
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: class MobileServiceError extends Error {
    constructor(code) { super(code); this.code = code; }
  },
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/services/flight-report', () => ({
  subscribeFlightReport: listener => {
    mockListeners.add(listener);
    listener(mockQueue);
    return () => mockListeners.delete(listener);
  },
}));

const { projectCharges, RampOperationChargesCard } = require('../src/components/ramp-operation-charges-card');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const SERVICE_ID = '73000000-0000-4000-8000-000000000001';
const CHARGE_ID = '74000000-0000-4000-8000-000000000001';
const services = [{ id: SERVICE_ID, lineNumber: 1, serviceDefinitionId: SERVICE_ID, code: 'BAGGAGE', name: 'Equipaje',
  contractedQuantity: 1, executedQuantity: 0, billingUnit: 'operation', status: 'InProgress' }];
const option = { id: CHARGE_ID, code: 'NIGHT', name: 'Recargo nocturno', description: null, category: 'Surcharge', allowMultiple: false };
const charges = (applied = [], canEdit = true) => ({ operationId: OPERATION_ID,
  services: [{ serviceId: SERVICE_ID, canEdit, available: [option], applied }] });
const mark = { id: '75000000-0000-4000-8000-000000000001', chargeId: CHARGE_ID, code: 'NIGHT',
  name: 'Recargo nocturno', appliedAt: '2026-10-08T03:10:00.000+00:00' };

async function render() {
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(RampOperationChargesCard,
      { operationId: OPERATION_ID, refreshKey: 'a', services }));
  });
  return tree;
}

const chip = tree => tree.root.findAll(node => node.props.accessibilityRole === 'checkbox' && typeof node.props.onPress === 'function')[0];

beforeEach(() => {
  jest.clearAllMocks();
  mockQueue = { items: [], revisions: {} };
  mockListeners.clear();
});

it('marks a charge type without showing any price', async () => {
  mockGet.mockResolvedValue({ charges: charges(), fromCache: false });
  mockChange.mockResolvedValue(charges([mark]).services[0]);
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Recargo nocturno');
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/USD|DOP|\$/);
  await renderer.act(async () => { chip(tree).props.onPress(); });
  expect(mockChange).toHaveBeenCalledWith(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply', { chargeName: 'Recargo nocturno' });
  expect(chip(tree).props.accessibilityState.checked).toBe(true);
  await renderer.act(async () => { chip(tree).props.onPress(); });
  expect(mockChange).toHaveBeenLastCalledWith(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Remove', { chargeName: 'Recargo nocturno' });
});

it('is read-only when the server says the service cannot be edited; without signal the saved copy stays editable', async () => {
  mockGet.mockResolvedValue({ charges: charges([], false), fromCache: false });
  let tree = await render();
  expect(chip(tree).props.disabled).toBe(true);
  // 3-I: the mark goes into the device's queue and travels when there is signal.
  mockGet.mockResolvedValue({ charges: charges(), fromCache: true });
  tree = await render();
  expect(chip(tree).props.disabled).toBe(false);
  expect(JSON.stringify(tree.toJSON())).toContain('última copia guardada');
});

it('shows a mark waiting on the device and says it goes out when there is signal', async () => {
  mockGet.mockResolvedValue({ charges: charges(), fromCache: true });
  mockChange.mockResolvedValue(null);
  mockQueue = { revisions: {}, items: [{ idempotencyKey: '76000000-0000-4000-8000-000000000001', state: 'pending',
    attempts: 0, createdAt: '2026-10-08T03:10:00.000Z',
    command: { kind: 'serviceCharge', operationId: OPERATION_ID, serviceId: SERVICE_ID, chargeId: CHARGE_ID,
      action: 'Apply', chargeName: 'Recargo nocturno' } }] };
  const tree = await render();
  expect(chip(tree).props.accessibilityState.checked).toBe(true);
  expect(chip(tree).props.accessibilityLabel).toContain('en el dispositivo');
  await renderer.act(async () => { chip(tree).props.onPress(); });
  expect(mockChange).toHaveBeenLastCalledWith(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Remove', { chargeName: 'Recargo nocturno' });
  expect(JSON.stringify(tree.toJSON())).toContain('Cargo guardado en el dispositivo');
});

it('applies the queued marks and unmarks in order over the server copy, never removing an automatic one', () => {
  const queued = (action, n) => ({ idempotencyKey: `76000000-0000-4000-8000-00000000000${n}`, state: 'pending', attempts: 0,
    createdAt: '2026-10-08T03:10:00.000Z', command: { kind: 'serviceCharge', operationId: OPERATION_ID, serviceId: SERVICE_ID,
      chargeId: CHARGE_ID, action } });
  const automatic = { ...mark, source: 'Automatic' };
  expect(projectCharges(charges([automatic]), [queued('Remove', 1)]).services[0].applied).toEqual([automatic]);
  const projected = projectCharges(charges([mark]), [queued('Remove', 1), queued('Apply', 2)]).services[0].applied;
  expect(projected).toEqual([expect.objectContaining({ chargeId: CHARGE_ID, source: 'Device', name: 'Recargo nocturno' })]);
  expect(projectCharges(charges([mark]), [{ ...queued('Remove', 1), state: 'blocked' }]).services[0].applied).toEqual([mark]);
});

it('shows an automatic or OCC charge as applied but never lets the agent remove it (ADR-0034)', async () => {
  mockGet.mockResolvedValue({ charges: charges([{ ...mark, source: 'Automatic' }]), fromCache: false });
  const tree = await render();
  expect(chip(tree).props.accessibilityState.checked).toBe(true);
  expect(chip(tree).props.disabled).toBe(true);
  expect(chip(tree).props.accessibilityLabel).toContain('automático');
  expect(JSON.stringify(tree.toJSON())).toContain('" · automático"');
});
