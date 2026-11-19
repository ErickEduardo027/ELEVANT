// N11 (D-N11): the card's rail reads «Inicio planificado» as written, in two lines that shrink instead of breaking a
// word, and the day as the formatter writes it, «lun, 16 nov»: no forced capitals. The time is the station's, on a
// 24-hour clock.
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { AssignedOperationCard } = require('../src/components/assigned-operation-card');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';

function operation({ plannedStartAt = '2026-11-16T23:46:00.000Z', actualStartAt = null } = {}) {
  return {
    operation: { id: OPERATION_ID, status: 'Assigned', plannedStartAt, plannedEndAt: null, actualStartAt,
      actualEndAt: null },
    assignment: { id: '70000000-0000-4000-8000-000000000002', assignmentRole: 'primary', position: null,
      assignedAt: '2026-11-16T12:00:00.000Z' },
    services: [],
    review: null,
    turnaround: {
      operationCode: 'EV-001', operationDate: '2026-11-16',
      station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
      airline: { name: 'ELEVANT Demo Airlines' },
      arrival: { flightNumber: 'EV101', origin: { iataCode: 'BWI', name: 'Baltimore' },
        destination: { iataCode: 'PUJ', name: 'Punta Cana' }, scheduledAt: '2026-11-16T23:30:00.000Z',
        estimatedAt: null, actualAt: null },
      departure: null, stand: null, aircraft: null,
    },
  };
}

async function render(props = {}) {
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(AssignedOperationCard, { operation: operation(props), onOpen: jest.fn() }));
  });
  return tree;
}

const texts = (tree, match) => tree.root.findAll(node => node.type === 'Text' &&
  typeof node.props.children === 'string' && match.test(node.props.children));
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};

test('«Inicio planificado» is written as is, in two lines that shrink to fit instead of breaking a word', async () => {
  const tree = await render();
  const [label] = texts(tree, /^Inicio planificado$/);
  expect(label).toBeDefined();
  expect(label.props.numberOfLines).toBe(2);
  expect(label.props.adjustsFontSizeToFit).toBe(true);
  expect(label.props.maxFontSizeMultiplier).toEqual(expect.any(Number));
  // Fabric on Android ignores minimumFontScale.
  expect(label.props.minimumFontScale).toBeUndefined();
  expect(styleOf(label).textTransform).toBeUndefined();
  await renderer.act(async () => tree.unmount());
});

test('the day reads «lun, 16 nov» without forced capitals and the time is on a 24-hour clock', async () => {
  const tree = await render();
  const [day] = texts(tree, /16 nov/);
  expect(day.props.children).toMatch(/^lun\.?, 16 nov\.?$/);
  expect(styleOf(day).textTransform).toBeUndefined();
  expect(texts(tree, /^19:46$/)).toHaveLength(1);
  expect(JSON.stringify(tree.toJSON())).not.toMatch(/[ap]\.\s?m\./);
  await renderer.act(async () => tree.unmount());
});

test('the time is the station’s also after midnight', async () => {
  const tree = await render({ plannedStartAt: '2026-11-17T04:05:00.000Z' });
  expect(texts(tree, /^00:05$/)).toHaveLength(1);
  await renderer.act(async () => tree.unmount());
});
