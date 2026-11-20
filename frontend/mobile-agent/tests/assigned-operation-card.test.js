// N11 (D-N11): the card's rail reads «Inicio planificado» as written, in two lines that shrink instead of breaking a
// word, and the day as the formatter writes it, «lun, 16 nov»: no forced capitals. The time is the station's, on a
// 24-hour clock.
// N10 (D-N10): the route row shows the stops the aircraft makes, in order, with the station highlighted between them
// («BWI → PUJ → BWI»); the rail no longer repeats the station's code.
// N13: what the screen reader hears agrees in number with the services, «1 servicio».
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const { AssignedOperationCard } = require('../src/components/assigned-operation-card');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';

const airports = {
  BWI: { iataCode: 'BWI', name: 'Baltimore' },
  PUJ: { iataCode: 'PUJ', name: 'Punta Cana' },
  MIA: { iataCode: 'MIA', name: 'Miami' },
};

function leg(flightNumber, origin, destination) {
  return { flightNumber, origin: airports[origin], destination: airports[destination],
    scheduledAt: '2026-11-16T23:30:00.000Z', estimatedAt: null, actualAt: null };
}

function operation({ plannedStartAt = '2026-11-16T23:46:00.000Z', actualStartAt = null,
  arrival = leg('EV101', 'BWI', 'PUJ'), departure = null, services = [] } = {}) {
  return {
    operation: { id: OPERATION_ID, status: 'Assigned', plannedStartAt, plannedEndAt: null, actualStartAt,
      actualEndAt: null },
    assignment: { id: '70000000-0000-4000-8000-000000000002', assignmentRole: 'primary', position: null,
      assignedAt: '2026-11-16T12:00:00.000Z' },
    services,
    review: null,
    turnaround: {
      operationCode: 'EV-001', operationDate: '2026-11-16',
      station: { code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
      airline: { name: 'ELEVANT Demo Airlines' },
      arrival, departure, stand: null, aircraft: null,
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
// The airport codes in the order the card shows them, wherever they are.
const codeNodes = tree => texts(tree, /^[A-Z]{3}$/);
const codes = tree => codeNodes(tree).map(node => node.props.children);
const spoken = tree => tree.root.findAll(node => node.props.accessibilityRole === 'button' &&
  typeof node.props.accessibilityLabel === 'string')[0].props.accessibilityLabel;
const box = node => {
  let parent = node.parent;
  while (parent && parent.type !== 'View') parent = parent.parent;
  return parent;
};

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

describe('the route as the aircraft flies it (N10, D-N10)', () => {
  test('a turnaround shows origin, station and next destination in order, the station only once', async () => {
    // It read «BWI ✈ BWI», and the rail repeated «PUJ» below the time.
    const tree = await render({ departure: leg('EV102', 'PUJ', 'BWI') });
    expect(codes(tree)).toEqual(['BWI', 'PUJ', 'BWI']);
    expect(spoken(tree)).toContain('llega de BWI a PUJ y sale hacia BWI');
    await renderer.act(async () => tree.unmount());
  });

  test('BWI → PUJ → MIA shows the station instead of hiding it', async () => {
    const tree = await render({ departure: leg('EV102', 'PUJ', 'MIA') });
    expect(codes(tree)).toEqual(['BWI', 'PUJ', 'MIA']);
    expect(spoken(tree)).toContain('llega de BWI a PUJ y sale hacia MIA');
    await renderer.act(async () => tree.unmount());
  });

  test('the station stands out from the airports around it', async () => {
    const tree = await render({ departure: leg('EV102', 'PUJ', 'BWI') });
    const [origin, station, destination] = codeNodes(tree).map(node => styleOf(box(node)).backgroundColor);
    expect(station).toEqual(expect.any(String));
    expect(origin).toBeUndefined();
    expect(destination).toBeUndefined();
    await renderer.act(async () => tree.unmount());
  });

  test('a single leg still reads in order', async () => {
    let tree = await render();
    expect(codes(tree)).toEqual(['BWI', 'PUJ']);
    expect(spoken(tree)).toContain('llega de BWI a PUJ,');
    await renderer.act(async () => tree.unmount());

    tree = await render({ arrival: null, departure: leg('EV102', 'PUJ', 'MIA') });
    expect(codes(tree)).toEqual(['PUJ', 'MIA']);
    expect(spoken(tree)).toContain('sale de PUJ hacia MIA');
    await renderer.act(async () => tree.unmount());
  });

  test('without flights the card still names the station once, beside «Ruta por confirmar»', async () => {
    const tree = await render({ arrival: null });
    expect(codes(tree)).toEqual(['PUJ']);
    expect(texts(tree, /^Ruta por confirmar$/)).toHaveLength(1);
    expect(spoken(tree)).toContain('estación PUJ, ruta por confirmar');
    await renderer.act(async () => tree.unmount());
  });
});

describe('the services in the singular and the plural (N13)', () => {
  const service = n => ({ id: `73000000-0000-4000-8000-00000000000${n}`, lineNumber: n,
    serviceDefinitionId: `73000000-0000-4000-8000-00000000000${n}`, code: 'RAMP-AC', name: 'Aire acondicionado',
    contractedQuantity: 1, executedQuantity: 0, billingUnit: 'hour', status: 'Planned' });

  test.each([
    [[1], '1 servicio'],
    [[1, 2], '2 servicios'],
  ])('a card with %j service lines is read as «%s», as it shows', async (lines, words) => {
    const tree = await render({ services: lines.map(service) });
    expect(spoken(tree)).toMatch(new RegExp(`, ${words}$`));
    await renderer.act(async () => tree.unmount());
  });
});
