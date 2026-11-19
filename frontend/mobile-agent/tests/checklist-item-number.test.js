// N12 (D-N12): each checklist control carries one number, the one AVIAM's PDF prints (OperationDocumentPdfRenderer).
// A code that ends in a number gives that number, so the «Reporte de Vuelo» counts 1 to 21 across its two sections
// (ARR-01 … PUSH-21). Any other code gives the control's position within its section, as the bridge form numbers its
// rows. The card shows that number next to the control's label, never the internal code beside a second number.
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { checklistItemNumber } = require('../src/features/checklist/presentation');
const { ChecklistItemCard } = require('../src/components/checklist-item-card');

const PUSH_11 = { id: '72000000-0000-4000-8000-000000000011', code: 'PUSH-11',
  label: 'Puntualidad del personal asignado para el retroempuje de la aeronave', sortOrder: 11, isRequired: true,
  requiresNoteWhenNotOk: true };

async function render(props = {}) {
  const onChange = jest.fn();
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(ChecklistItemCard,
      { answer: undefined, disabled: false, index: 0, invalid: false, item: PUSH_11, onChange, ...props }));
  });
  return { tree, onChange };
}

/** Every text of the card in order, numbers included. */
const texts = tree => tree.root.findAll(node => node.type === 'Text')
  .map(node => [].concat(node.props.children).join(''));
/** The texts that are only a number: the card must have exactly one. */
const numbers = tree => texts(tree).filter(text => /^\d+$/.test(text));
const textNode = (tree, value) => tree.root.findAll(node => node.type === 'Text' && node.props.children === value)[0];
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};

describe('checklistItemNumber: the PDF numbering (N12, D-N12)', () => {
  test('a code that ends in a number gives that number, without its leading zeros', () => {
    expect(checklistItemNumber('ARR-01', 0)).toBe('1');
    expect(checklistItemNumber('ARR-10', 9)).toBe('10');
    expect(checklistItemNumber('PUSH-11', 0)).toBe('11');
    expect(checklistItemNumber('PUSH-21', 10)).toBe('21');
  });

  test('any other code gives the position within the section, counted from 1', () => {
    expect(checklistItemNumber('PREUSE-EXTERIOR', 2)).toBe('3');
    expect(checklistItemNumber('PREUSE-LAMP-TEST', 6)).toBe('7');
    expect(checklistItemNumber('CHOCKS', 0)).toBe('1');
    expect(checklistItemNumber('ARR-1A', 4)).toBe('5');
  });

  test('a code whose number is only zeros takes its position as well', () => {
    expect(checklistItemNumber('ARR-00', 4)).toBe('5');
  });
});

describe('the control card shows one number and its label (N12, D-N12)', () => {
  test('the first control of «Retroempuje» shows 11, the number of PUSH-11, and not «PUSH-11» beside a 1', async () => {
    const { tree } = await render();
    expect(numbers(tree)).toEqual(['11']);
    expect(JSON.stringify(tree.toJSON())).not.toContain('PUSH');
    await renderer.act(async () => tree.unmount());
  });

  test('the label is the main text, right after the number', async () => {
    const { tree } = await render();
    expect(texts(tree).slice(0, 3)).toEqual(['11', PUSH_11.label, 'Obligatorio']);
    const label = styleOf(textNode(tree, PUSH_11.label));
    expect(label.fontSize).toBeGreaterThan(styleOf(textNode(tree, 'Obligatorio')).fontSize);
    await renderer.act(async () => tree.unmount());
  });

  test('a bridge control without a number in its code is numbered by its position in the section', async () => {
    const { tree } = await render({ index: 2,
      item: { ...PUSH_11, code: 'PREUSE-EXTERIOR', label: 'Exterior completo del puente' } });
    expect(numbers(tree)).toEqual(['3']);
    expect(JSON.stringify(tree.toJSON())).not.toContain('PREUSE');
    await renderer.act(async () => tree.unmount());
  });

  test('the answers work as before: OK, and NO asks for its observation', async () => {
    const { tree, onChange } = await render();
    const choice = label => tree.root.findAll(node =>
      node.props.accessibilityLabel === `Marcar ${PUSH_11.label} como ${label}` &&
      typeof node.props.onPress === 'function')[0];
    await renderer.act(async () => { choice('OK').props.onPress(); });
    expect(onChange).toHaveBeenLastCalledWith({ value: 'Ok' });
    await renderer.act(async () => { choice('NO').props.onPress(); });
    expect(onChange).toHaveBeenLastCalledWith({ value: 'NotOk' });

    await renderer.act(async () => { tree.update(React.createElement(ChecklistItemCard,
      { answer: { value: 'NotOk' }, disabled: false, index: 0, invalid: false, item: PUSH_11, onChange })); });
    expect(texts(tree)).toContain('Observación (obligatoria)');
    expect(texts(tree)).toContain('La observación es obligatoria cuando marcas NO.');
    await renderer.act(async () => tree.unmount());
  });
});
