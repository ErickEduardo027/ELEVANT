// S5 (D-S5): a service card names its billing unit in Spanish, «0 / 1 hora» and «1 / 1 operación», never the code
// ELEVANT stores. A unit that counts things takes whole numbers only, except the contracted quantity the card
// proposes, and a command already reserved is retried exactly as it was reserved.
// N12 (D-N12): the service's name is the card's title and its code («RAMP-AC») a small secondary text; the line
// number in front of the name tells two lines of the same service apart.
// N13 (D-N13): a confirmation steps aside while a result form is open and once the agent acts on the card again, and a
// warning stays; the card speaks the agent's words, never «comando», «canónico» nor «payload».
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { RampServiceExecutionCard } = require('../src/components/ramp-service-execution-card');
const { colors } = require('../src/theme/colors');

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

/** Every text of the card in order, numbers included: the heading comes first. */
const texts = tree => tree.root.findAll(node => node.type === 'Text')
  .map(node => [].concat(node.props.children).join(''));
const textNode = (tree, value) => tree.root.findAll(node => node.type === 'Text' && node.props.children === value)[0];
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const weight = value => ({ normal: 400, bold: 700 })[value] ?? Number(value ?? 400);

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
    await confirm(tree, 'REINTENTAR ENVÍO');
    expect(onTransition).toHaveBeenCalledTimes(1);
    expect(onTransition).toHaveBeenCalledWith(pending.request);
    await renderer.act(async () => tree.unmount());
  });
});

describe('the name first and the code in the background (N12, D-N12)', () => {
  test('the name is the title and the code a small secondary text under it, before the quantities', async () => {
    const { tree } = await render();
    expect(texts(tree).slice(0, 4)).toEqual(['1', 'Aire acondicionado', 'RAMP-AC', '0 / 1 hora']);
    const name = styleOf(textNode(tree, 'Aire acondicionado'));
    const code = styleOf(textNode(tree, 'RAMP-AC'));
    expect(weight(name.fontWeight)).toBeGreaterThanOrEqual(700);
    expect(code.fontSize).toBeLessThan(name.fontSize);
    expect(code.color).toBe(colors.muted);
    // Not bold: the code no longer competes with the name as a second title.
    expect(weight(code.fontWeight)).toBeLessThanOrEqual(500);
    await renderer.act(async () => tree.unmount());
  });

  test('two lines of the same service are told apart by the line number in front of the name', async () => {
    const first = await render({ service: { lineNumber: 1 } });
    const second = await render({ service: { id: '73000000-0000-4000-8000-000000000002', lineNumber: 2 } });
    expect(texts(first.tree).slice(0, 2)).toEqual(['1', 'Aire acondicionado']);
    expect(texts(second.tree).slice(0, 2)).toEqual(['2', 'Aire acondicionado']);
    await renderer.act(async () => { first.tree.unmount(); second.tree.unmount(); });
  });
});

describe('notices that do not get in the way, in the agent’s words (N13, D-N13)', () => {
  const SUCCESS = { tone: 'success', title: 'Aire acondicionado en ejecución desde las 19:59.' };
  const WARNING = { tone: 'warning', title: 'El servicio cambió',
    message: 'Actualizamos el servicio con lo que tiene ELEVANT. Revísalo antes de registrar otro resultado.' };
  const JARGON = /canónic|comando|payload|clave/i;
  const KEY = '91000000-0000-4000-8000-000000000001';
  const closeForm = async tree => {
    await renderer.act(async () => { pressable(tree, 'Cancelar edición del resultado').props.onPress(); });
  };

  test('an open result form hides a confirmation, and closing the form does not bring it back', async () => {
    const { tree, onTransition } = await render({ notice: SUCCESS });
    expect(lines(tree)).toContain(SUCCESS.title);
    await chooseCompleted(tree);
    expect(lines(tree)).not.toContain(SUCCESS.title);
    await closeForm(tree);
    expect(lines(tree)).not.toContain(SUCCESS.title);
    // The next confirmation shows again.
    await renderer.act(async () => {
      tree.update(React.createElement(RampServiceExecutionCard,
        { actionable: true, busy: false, onTransition, service: service(), notice: { ...SUCCESS } }));
    });
    expect(lines(tree)).toContain(SUCCESS.title);
    await renderer.act(async () => tree.unmount());
  });

  test('a result form already open, kept on the tablet, does not show a confirmation either', async () => {
    const { tree } = await render({ notice: SUCCESS, pending: { idempotencyKey: KEY,
      request: { targetStatus: 'Completed', executedQuantity: 1 } } });
    expect(button(tree, 'REINTENTAR ENVÍO')).toBeDefined();
    expect(lines(tree)).not.toContain(SUCCESS.title);
    await renderer.act(async () => tree.unmount());
  });

  test('a warning stays with the form open', async () => {
    const { tree } = await render({ notice: WARNING });
    await chooseCompleted(tree);
    expect(lines(tree)).toContain(WARNING.title);
    expect(lines(tree)).toContain(WARNING.message);
    await renderer.act(async () => tree.unmount());
  });

  test('typing the reason of a correction is the next action: the confirmation steps aside', async () => {
    const notice = { tone: 'success', title: 'Aire acondicionado: completado a las 20:10.' };
    const { tree } = await render({ correctionMode: true, notice, service: { status: 'Completed', executedQuantity: 1 } });
    expect(lines(tree)).toContain(notice.title);
    const reason = tree.root.findAll(node => node.type === 'TextInput' &&
      node.props.accessibilityLabel === 'Motivo de corrección de Aire acondicionado')[0];
    await renderer.act(async () => { reason.props.onChangeText('OCC pidió ajustar la cantidad'); });
    expect(lines(tree)).not.toContain(notice.title);
    await renderer.act(async () => tree.unmount());
  });

  test('the card speaks the agent’s words, also for a change kept on the tablet', async () => {
    let { tree } = await render({ pending: { idempotencyKey: KEY,
      request: { targetStatus: 'Completed', executedQuantity: 1 } } });
    expect(lines(tree)).toContain('Guardado en esta tablet: el reintento envía la misma cantidad y la misma nota.');
    expect(button(tree, 'REINTENTAR ENVÍO')).toBeDefined();
    expect(JSON.stringify(tree.toJSON())).not.toMatch(JARGON);
    await renderer.act(async () => tree.unmount());

    ({ tree } = await render({ correctionMode: true, service: { status: 'Completed', executedQuantity: 1 },
      pending: { idempotencyKey: KEY, request: { targetStatus: 'InProgress', note: 'Ajuste pedido por OCC' } } }));
    expect(lines(tree)).toContain('El motivo quedó guardado en esta tablet: el reintento lo envía tal cual.');
    expect(JSON.stringify(tree.toJSON())).not.toMatch(JARGON);
    await renderer.act(async () => tree.unmount());

    ({ tree } = await render({ actionable: false }));
    expect(lines(tree)).toContain('Actualiza el detalle antes de registrar este servicio.');
    expect(JSON.stringify(tree.toJSON())).not.toMatch(JARGON);
    await renderer.act(async () => tree.unmount());

    ({ tree } = await render({ service: { status: 'Cancelled' } }));
    expect(lines(tree)).toContain('Este servicio no se puede cambiar desde la tablet en su estado actual.');
    expect(JSON.stringify(tree.toJSON())).not.toMatch(JARGON);
    await renderer.act(async () => tree.unmount());
  });
});
