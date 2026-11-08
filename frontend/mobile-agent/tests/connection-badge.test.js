// 3-N18: the badge every operation screen shows warns while the tablet's clock is off by more than ELEVANT tolerates.
const React = require('react');
const renderer = require('react-test-renderer');

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => undefined), removeItem: jest.fn(async () => undefined),
}));
jest.mock('@react-native-community/netinfo', () => ({ addEventListener: () => () => {} }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/services/flight-report', () => ({
  currentFlightReportSnapshot: () => ({ items: [] }),
  flushFlightReport: jest.fn(async () => undefined),
  refreshFlightReportQueue: jest.fn(async () => undefined),
  subscribeFlightReport: listener => { listener({ items: [], syncing: false }); return () => {}; },
}));
jest.mock('../src/services/ramp-incidents', () => ({ flushPendingRampIncidents: jest.fn(async () => undefined) }));

const clock = require('../src/synchronization/server-clock');
const { ConnectionBadge } = require('../src/components/flight-report/connection-badge');

async function renderBadge() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(ConnectionBadge)); });
  return tree;
}

beforeEach(() => { clock.resetServerClockForTests(); });

test('a clock within the tolerance shows only the connection state', async () => {
  const tree = await renderBadge();
  expect(JSON.stringify(tree.toJSON())).toContain('En línea');
  expect(JSON.stringify(tree.toJSON())).not.toContain('La hora de esta tablet');
});

test('a tablet eleven minutes ahead is told its records are corrected and to check its clock', async () => {
  const tree = await renderBadge();
  const now = Date.now();
  await renderer.act(async () => {
    clock.observeServerDate(new Date(now - 11 * 60_000).toUTCString(), now - 100, now);
  });
  expect(JSON.stringify(tree.toJSON())).toContain('La hora de esta tablet difiere 11 min de ELEVANT; los registros se '
    + 'corrigen solos. Revisa la hora del equipo.');
});
