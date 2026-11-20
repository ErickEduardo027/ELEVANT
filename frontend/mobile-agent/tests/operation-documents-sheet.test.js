// The signature sheet (S2, D-S2). FIRMAR, CANCELAR and the document's fingerprint sit in a fixed footer, below a body
// that scrolls and a fixed header that closes the sheet without signing, so in landscape the buttons are never below
// the fold, and the keyboard lifts that footer instead of covering it. A scroll that starts on the pad and takes the gesture away (Android's scroll view terminates the pad's
// responder; it never releases it) drops the stroke in progress and gives the scroll back; the strokes already kept stay.
// The Service Order's total says it is a contract-price subtotal without ITBIS (N4, D-N4), and the forms whose
// signatures the hand-off to OCC does not wait for say so and use a secondary button (N3, D-N3). A Service Order that
// lacks passengers or the MTOW says so on its row and at the top of its sheet, without holding the signature (S1, D-S1).
// The walk-around and the forms speak with tú to the agent, neutrally to the signer, and count in words (N13, D-N13).
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

const { DeviceEventEmitter, Keyboard, KeyboardAvoidingView, Platform, ScrollView, StyleSheet } = require('react-native');
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
const flightReport = (overrides = {}) => serviceOrder({ kind: 'FlightReport', title: 'Reporte de Vuelo',
  formCode: 'F-OCC-AVL-6.2.12/A9', requiredRoles: ['Coordinator'], ...overrides });
const bridgeChecklist = (overrides = {}) => serviceOrder({ kind: 'BridgeChecklist', title: 'Check-List del puente',
  formCode: 'F-MGO-AVL 8.14.1/A1-A2', requiredRoles: ['BridgeOperator'], ...overrides });
/** A Service Order whose summary differs from the default one. */
const serviceOrderWith = summary => serviceOrder({ summary: { ...serviceOrder().summary, ...summary } });

/**
 * The forms panel of an operation in progress, unless told otherwise: `editable` is what the screen passes while the
 * forms can still be signed (in progress, pending review or returned) and `executionOpen` only while in progress.
 */
async function render(documents = [serviceOrder()], { editable = true, executionOpen = true, items = [] } = {}) {
  mockSnapshot = { items, syncing: false, confirmed: {}, revisions: {}, charters: {},
    documents: { [OPERATION_ID]: { operationId: OPERATION_ID, documents, damageMarks: [] } } };
  let tree;
  await renderer.act(async () => {
    tree = renderer.create(React.createElement(DocumentsPanel, { operationId: OPERATION_ID, editable, executionOpen }));
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
/** The texts on screen in the sheet, in order. */
const sheetTexts = tree => modal(tree).findAll(node => node.type === 'Text').map(textOf);
/** A form's row in the panel: the nearest host View above its title that also holds its signers. */
function documentRow(tree, title) {
  const heading = tree.root.findAll(node => node.type === 'Text' && node.props.children === title)[0];
  for (let node = heading.parent; node; node = node.parent) {
    if (node.type === 'View' && node.findAll(text => text.type === 'Text' && /^(Representante|AVIAM|Coordinador|Operador)/
      .test(textOf(text))).length > 0) return node;
  }
  return null;
}
/** The FIRMAR buttons of the panel, or of one form's row. */
const signButtons = scope => scope.findAll(node => node.props.accessibilityRole === 'button' &&
  typeof node.props.onPress === 'function' &&
  node.findAll(text => text.type === 'Text' && text.props.children === 'FIRMAR').length > 0);
/** WCAG 2 contrast ratio between two #RRGGBB colours. */
function contrast(first, second) {
  const luminance = hex => {
    const [r, g, b] = [1, 3, 5].map(at => parseInt(hex.slice(at, at + 2), 16) / 255)
      .map(channel => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  };
  const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (light + 0.05) / (dark + 0.05);
}

async function layOut(tree, width = PAD_WIDTH) {
  await renderer.act(async () => {
    pad(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width, height: width / 3 } } });
  });
}

/**
 * Opens the sheet with the FIRMAR of the row that names the role, and lays the pad out. Roles repeat across forms:
 * `scope` (a form's row, see `documentRow`) picks the form.
 */
async function openSheet(tree, role = AIRLINE, scope = tree.root) {
  const label = scope.findAll(node => node.type === 'Text' && node.props.children === role)[0];
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

  // The modal's window does not shrink for the keyboard: Android draws it edge to edge (RN 0.81 with
  // edgeToEdgeEnabled) and iOS never resizes a modal. While the signer types the name or the ID, the frame pads itself
  // from the keyboard's own events, on both platforms, so the footer rises above the keyboard and the body shortens.
  test.each([['ios', 'keyboardWillShow', 'keyboardWillHide'], ['android', 'keyboardDidShow', 'keyboardDidHide']])(
    'on %s the keyboard lifts the footer: body and footer sit in a KeyboardAvoidingView that pads by the keyboard',
    async (os, shown, hidden) => {
      const platform = jest.replaceProperty(Platform, 'OS', os);
      try {
        const tree = await render();
        await openSheet(tree);
        const avoiding = modal(tree).findAll(node => node.type === KeyboardAvoidingView);
        expect(avoiding).toHaveLength(1);
        expect(avoiding[0].props.behavior).toBe('padding');
        for (const node of [scroll(tree), sheetButton(tree, 'FIRMAR'), sheetButton(tree, 'CANCELAR'), fingerprint(tree)]) {
          expect(contains(avoiding[0], node)).toBe(true);
        }
        // A 1280 × 800 dp tablet in landscape: the frame runs from under the 24 dp status bar to above the 24 dp
        // navigation bar, and the keyboard covers the bottom 324 dp, so the frame pads its bottom by 300 dp.
        const box = () => avoiding[0].findAll(node => node.type === 'View' && typeof node.props.onLayout === 'function')[0];
        const padding = () => StyleSheet.flatten(box().props.style).paddingBottom ?? 0;
        const keyboard = async (event, screenY, height) => {
          await renderer.act(async () => {
            DeviceEventEmitter.emit(event, { endCoordinates: { screenX: 0, screenY, width: 1280, height } });
            await new Promise(resolve => setTimeout(resolve, 0));
          });
        };
        await renderer.act(async () => {
          await box().props.onLayout({ persist() {}, nativeEvent: { layout: { x: 0, y: 24, width: 1280, height: 752 } } });
        });
        expect(padding()).toBe(0);
        await keyboard(shown, 476, 324);
        expect(padding()).toBe(300);
        await keyboard(hidden, 800, 0);
        expect(padding()).toBe(0);
      } finally {
        platform.restore();
      }
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
      .toContain('Solo letras, números o guiones (4 a 40).');
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

describe('the Service Order’s total says what it is (N4, D-N4)', () => {
  const NOTE = 'Subtotal a precio de contrato, sin ITBIS. El importe final lo calcula Finanzas al facturar.';
  const SURCHARGES = 'Los recargos listados se valoran al facturar.';
  const textNode = (tree, predicate) => modal(tree).findAll(node => node.type === 'Text' && predicate(textOf(node)))[0];

  test('under the total, a note says it is the subtotal at contract price, without ITBIS', async () => {
    const tree = await render();
    await openSheet(tree);
    const label = textNode(tree, text => text === 'Monto total');
    const note = textNode(tree, text => text.startsWith('Subtotal a precio de contrato'));
    expect(note).toBeDefined();
    expect(textOf(note)).toBe(NOTE);
    expect(sheetTexts(tree)).toContain('USD 300.00');
    // Right under the total, in the same box as the lines, and before the pad.
    const nodes = modal(tree).findAll(() => true);
    expect(nodes.indexOf(note)).toBeGreaterThan(nodes.indexOf(label));
    expect(nodes.indexOf(note)).toBeLessThan(nodes.indexOf(pad(tree)));
    expect(boxAbove(note)).toBe(boxAbove(boxAbove(label)));
    expect(sheetTexts(tree).join(' ')).not.toContain(SURCHARGES);
  });

  test('with surcharges listed, the note adds that they are valued when invoicing', async () => {
    const tree = await render([serviceOrderWith({ surcharges: ['Recargo nocturno · RAMP-AC'] })]);
    await openSheet(tree);
    expect(sheetTexts(tree)).toContain('Recargo: Recargo nocturno · RAMP-AC');
    expect(sheetTexts(tree)).toContain(`${NOTE} ${SURCHARGES}`);
  });

  test('a total not valued yet reads «Pendiente de valoración», without the note', async () => {
    const tree = await render([serviceOrderWith({ totalAmount: null,
      services: [{ code: 'RAMP-AC', name: 'Aire acondicionado', quantity: 1, unit: 'hour', amount: null }] })]);
    await openSheet(tree);
    const label = textNode(tree, text => text === 'Monto total');
    const value = textNode(tree, text => text === 'Pendiente de valoración');
    expect(value).toBeDefined();
    expect(contains(boxAbove(label), value)).toBe(true);
    expect(sheetTexts(tree).join(' ')).not.toContain('ITBIS');
  });

  test('the Flight Report carries no note', async () => {
    const tree = await render([flightReport()]);
    await openSheet(tree, 'Coordinador');
    expect(sheetTexts(tree).join(' ')).toContain('puntos del checklist');
    expect(sheetTexts(tree).join(' ')).not.toContain('ITBIS');
  });

  test('a charter carries no note, neither on its Service Request nor on its Service Order', async () => {
    const tree = await render([charterRequest(), serviceOrder()]);
    await openSheet(tree, AIRLINE, documentRow(tree, 'Solicitud de Servicio'));
    expect(sheetTexts(tree)).toContain('Solicitud de Servicio · SS-PUJ-0001');
    expect(sheetTexts(tree)).toContain('Monto total');
    expect(sheetTexts(tree).join(' ')).not.toContain('ITBIS');
    await press(closeButton(tree));
    // A charter is priced at Finance's base tariff, not a contract: «a precio de contrato» would be false.
    await openSheet(tree, AIRLINE, documentRow(tree, 'Orden de Servicio'));
    expect(sheetTexts(tree)).toContain('Orden de Servicio · OS-PUJ-0001');
    expect(sheetTexts(tree)).toContain('Monto total');
    expect(sheetTexts(tree).join(' ')).not.toContain('ITBIS');
  });
});

describe('signatures the hand-off to OCC does not wait for (N3, D-N3)', () => {
  const OPTIONAL = 'No hace falta para entregar a OCC';
  const noteIn = scope => scope.findAll(node => node.type === 'Text' && textOf(node) === OPTIONAL)[0];
  const allForms = () => [charterRequest(), serviceOrder(), flightReport(), bridgeChecklist()];

  test('only the Flight Report and the bridge checklist say so, with an icon', async () => {
    const tree = await render(allForms());
    expect(noteIn(documentRow(tree, 'Solicitud de Servicio'))).toBeUndefined();
    expect(noteIn(documentRow(tree, 'Orden de Servicio'))).toBeUndefined();
    for (const title of ['Reporte de Vuelo', 'Check-List del puente']) {
      const note = noteIn(documentRow(tree, title));
      expect(note).toBeDefined();
      expect(boxAbove(note).findAll(node => node.props.name === 'information-circle-outline')).toHaveLength(1);
    }
  });

  test('their FIRMAR is a secondary navy button with AA contrast; the others stay orange', async () => {
    const tree = await render(allForms());
    const style = button => StyleSheet.flatten(button.props.style({ pressed: false }));
    const label = button => StyleSheet.flatten(button.findAll(node => node.type === 'Text' &&
      node.props.children === 'FIRMAR')[0].props.style);
    const icon = button => button.findAll(node => node.props.name === 'pencil')[0].props.color;
    for (const title of ['Reporte de Vuelo', 'Check-List del puente']) {
      const [button] = signButtons(documentRow(tree, title));
      expect(style(button)).toEqual(expect.objectContaining({ backgroundColor: colors.white, borderColor: colors.navy }));
      expect(label(button).color).toBe(colors.navy);
      expect(icon(button)).toBe(colors.navy);
      expect(contrast(label(button).color, style(button).backgroundColor)).toBeGreaterThanOrEqual(4.5);
      expect(contrast(style(button).borderColor, colors.white)).toBeGreaterThanOrEqual(3);
      const note = noteIn(documentRow(tree, title));
      expect(contrast(StyleSheet.flatten(note.props.style).color, colors.white)).toBeGreaterThanOrEqual(4.5);
    }
    for (const title of ['Solicitud de Servicio', 'Orden de Servicio']) {
      for (const button of signButtons(documentRow(tree, title))) {
        expect(style(button).backgroundColor).toBe(colors.orange);
        expect(label(button).color).toBe(colors.white);
      }
    }
  });

  test('every FIRMAR names its role for the screen reader, «Firmar: {rol}»', async () => {
    const tree = await render(allForms());
    expect(signButtons(tree.root).map(button => button.props.accessibilityLabel)).toEqual([
      'Firmar: Representante de la aerolínea',
      'Firmar: Representante de la aerolínea', 'Firmar: AVIAM · Responsable',
      'Firmar: Coordinador',
      'Firmar: Operador del puente',
    ]);
    // A screen reader that jumps from button to button still hears that the Flight Report is not needed.
    const [optional] = signButtons(documentRow(tree, 'Reporte de Vuelo'));
    expect(optional.props.accessibilityHint).toBe(OPTIONAL);
    const [required] = signButtons(documentRow(tree, 'Orden de Servicio'));
    expect(required.props.accessibilityHint).toBeUndefined();
  });

  test('the secondary FIRMAR opens the same signature sheet', async () => {
    const tree = await render([flightReport()]);
    await openSheet(tree, 'Coordinador');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    await press(sheetButton(tree, 'FIRMAR'));
    expect(mockSign).toHaveBeenCalledWith(OPERATION_ID, 'FlightReport', 'Coordinator', 'Riley Ramp', SHA,
      [[0.1, 0.15, 0.2, 0.3]], undefined);
  });

  const SIGNED = { isFullySigned: true,
    signatures: [{ role: 'Coordinator', signerName: 'Riley Ramp', signedAt: '2026-10-05T15:00:00Z' }] };
  const WAITING = [{ idempotencyKey: '91000000-0000-4000-8000-000000000009', state: 'pending', attempts: 0,
    createdAt: '2026-10-05T15:00:00.000Z', command: { kind: 'signature', operationId: OPERATION_ID,
      documentKind: 'FlightReport', role: 'Coordinator', signerName: 'Riley Ramp' } }];
  test.each([
    ['the form is signed', [flightReport(SIGNED)], {}],
    ['its signature waits on the device', [flightReport()], { items: WAITING }],
    ['the forms cannot be signed (editable=false)', [flightReport()], { editable: false }],
    ['the execution is closed, handed off to OCC', [flightReport()], { executionOpen: false }],
  ])('the note goes away when %s', async (_description, documents, options) => {
    const tree = await render(documents, options);
    expect(noteIn(documentRow(tree, 'Reporte de Vuelo'))).toBeUndefined();
    expect(JSON.stringify(tree.toJSON())).not.toContain(OPTIONAL);
  });

  test('with the forms still signable after the hand-off, the button stays secondary and names its role', async () => {
    const tree = await render([flightReport()], { executionOpen: false });
    const [button] = signButtons(documentRow(tree, 'Reporte de Vuelo'));
    expect(StyleSheet.flatten(button.props.style({ pressed: false })).backgroundColor).toBe(colors.white);
    expect(button.props.accessibilityLabel).toBe('Firmar: Coordinador');
    expect(button.props.accessibilityHint).toBeUndefined();
  });
});

// S1 (D-S1): the Service Order was signed with «Pasajeros —» and «MTOW —» and nothing warned before signing. It warns
// now, and the signature is never held: 0 passengers is a value, a missing MTOW only warns.
describe('the Service Order warns about missing flight data and never holds the signature (S1, D-S1)', () => {
  const WRITE = 'Faltan los pasajeros que llegan y el MTOW en la Orden. Escríbelos en «Datos del vuelo» antes de firmar.';
  const incomplete = (overrides = {}) => ({ ...serviceOrderWith({ passengersIn: null, mtowKg: null }), ...overrides });
  const warningIn = scope => scope.findAll(node => node.type === 'Text' && /^Faltan? /.test(textOf(node)))[0];
  const rowWarning = tree => warningIn(documentRow(tree, 'Orden de Servicio'));

  test('its row and the top of its sheet say what is missing, and FIRMAR still signs', async () => {
    const tree = await render([incomplete()]);
    expect(textOf(rowWarning(tree))).toBe(WRITE);
    expect(boxAbove(rowWarning(tree)).findAll(node => node.props.name === 'warning-outline')).toHaveLength(1);
    expect(contrast(StyleSheet.flatten(rowWarning(tree).props.style).color, colors.paleOrange)).toBeGreaterThanOrEqual(4.5);
    // The row's FIRMAR is not held, and a screen reader that jumps to it hears the warning.
    const [airline] = signButtons(documentRow(tree, 'Orden de Servicio'));
    expect(airline.props.disabled).toBe(false);
    expect(airline.props.accessibilityHint).toBe(WRITE);

    await openSheet(tree);
    const body = scroll(tree);
    const warning = warningIn(body);
    expect(textOf(warning)).toBe(WRITE);
    const nodes = body.findAll(() => true);
    const name = body.findAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === 'Nombre de quien firma')[0];
    expect(nodes.indexOf(warning)).toBeGreaterThan(-1);
    expect(nodes.indexOf(warning)).toBeLessThan(nodes.indexOf(name));
    // The facts still show what the signer signs.
    expect(sheetTexts(tree)).toContain('— llegan · 138 salen');
    await type(tree, 'Nombre de quien firma', 'Ana Pérez');
    await drawStroke(tree, [[60, 30], [120, 60]]);
    expect(sheetButton(tree, 'FIRMAR').props.disabled).toBe(false);
    await press(sheetButton(tree, 'FIRMAR'));
    expect(mockSign).toHaveBeenCalledWith(OPERATION_ID, 'ServiceOrder', 'AirlineRepresentative', 'Ana Pérez', SHA,
      [[0.1, 0.15, 0.2, 0.3]], undefined);
  });

  test('a signed Order says that saving them asks for the signatures again', async () => {
    const tree = await render([incomplete({ signatures: [{ role: 'AirlineRepresentative', signerName: 'Ana Pérez',
      signedAt: '2026-10-05T15:00:00Z' }] })]);
    expect(textOf(rowWarning(tree))).toBe('Faltan los pasajeros que llegan y el MTOW en la Orden. Si los guardas ahora ' +
      'en «Datos del vuelo», hay que volver a firmarla.');
    await openSheet(tree, 'AVIAM · Responsable');
    expect(textOf(warningIn(scroll(tree)))).toBe(textOf(rowWarning(tree)));
  });

  // Signed without signal: the airline's signature waits in the queue and goes out before data saved after it, so the
  // data would make it stale. The push-back's sheet already counts it (N2); the Order's row and sheet say the same.
  test('a signature waiting on the device counts as signed; one ELEVANT refused does not', async () => {
    const SIGNED = 'Faltan los pasajeros que llegan y el MTOW en la Orden. Si los guardas ahora en «Datos del vuelo», ' +
      'hay que volver a firmarla.';
    const waiting = state => [{ idempotencyKey: '91000000-0000-4000-8000-000000000011', state, attempts: 0,
      createdAt: '2026-10-05T15:00:00.000Z', command: { kind: 'signature', operationId: OPERATION_ID,
        documentKind: 'ServiceOrder', role: 'AirlineRepresentative', signerName: 'Ana Pérez' } }];
    let tree = await render([incomplete()], { items: waiting('pending') });
    expect(textOf(rowWarning(tree))).toBe(SIGNED);
    await openSheet(tree, 'AVIAM · Responsable');
    expect(textOf(warningIn(scroll(tree)))).toBe(SIGNED);
    await renderer.act(async () => tree.unmount());

    tree = await render([incomplete()], { items: waiting('blocked') });
    expect(textOf(rowWarning(tree))).toBe(WRITE);
    await renderer.act(async () => tree.unmount());
  });

  test('0 passengers is a value: only the missing MTOW is said', async () => {
    const tree = await render([serviceOrderWith({ passengersIn: 0, passengersOut: 0, mtowKg: null })]);
    expect(textOf(rowWarning(tree))).toBe('Falta el MTOW en la Orden. Escríbelo en «Datos del vuelo» antes de firmar.');
  });

  test('flight data saved on the device is on its way, not to be written again', async () => {
    const tree = await render([incomplete()], { items: [{ idempotencyKey: '91000000-0000-4000-8000-000000000010',
      state: 'pending', attempts: 0, createdAt: '2026-10-05T15:00:00.000Z', command: { kind: 'flightData',
        operationId: OPERATION_ID, passengersIn: 142, passengersOut: 138, mtowKg: 78000, aircraftRegistration: null } }] });
    expect(textOf(rowWarning(tree))).toBe('Faltan los pasajeros que llegan y el MTOW en la Orden. Lo que guardaste en ' +
      '«Datos del vuelo» llega a la Orden cuando se envíe a ELEVANT.');
  });

  test('after the hand-off it only says what is missing', async () => {
    const tree = await render([incomplete()], { executionOpen: false });
    expect(textOf(rowWarning(tree))).toBe('Faltan los pasajeros que llegan y el MTOW en la Orden.');
  });

  test('only the Order warns; complete data or a form read without its summary say nothing', async () => {
    let tree = await render([flightReport({ summary: { ...serviceOrder().summary, passengersIn: null, mtowKg: null } })]);
    expect(warningIn(tree.root)).toBeUndefined();
    tree = await render([serviceOrder()]);
    expect(warningIn(tree.root)).toBeUndefined();
    const bare = serviceOrder();
    delete bare.summary;
    tree = await render([bare]);
    expect(warningIn(tree.root)).toBeUndefined();
    expect(signButtons(documentRow(tree, 'Orden de Servicio'))).toHaveLength(2);
  });
});

describe('the one form the hand-off waits for (N3, handoff.ts)', () => {
  const {
    HANDOFF_REQUIRED_FORM,
    isOptionalForHandoff,
    isServiceOrderSigned,
  } = require('../src/features/assigned-operations/handoff');
  const forms = (...documents) => ({ documents });

  test('the Service Order is the form that holds the hand-off', () => {
    expect(HANDOFF_REQUIRED_FORM).toBe('ServiceOrder');
    expect(isServiceOrderSigned(forms({ kind: HANDOFF_REQUIRED_FORM, isFullySigned: true, staleRoles: [] }))).toBe(true);
  });

  test.each([
    ['FlightReport', true],
    ['BridgeChecklist', true],
    ['ServiceOrder', false],
    ['CharterServiceRequest', false],
    ['SomethingNew', false],
    ['constructor', false],
  ])('isOptionalForHandoff(%s) is %s', (kind, optional) => {
    expect(isOptionalForHandoff(kind)).toBe(optional);
  });

  test('unsigned optional forms do not change whether the hand-off waits', () => {
    expect(isServiceOrderSigned(forms(
      { kind: 'FlightReport', isFullySigned: false, staleRoles: [] },
      { kind: 'BridgeChecklist', isFullySigned: false, staleRoles: ['BridgeOperator'] },
      { kind: 'ServiceOrder', isFullySigned: true, staleRoles: [] },
    ))).toBe(true);
    expect(isServiceOrderSigned(forms({ kind: 'FlightReport', isFullySigned: true, staleRoles: [] }))).toBe(false);
  });
});

// N13 (D-N13): the tablet mixed usted and tú, and wrote «daño(s)». It speaks to the agent with tú now; what the signer
// reads is neutral, except the pad's «Firme aquí con el dedo». Counts are written in words: «Sin daños», «1 daño»,
// «2 daños», and the forms' summary counts «hitos», the name of the panel that records them.
describe('tú to the agent, neutral to the signer and counts in words (N13, D-N13)', () => {
  const { WalkaroundCard, damageCountLabel } = require('../src/components/documents/operation-documents');
  const ImagePicker = require('expo-image-picker');
  /** The usted the tablet wrote, as whole words: «registró» inside «la cuenta que lo registró» is not the agent's. */
  const USTED = /(?<!\p{L})(Toque|toque|Agregue|registró|encontró|actívelo|firme de nuevo|Use solo)(?!\p{L})/u;
  const texts = tree => tree.root.findAll(node => node.type === 'Text').map(textOf);
  const mark = n => ({ id: `76000000-0000-4000-8000-00000000000${n}`, x: 0.5, y: 0.5, note: `Daño ${n}` });
  const silhouette = tree => tree.root.findAll(node => node.props.accessibilityRole === 'button' &&
    typeof node.props.onPress === 'function' && String(node.props.accessibilityLabel).startsWith('Silueta del avión'))[0];

  async function renderWalkaround(damageMarks = []) {
    mockSnapshot = { items: [], syncing: false, confirmed: {}, revisions: {}, charters: {},
      documents: { [OPERATION_ID]: { operationId: OPERATION_ID, documents: [], damageMarks } } };
    let tree;
    await renderer.act(async () => {
      tree = renderer.create(React.createElement(WalkaroundCard, { operationId: OPERATION_ID, editable: true }));
    });
    return tree;
  }

  test('damageCountLabel writes the count in words', () => {
    expect([0, 1, 2, 12].map(damageCountLabel)).toEqual(['Sin daños', '1 daño', '2 daños', '12 daños']);
  });

  test('the walk-around speaks with tú and counts its damages in words', async () => {
    let tree = await renderWalkaround();
    expect(texts(tree)).toContain('Sin daños');
    expect(texts(tree)).toContain('Toca el avión donde encontraste una anomalía. Agrega una nota y una foto.');
    expect(silhouette(tree).props.accessibilityLabel).toBe('Silueta del avión: toca para marcar un daño');
    expect(texts(tree).join(' ')).not.toMatch(USTED);
    expect(texts(tree).join(' ')).not.toContain('(s)');
    await renderer.act(async () => tree.unmount());

    tree = await renderWalkaround([mark(1)]);
    expect(texts(tree)).toContain('1 daño');
    await renderer.act(async () => tree.unmount());
    tree = await renderWalkaround([mark(1), mark(2)]);
    expect(texts(tree)).toContain('2 daños');
    await renderer.act(async () => tree.unmount());
  });

  test('the damage sheet asks what the agent found, and says how to allow the camera, with tú', async () => {
    ImagePicker.requestCameraPermissionsAsync.mockResolvedValue({ granted: false });
    const tree = await renderWalkaround();
    await renderer.act(async () => {
      silhouette(tree).props.onLayout({ nativeEvent: { layout: { x: 0, y: 0, width: 400, height: 200 } } });
    });
    await renderer.act(async () => { silhouette(tree).props.onPress({ nativeEvent: { locationX: 200, locationY: 100 } }); });
    const [note] = modal(tree).findAll(node => node.type === 'TextInput');
    expect(note.props.accessibilityLabel).toBe('Qué encontraste');
    expect(note.props.placeholder).toBe('Qué encontraste (mínimo 3 caracteres)');
    await press(sheetButton(tree, 'TOMAR FOTO'));
    expect(texts(tree)).toContain('Sin permiso de cámara: actívalo en los ajustes de la tablet.');
    expect(ImagePicker.launchCameraAsync).not.toHaveBeenCalled();
    expect(texts(tree).join(' ')).not.toMatch(USTED);
  });

  test('the forms panel speaks with tú to the agent and neutrally of who signs again', async () => {
    const tree = await render([serviceOrder({ staleRoles: ['AirlineRepresentative'] })]);
    expect(texts(tree)).toContain('Se llenan solos con lo que ya registraste. Quien firma revisa los datos en pantalla.');
    expect(texts(tree)).toContain('Los datos cambiaron después de la firma: hay que firmar de nuevo.');
    expect(texts(tree).join(' ')).not.toMatch(USTED);
  });

  test('the signer reads neutral text, except the pad’s «Firme aquí con el dedo»', async () => {
    const tree = await render([charterRequest()]);
    await openSheet(tree);
    await type(tree, 'Cédula o pasaporte', 'A1');
    expect(sheetTexts(tree)).toContain('Solo letras, números o guiones (4 a 40).');
    expect(sheetTexts(tree)).toContain('Firme aquí con el dedo');
    expect(sheetTexts(tree).join(' ')).not.toMatch(USTED);
  });

  test('the Flight Report’s summary counts its milestones and damages in words', async () => {
    let tree = await render([flightReport()]);
    await openSheet(tree, 'Coordinador');
    expect(sheetTexts(tree)).toContain('4 hitos · 21/21 puntos del checklist · Sin daños');
    await renderer.act(async () => tree.unmount());

    tree = await render([flightReport({ summary: { ...serviceOrder().summary, milestoneCount: 1, damageCount: 1 } })]);
    await openSheet(tree, 'Coordinador');
    expect(sheetTexts(tree)).toContain('1 hito · 21/21 puntos del checklist · 1 daño');
    expect(sheetTexts(tree).join(' ')).not.toContain('(s)');
  });
});
