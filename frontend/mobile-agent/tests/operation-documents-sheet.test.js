// The signature sheet (S2, D-S2). FIRMAR, CANCELAR and the document's fingerprint sit in a fixed footer, below a body
// that scrolls and a fixed header that closes the sheet without signing, so in landscape the buttons are never below
// the fold. A scroll that starts on the pad and takes the gesture away (Android's scroll view terminates the pad's
// responder; it never releases it) drops the stroke in progress and gives the scroll back; the strokes already kept stay.
const React = require('react');
const renderer = require('react-test-renderer');

const mockSign = jest.fn();
let mockSnapshot;
let mockLayout = 'medium';

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => ({
  AIRCRAFT_SILHOUETTE: { aspect: 2, outline: [] },
  SIGNATURE_PAD_ASPECT: 3,
  SIGNATURE_MAX_STROKES: 64,
  SIGNATURE_MAX_POINTS: 2_000,
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('expo-haptics', () => ({ notificationAsync: jest.fn(() => Promise.resolve()), NotificationFeedbackType: { Success: 'success' } }));
jest.mock('expo-image-picker', () => ({ requestCameraPermissionsAsync: jest.fn(), launchCameraAsync: jest.fn() }));
// Host nodes, so a test can count the pad's strokes: one <Path> for the baseline and one per stroke on screen.
jest.mock('react-native-svg', () => {
  const host = name => function SvgHost(props) { return require('react').createElement(name, props); };
  return { __esModule: true, default: host('Svg'), Circle: host('Circle'), Path: host('Path'), Polygon: host('Polygon'),
    Text: host('SvgText') };
});
jest.mock('react-native-safe-area-context', () => ({
  SafeAreaView: props => require('react').createElement('SafeAreaView', props),
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: jest.fn(() => Promise.resolve({ session: { actor: { displayName: 'Riley Ramp' } } })),
}));
jest.mock('../src/services/flight-report', () => ({
  loadOperationDocuments: jest.fn(() => Promise.resolve()),
  markDamage: jest.fn(),
  signDocument: (...args) => mockSign(...args),
  subscribeFlightReport: listener => { listener(mockSnapshot); return () => {}; },
}));
jest.mock('../src/utils/layout-class', () => ({ useLayoutClass: () => mockLayout }));

const { Keyboard, ScrollView, StyleSheet } = require('react-native');
const { DocumentsPanel } = require('../src/components/documents/operation-documents');
const { SignaturePad } = require('../src/components/documents/signature-pad');
const { colors } = require('../src/theme/colors');

const OPERATION_ID = '70000000-0000-4000-8000-000000000001';
const SHA = '0123456789abcdef'.repeat(4);
const AIRLINE = 'Representante de la aerolínea';
/** A 600 × 200 dp pad: (60, 30) is the point (0.1, 0.15). */
const PAD_WIDTH = 600;

function serviceOrder(overrides = {}) {
  return {
    kind: 'ServiceOrder', number: 'OS-PUJ-0001', title: 'Orden de Servicio', formCode: 'AV-OPS-01', contentSha256: SHA,
    requiredRoles: ['AirlineRepresentative', 'AviamAgent'], signatures: [], staleRoles: [], isFullySigned: false,
    summary: {
      flightIn: 'B6 1234', flightOut: 'B6 1235', registration: 'N571JB', aircraftType: 'A320', position: 'A11',
      passengersIn: 142, passengersOut: 138, mtowKg: 78_000,
      services: [{ code: 'RAMP-AC', name: 'Aire acondicionado', quantity: 1, unit: 'hour', amount: 300 }],
      surcharges: [], currencyCode: 'USD', totalAmount: 300,
      milestoneCount: 4, checklistAnswered: 21, checklistTotal: 21, damageCount: 0,
    },
    ...overrides,
  };
}

const charterRequest = () => serviceOrder({ kind: 'CharterServiceRequest', number: 'SS-PUJ-0001',
  title: 'Solicitud de Servicio', formCode: 'AV-OPS-04', requiredRoles: ['AirlineRepresentative'] });

async function render(documents = [serviceOrder()]) {
  mockSnapshot = { items: [], syncing: false, confirmed: {}, revisions: {}, charters: {},
    documents: { [OPERATION_ID]: { operationId: OPERATION_ID, documents, damageMarks: [] } } };
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(DocumentsPanel, { operationId: OPERATION_ID, editable: true }));
  });
  return tree;
}

const press = async node => { await renderer.act(async () => { node.props.onPress(); }); };
const textOf = node => [].concat(node.props.children)
  .filter(child => typeof child === 'string' || typeof child === 'number').join('');
const modal = tree => tree.root.findAll(node => node.type === 'Modal')[0];
const scroll = tree => modal(tree).findAll(node => node.type === 'RCTScrollView')[0];
const contains = (container, node) => container.findAll(candidate => candidate === node).length > 0;
/** A PrimaryButton of the sheet, by its title. */
const sheetButton = (tree, title) => modal(tree).findAll(node => typeof node.props.onPress === 'function' &&
  node.props.title === title)[0];
const closeButton = tree => modal(tree).findAll(node => node.props.accessibilityRole === 'button' &&
  node.props.accessibilityLabel === 'Cerrar sin firmar' && typeof node.props.onPress === 'function')[0];
const clearButton = tree => tree.root.findAll(node => node.props.accessibilityRole === 'button' &&
  typeof node.props.onPress === 'function' &&
  node.findAll(text => text.type === 'Text' && text.props.children === 'Borrar firma').length > 0)[0];
const fingerprint = tree => modal(tree).findAll(node => node.type === 'Text' &&
  textOf(node).startsWith('Huella del documento'))[0];
const pad = tree => tree.root.findAll(node => node.type === 'View' && node.props.accessibilityLabel === 'Área de firma')[0];
/** The pad's <Path> elements: the baseline first, then each stroke on screen. */
const padPaths = tree => pad(tree).findAll(node => node.type === 'Path');
/** The nearest host View that holds both nodes. */
function sharedBox(first, second) {
  const ancestors = new Set();
  for (let node = first; node; node = node.parent) ancestors.add(node);
  for (let node = second; node; node = node.parent) if (ancestors.has(node) && node.type === 'View') return node;
  return null;
}
/** The nearest host View above a node. */
function boxAbove(node) {
  let box = node.parent;
  while (box && box.type !== 'View') box = box.parent;
  return box;
}

async function layOut(tree, width = PAD_WIDTH) {
  await renderer.act(async () => {
    pad(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: width / 3 } } });
  });
}

/** Opens the sheet with the FIRMAR of the row that names the role, and lays the pad out. */
async function openSheet(tree, role = AIRLINE) {
  const label = tree.root.findAll(node => node.type === 'Text' && node.props.children === role)[0];
  let button;
  for (let node = label.parent; node && !button; node = node.parent) {
    button = node.findAll(candidate => candidate.props.accessibilityRole === 'button' &&
      typeof candidate.props.onPress === 'function' &&
      candidate.findAll(text => text.type === 'Text' && text.props.children === 'FIRMAR').length > 0)[0];
  }
  await press(button);
  await layOut(tree);
}

async function type(tree, label, value) {
  const input = modal(tree).findAll(node => node.props.accessibilityLabel === label &&
    typeof node.props.onChangeText === 'function')[0];
  await renderer.act(async () => { input.props.onChangeText(value); });
}

let clock = 0;
/** A one-finger responder event at (x, y) on the pad, as the responder system hands it to PanResponder. */
function touchAt(x, y) {
  clock += 16;
  const track = { touchActive: true, startPageX: x, startPageY: y, startTimeStamp: clock, currentPageX: x,
    currentPageY: y, currentTimeStamp: clock, previousPageX: x, previousPageY: y, previousTimeStamp: clock };
  return {
    nativeEvent: { locationX: x, locationY: y, pageX: x, pageY: y, timestamp: clock, touches: [], changedTouches: [] },
    touchHistory: { numberActiveTouches: 1, indexOfSingleActiveTouch: 0, mostRecentTimeStamp: clock, touchBank: [track] },
  };
}

async function gesture(tree, handler, x, y) {
  await renderer.act(async () => { pad(tree).props[handler](touchAt(x, y)); });
}

/** A stroke through the points; it ends with the finger lifted unless told otherwise. */
async function drawStroke(tree, points, end = 'onResponderRelease') {
  const [[x0, y0], ...rest] = points;
  await gesture(tree, 'onResponderGrant', x0, y0);
  for (const [x, y] of rest) await gesture(tree, 'onResponderMove', x, y);
  const [xn, yn] = points.at(-1);
  await gesture(tree, end, xn, yn);
}

beforeEach(() => {
  jest.clearAllMocks();
  mockLayout = 'medium';
});

describe('the sheet’s frame (S2, D-S2)', () => {
  test.each(['medium', 'compact'])('in %s, FIRMAR, CANCELAR and the fingerprint sit in a fixed footer, outside the scroll',
    async layout => {
      mockLayout = layout;
      const tree = await render();
      await openSheet(tree);
      const body = scroll(tree);
      expect(body).toBeDefined();
      for (const node of [sheetButton(tree, 'FIRMAR'), sheetButton(tree, 'CANCELAR'), fingerprint(tree)]) {
        expect(node).toBeDefined();
        expect(contains(body, node)).toBe(false);
      }
      expect(textOf(fingerprint(tree))).toBe('Huella del documento 0123456789ab…abcdef');
      // Who signs comes first in the body, so the footer never covers the fields; the data and then the pad follow.
      const nodes = body.findAll(() => true);
      const name = body.findAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Nombre de quien firma')[0];
      const flights = body.findAll(node => node.type === 'Text' && node.props.children === 'Vuelos')[0];
      expect(nodes.indexOf(name)).toBeGreaterThan(-1);
      expect(nodes.indexOf(name)).toBeLessThan(nodes.indexOf(flights));
      expect(nodes.indexOf(flights)).toBeLessThan(nodes.indexOf(pad(tree)));
    });

  test.each([['expanded', 'row'], ['medium', 'row'], ['compact', 'column']])('in %s the footer lays CANCELAR and FIRMAR out in a %s',
    async (layout, direction) => {
      mockLayout = layout;
      const tree = await render();
      await openSheet(tree);
      const box = sharedBox(sheetButton(tree, 'CANCELAR'), sheetButton(tree, 'FIRMAR'));
      expect(StyleSheet.flatten(box.props.style)?.flexDirection ?? 'column').toBe(direction);
    });

  test('the sheet turns with the tablet and keeps its header and footer clear of the system bars', async () => {
    const tree = await render();
    await openSheet(tree);
    // iOS keeps a modal in portrait unless it lists the orientations; the app follows the device (fce328ca).
    expect(modal(tree).props.supportedOrientations).toEqual(expect.arrayContaining(['portrait', 'landscape']));
    const safe = modal(tree).findAll(node => node.type === 'SafeAreaView')[0];
    expect(safe).toBeDefined();
    expect(safe.props.edges).toEqual(expect.arrayContaining(['top', 'bottom', 'left', 'right']));
    for (const node of [closeButton(tree), scroll(tree), sheetButton(tree, 'FIRMAR')]) expect(contains(safe, node)).toBe(true);
  });

  test('«Cerrar sin firmar» in the fixed header and Android’s back button close the sheet without signing', async () => {
    const tree = await render();
    await openSheet(tree);
    await type(tree, 'Nombre de quien firma', 'Ana Pérez');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    expect(closeButton(tree)).toBeDefined();
    expect(contains(scroll(tree), closeButton(tree))).toBe(false);
    await press(closeButton(tree));
    expect(modal(tree)).toBeUndefined();

    await openSheet(tree);
    await renderer.act(async () => { modal(tree).props.onRequestClose(); });
    expect(modal(tree)).toBeUndefined();
    expect(mockSign).not.toHaveBeenCalled();
  });
});

describe('the pad (S2)', () => {
  test('a stroke the scroll takes away gives the scroll back and leaves no stroke', async () => {
    const tree = await render();
    await openSheet(tree);
    await gesture(tree, 'onResponderGrant', 60, 30);
    await gesture(tree, 'onResponderMove', 60, 90);
    expect(scroll(tree).props.scrollEnabled).toBe(false);
    expect(padPaths(tree)).toHaveLength(2);
    // The swipe turns into a scroll: Android's scroll view terminates the pad's responder.
    await gesture(tree, 'onResponderTerminate', 60, 90);
    expect(scroll(tree).props.scrollEnabled).toBe(true);
    expect(padPaths(tree)).toHaveLength(1);
    expect(padPaths(tree)[0].props.stroke).toBe(colors.border);
    expect(textOf(pad(tree).findAll(node => node.type === 'Text')[0])).toBe('Firme aquí con el dedo');
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(true);
  });

  test('a stroke the scroll takes away keeps the strokes already drawn', async () => {
    const tree = await render();
    await openSheet(tree);
    await type(tree, 'Nombre de quien firma', 'Ana Pérez');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    await drawStroke(tree, [[300, 100], [300, 160]], 'onResponderTerminate');
    expect(scroll(tree).props.scrollEnabled).toBe(true);
    expect(padPaths(tree)).toHaveLength(2);
    expect(padPaths(tree)[1].props.stroke).toBe(colors.navy);
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(false);
  });

  test('«Borrar firma» leaves only the baseline, also with a stroke in progress', async () => {
    const tree = await render();
    await openSheet(tree);
    await drawStroke(tree, [[60, 30], [120, 60]]);
    await gesture(tree, 'onResponderGrant', 300, 100);
    await gesture(tree, 'onResponderMove', 360, 120);
    await press(clearButton(tree));
    expect(padPaths(tree)).toHaveLength(1);
    expect(padPaths(tree)[0].props.stroke).toBe(colors.border);
    expect(scroll(tree).props.scrollEnabled).toBe(true);
    // The rest of that gesture draws nothing.
    await gesture(tree, 'onResponderMove', 400, 140);
    await gesture(tree, 'onResponderRelease', 400, 140);
    expect(padPaths(tree)).toHaveLength(1);
    expect(clearButton(tree).props.disabled).toBe(true);
  });

  test('a pad that leaves mid-stroke gives its sheet the scroll back', async () => {
    function Sheet({ withPad }) {
      const [drawing, setDrawing] = React.useState(false);
      return React.createElement(ScrollView, { scrollEnabled: !drawing },
        withPad ? React.createElement(SignaturePad, { value: [], onChange: () => {}, onDrawing: setDrawing }) : null);
    }
    const scrollOf = tree => tree.root.findAll(node => node.type === 'RCTScrollView')[0];
    let tree;
    await renderer.act(async () => { tree = renderer.create(React.createElement(Sheet, { withPad: true })); });
    await layOut(tree);
    await gesture(tree, 'onResponderGrant', 60, 30);
    await gesture(tree, 'onResponderMove', 90, 60);
    expect(scrollOf(tree).props.scrollEnabled).toBe(false);
    await renderer.act(async () => { tree.update(React.createElement(Sheet, { withPad: false })); });
    expect(scrollOf(tree).props.scrollEnabled).toBe(true);
  });

  test('the pad is at most 720 dp wide, centred, and keeps its 3:1 shape', async () => {
    const tree = await render();
    await openSheet(tree);
    const box = StyleSheet.flatten(boxAbove(pad(tree)).props.style);
    expect(box).toEqual(expect.objectContaining({ width: '100%', maxWidth: 720, alignSelf: 'center' }));
    expect(StyleSheet.flatten(pad(tree).props.style).height).toBe(200);
    await layOut(tree, 720);
    expect(StyleSheet.flatten(pad(tree).props.style).height).toBe(240);
  });
});

describe('guards', () => {
  test('only the strokes on the pad are signed, not one the scroll took away', async () => {
    const tree = await render();
    await openSheet(tree);
    await type(tree, 'Nombre de quien firma', '  Ana Pérez ');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    await drawStroke(tree, [[300, 100], [300, 160]], 'onResponderTerminate');
    await drawStroke(tree, [[420, 60], [480, 90]]);
    expect(padPaths(tree)).toHaveLength(3);
    await press(sheetButton(tree, 'FIRMAR'));
    expect(mockSign).toHaveBeenCalledWith(OPERATION_ID, 'ServiceOrder', 'AirlineRepresentative', 'Ana Pérez', SHA,
      [[0.1, 0.15, 0.2, 0.3], [0.7, 0.3, 0.8, 0.45]], undefined);
    expect(modal(tree)).toBeUndefined();
  });

  test('the charter request asks for the ID or passport and signs it normalized (ADR-0033)', async () => {
    const tree = await render([charterRequest()]);
    await openSheet(tree);
    await type(tree, 'Nombre de quien firma', 'Ana Pérez');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(true);
    await type(tree, 'Cédula o pasaporte', 'A1');
    expect(JSON.stringify(modal(tree).findAll(node => node.type === 'Text').map(textOf)))
      .toContain('Use solo letras, números o guiones (4 a 40).');
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(true);
    await type(tree, 'Cédula o pasaporte', ' pa 123-4567 ');
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(false);
    await press(sheetButton(tree, 'FIRMAR'));
    expect(mockSign).toHaveBeenCalledWith(OPERATION_ID, 'CharterServiceRequest', 'AirlineRepresentative', 'Ana Pérez', SHA,
      [[0.1, 0.15, 0.2, 0.3]], 'PA123-4567');
  });

  test('starting a stroke leaves the keyboard open: closing it would move the pad under the first stroke', async () => {
    const dismiss = jest.spyOn(Keyboard, 'dismiss');
    try {
      const tree = await render();
      await openSheet(tree);
      await drawStroke(tree, [[60, 30], [120, 60]]);
      expect(dismiss).not.toHaveBeenCalled();
    } finally {
      dismiss.mockRestore();
    }
  });
});
