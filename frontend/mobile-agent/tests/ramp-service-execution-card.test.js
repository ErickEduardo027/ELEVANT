// S5 (D-S5): a service card names its billing unit in Spanish, «0 / 1 hora» and «1 / 1 operación», never the code
// ELEVANT stores. A unit that counts things takes whole numbers only, except the contracted quantity the card
// proposes, and a command already reserved is retried exactly as it was reserved.
const React = require('react');
const renderer = require('react-test-renderer');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { RampServiceExecutionCard } = require('../src/components/ramp-service-execution-card');

const SERVICE_ID = '73000000-0000-4000-8000-000000000001';

function service(overrides = {}) {
  return { id: SERVICE_ID, lineNumber: 1, serviceDefinitionId: SERVICE_ID, code: 'RAMP-AC', name: 'Aire acondicionado',
    contractedQuantity: 1, executedQuantity: 0, billingUnit: 'hour', status: 'InProgress', ...overrides };
}

async function render(props = {}) {
  const onTransition = jest.fn();
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(RampServiceExecutionCard,
      { actionable: true, busy: false, onTransition, ...props, service: service(props.service) }));
  });
  return { tree, onTransition };
}

/** The text of each host Text whose only child is a string: what a test sees as one contiguous line. */
const lines = tree => tree.root.findAll(node => node.type === 'Text' && typeof node.props.children === 'string')
  .map(node => node.props.children);
const quantityInput = tree => tree.root.findAll(node => node.type === 'TextInput' &&
  String(node.props.accessibilityLabel).startsWith('Cantidad ejecutada'))[0];
const pressable = (tree, label) => tree.root.findAll(node => node.props.accessibilityLabel === label &&
  typeof node.props.onPress === 'function')[0];
const button = (tree, title) => tree.root.findAll(node => node.props.title === title &&
  typeof node.props.onPress === 'function')[0];

async function chooseCompleted(tree) {
  await renderer.act(async () => { pressable(tree, 'Servicio completado').props.onPress(); });
}

async function type(tree, value) {
  await renderer.act(async () => { quantityInput(tree).props.onChangeText(value); });
}

async function confirm(tree, title = 'CONFIRMAR COMPLETADO') {
  await renderer.act(async () => { button(tree, title).props.onPress(); });
}

describe('billing units in Spanish (S5, D-S5)', () => {
  test('the quantities read «0 / 1 hora» and «1 / 1 operación» in one line, without the unit code', async () => {
    let { tree } = await render();
    expect(lines(tree)).toContain('0 / 1 hora');
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/\bhour\b/);
    await renderer.act(async () => tree.unmount());

    ({ tree } = await render({ service: { billingUnit: 'operation', executedQuantity: 1, status: 'Completed' } }));
    expect(lines(tree)).toContain('1 / 1 operación');
    expect(JSON.stringify(tree.toJSON())).not.toMatch(/\boperation\b/);
    await renderer.act(async () => tree.unmount());

    ({ tree } = await render({ service: { billingUnit: 'operation', contractedQuantity: 3 } }));
    expect(lines(tree)).toContain('0 / 3 operaciones');
    await renderer.act(async () => tree.unmount());
  });

  test('a legacy name reads like its code: «Operación» is «0 / 1 operación»', async () => {
    const { tree } = await render({ service: { billingUnit: 'Operación' } });
    expect(lines(tree)).toContain('0 / 1 operación');
    await renderer.act(async () => tree.unmount());
  });

  test('the field names the unit in Spanish in its label and its accessibility label', async () => {
    const { tree } = await render();
    await chooseCompleted(tree);
    expect(lines(tree)).toContain('Cantidad ejecutada (horas)');
    expect(quantityInput(tree).props.accessibilityLabel).toBe('Cantidad ejecutada (horas)');
    await renderer.act(async () => tree.unmount());
  });
});

describe('whole numbers in the units that count things (S5)', () => {
  test('a count unit asks for whole numbers with a number pad', async () => {
    const { tree } = await render({ service: { billingUnit: 'operation' } });
    await chooseCompleted(tree);
    expect(quantityInput(tree).props.keyboardType).toBe('number-pad');
    expect(quantityInput(tree).props.accessibilityHint).toBe('Usa solo números enteros');
    expect(lines(tree)).toContain('Solo números enteros.');
    expect(lines(tree)).not.toContain('Máximo 4 decimales.');
    await renderer.act(async () => tree.unmount());
  });

  test('a count unit rejects «1,5» and accepts «2»', async () => {
    const { tree, onTransition } = await render({ service: { billingUnit: 'operation' } });
    await chooseCompleted(tree);
    await type(tree, '1,5');
    await confirm(tree);
    expect(onTransition).not.toHaveBeenCalled();
    expect(lines(tree)).toContain('Ingresa una cantidad válida, igual o mayor que cero.');

    await type(tree, '2');
    await confirm(tree);
    expect(onTransition).toHaveBeenCalledWith({ targetStatus: 'Completed', executedQuantity: 2 });
    await renderer.act(async () => tree.unmount());
  });

  test('an hour accepts «1,5», with a decimal pad and up to four decimals', async () => {
    const { tree, onTransition } = await render();
    await chooseCompleted(tree);
    expect(quantityInput(tree).props.keyboardType).toBe('decimal-pad');
    expect(lines(tree)).toContain('Máximo 4 decimales.');
    await type(tree, '1,5');
    await confirm(tree);
    expect(onTransition).toHaveBeenCalledWith({ targetStatus: 'Completed', executedQuantity: 1.5 });
    await renderer.act(async () => tree.unmount());
  });

  test('a contracted quantity of 1,5 «operation» is proposed and can be confirmed', async () => {
    const { tree, onTransition } = await render({ service: { billingUnit: 'operation', contractedQuantity: 1.5 } });
    expect(lines(tree)).toContain('0 / 1.5 operaciones');
    await chooseCompleted(tree);
    expect(quantityInput(tree).props.value).toBe('1.5');
    await confirm(tree);
    expect(onTransition).toHaveBeenCalledWith({ targetStatus: 'Completed', executedQuantity: 1.5 });
    await renderer.act(async () => tree.unmount());
  });

  test('a command already reserved is not validated again: its retry sends what was reserved', async () => {
    const pending = { idempotencyKey: '91000000-0000-4000-8000-000000000001',
      request: { targetStatus: 'Completed', executedQuantity: 1.5, note: 'Media operación por la lluvia' } };
    const { tree, onTransition } = await render({ pending, service: { billingUnit: 'operation' } });
    expect(quantityInput(tree).props.editable).toBe(false);
    await confirm(tree, 'REINTENTAR COMANDO');
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition).toHaveBeenCalledWith(pending.request);
    await renderer.act(async () => tree.unmount());
  });
});
