// N11 (D-N11): «Mis turnos y documentos» writes the shift's day like the rest of the tablet, «lun, 16 nov», and no
// longer forces capitals onto it («Lunes, 16 De Noviembre»). A shift's day is a calendar day, so the device's time zone
// never moves it.
const React = require('react');
const renderer = require('react-test-renderer');
const { Text } = require('react-native');

const mockGetOwnSchedule = jest.fn();

jest.mock('@elevant/api-client', () => ({ ElevantApiError: class ElevantApiError extends Error {} }));
jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async () => null), setItem: jest.fn(async () => {}), removeItem: jest.fn(async () => {}),
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(),
  isMobileAgentNetworkError: jest.fn(() => false),
}));
jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: jest.fn() },
  useFocusEffect: callback => require('react').useEffect(callback, [callback]),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: Object.assign(() => null, { glyphMap: {} }) }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/services/mobile-change-feed', () => ({ subscribeMobileChanges: () => () => {} }));
jest.mock('../src/services/ramp-schedule', () => ({
  SCHEDULE_DAYS: 14,
  getOwnSchedule: (...args) => mockGetOwnSchedule(...args),
}));
jest.mock('../src/utils/session-navigation', () => ({ resetToLogin: jest.fn() }));

const MyScheduleScreen = require('../src/app/my-schedule').default;

function flatStyle(style) {
  return Object.assign({}, ...[style].flat(Infinity).filter(Boolean));
}

async function render() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(MyScheduleScreen)); });
  await renderer.act(async () => {});
  return tree;
}

afterEach(() => mockGetOwnSchedule.mockReset());

test('the shift reads «lun, 16 nov» without forced capitals, and its label says the same', async () => {
  mockGetOwnSchedule.mockResolvedValue({
    shifts: [{ id: 'shift-1', workDate: '2026-11-16', startsAtLocal: '06:00:00', endsAtLocal: '14:00:00',
      block: 'Morning', stationCode: 'PUJ', terminalCode: 'T1' }],
    documents: [{ kind: 'qualification', label: 'Carnet de rampa', number: 'RMP-1', expiresOn: '2027-01-31',
      validity: 'Current' }],
  });
  const tree = await render();

  const title = tree.root.findAllByType(Text).find(node => /^lun\.?, 16 nov\.?$/.test(String(node.props.children)));
  expect(title).toBeDefined();
  expect(flatStyle(title.props.style).textTransform).toBeUndefined();
  const card = tree.root.findAll(node => typeof node.props.accessibilityLabel === 'string' &&
    node.props.accessibilityLabel.startsWith('Turno '))[0];
  expect(card.props.accessibilityLabel).toMatch(/^Turno lun\.?, 16 nov\.? de 06:00 a 14:00$/);
  await renderer.act(async () => { tree.unmount(); });
});
