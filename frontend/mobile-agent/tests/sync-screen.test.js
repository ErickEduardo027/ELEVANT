// «Sincronización» (ADR-0031, 3-N06): what the tablet keeps and what the agent can do with it. A walk-around photo
// ELEVANT could not store, or one the tablet cannot read, never holds the hand-off without a way out.
const React = require('react');
const renderer = require('react-test-renderer');

const mockDiscard = jest.fn(async () => undefined);
const mockRetry = jest.fn(async () => undefined);
let mockSnapshot = { items: [], syncing: false, confirmed: {}, documents: {}, charters: {}, revisions: {} };

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@elevant/api-client', () => ({
  FLIGHT_REPORT_MILESTONES: [{ code: 'BLOCK_ON', label: 'Bloqueo', phase: 'arrival' }],
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/components/flight-report/connection-badge', () => ({ ConnectionBadge: () => null }));
jest.mock('../src/services/mobile-auth', () => ({ readUnsentRecords: jest.fn(async () => null) }));
jest.mock('../src/services/flight-report', () => ({
  discardFlightReportItem: (...args) => mockDiscard(...args),
  retryFlightReportItem: (...args) => mockRetry(...args),
  flushFlightReport: jest.fn(async () => undefined),
  refreshFlightReportQueue: jest.fn(async () => undefined),
  subscribeFlightReport: listener => { listener(mockSnapshot); return () => {}; },
}));

const SyncScreen = require('../src/app/sync').default;

const operationId = '70000000-0000-4000-8000-000000000001';
const key = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const photo = { kind: 'damagePhoto', operationId, markId: '76000000-0000-4000-8000-000000000001',
  fileUri: 'file:///mark.jpg', contentType: 'image/jpeg' };
const blockOn = { kind: 'milestone', operationId, code: 'BLOCK_ON', occurredAt: '2026-11-04T16:00:00.000Z',
  timeZone: 'America/Santo_Domingo' };
const item = (n, state, command, extra = {}) => ({ idempotencyKey: key(n), state, attempts: 1,
  createdAt: '2026-11-04T16:00:00.000Z', command, ...extra });

async function render(items) {
  mockSnapshot = { ...mockSnapshot, items };
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(SyncScreen)); });
  return tree;
}

function text(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}
const buttons = (tree, title) => tree.root.findAll(node => node.props?.title === title &&
  typeof node.props.onPress === 'function');

beforeEach(() => { jest.clearAllMocks(); });

test('a photo ELEVANT could not store keeps waiting on the device and can be discarded to hand off without it', async () => {
  const tree = await render([item(1, 'pending', photo, { attempts: 3, lastCode: 'walkaround_photo_unavailable',
    lastError: 'ELEVANT no pudo guardar la foto; la tablet la reintenta sola. Para entregar la operación sin ella, descártala.' })]);
  expect(text(tree)).toContain('Guardado en el dispositivo');
  expect(text(tree)).toContain('Para entregar la operación sin ella, descártala.');
  expect(buttons(tree, 'REINTENTAR')).toHaveLength(0);
  const [discard] = buttons(tree, 'DESCARTAR');
  await renderer.act(async () => { discard.props.onPress(); });
  expect(mockDiscard).toHaveBeenCalledWith(key(1));
  await renderer.act(async () => tree.unmount());
});

test('a photo the tablet cannot read was not refused by ELEVANT and can be retried or discarded', async () => {
  const tree = await render([item(2, 'blocked', photo, { lastCode: 'walkaround_photo_unreadable',
    lastError: 'No se pudo leer la foto guardada en la tablet. Descártala: el daño queda marcado sin foto.' })]);
  expect(text(tree)).toContain('No se puede enviar');
  expect(text(tree)).not.toContain('Rechazado por ELEVANT');
  expect(buttons(tree, 'REINTENTAR')).toHaveLength(1);
  expect(buttons(tree, 'DESCARTAR')).toHaveLength(1);
  await renderer.act(async () => tree.unmount());
});

test('a record waiting for signal goes out on its own and cannot be discarded; a refused one can', async () => {
  const tree = await render([
    item(3, 'pending', blockOn, { lastError: 'No fue posible conectar con ELEVANT.' }),
    item(4, 'blocked', { ...blockOn, code: 'PUSHBACK' }, { lastCode: 'milestone_out_of_order',
      lastError: 'Bloqueo debe ser anterior al Push-back.' }),
  ]);
  expect(text(tree)).toContain('Rechazado por ELEVANT');
  expect(buttons(tree, 'ENVIAR AHORA')).toHaveLength(1);
  const discards = buttons(tree, 'DESCARTAR');
  expect(discards).toHaveLength(1);
  await renderer.act(async () => { discards[0].props.onPress(); });
  expect(mockDiscard).toHaveBeenCalledWith(key(4));
  await renderer.act(async () => tree.unmount());
});

test('the photo of a mark ELEVANT refused never left the tablet: it says so and can be discarded', async () => {
  const tree = await render([item(5, 'blocked', photo, { lastCode: 'damage_mark_refused',
    lastError: 'ELEVANT rechazó la marca de este daño: descarta la foto y, si hace falta, vuelve a marcar el daño con su foto.' })]);
  expect(text(tree)).toContain('No se puede enviar');
  expect(text(tree)).toContain('ELEVANT rechazó la marca de este daño');
  expect(buttons(tree, 'DESCARTAR')).toHaveLength(1);
  await renderer.act(async () => tree.unmount());
});
