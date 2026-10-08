const React = require('react');
const renderer = require('react-test-renderer');

const mockGet = jest.fn();
const mockChange = jest.fn();

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

const { RampOperationChargesCard } = require('../src/components/ramp-operation-charges-card');

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

beforeEach(() => jest.clearAllMocks());

it('marks a charge type without showing any price', async () => {
  mockGet.mockResolvedValue({ charges: charges(), fromCache: false });
  mockChange.mockResolvedValue(charges([mark]).services[0]);
  const tree = await render();
  expect(JSON.stringify(tree.toJSON())).toContain('Recargo nocturno');
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/USD|DOP|\$/);
  await renderer.act(async () => { chip(tree).props.onPress(); });
  expect(mockChange).toHaveBeenCalledWith(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Apply');
  expect(chip(tree).props.accessibilityState.checked).toBe(true);
  await renderer.act(async () => { chip(tree).props.onPress(); });
  expect(mockChange).toHaveBeenLastCalledWith(OPERATION_ID, SERVICE_ID, CHARGE_ID, 'Remove');
});

it('is read-only when the server says the service cannot be edited or data is cached', async () => {
  mockGet.mockResolvedValue({ charges: charges([], false), fromCache: false });
  let tree = await render();
  expect(chip(tree).props.disabled).toBe(true);
  mockGet.mockResolvedValue({ charges: charges(), fromCache: true });
  tree = await render();
  expect(chip(tree).props.disabled).toBe(true);
  expect(JSON.stringify(tree.toJSON())).toContain('última copia guardada');
});
