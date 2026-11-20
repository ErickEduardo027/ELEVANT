// 3-N12: what a session left unsent stays on the tablet bound to its account, and the agent is told it is there:
// on the access screen, before signing out and, for other accounts' records, in «Sincronización».
const React = require('react');
const renderer = require('react-test-renderer');

let mockNotice;
let mockEnded = null;
let mockUnsent = { current: 0, ended: 0, others: 0 };
const mockLogin = jest.fn();

jest.mock('expo-router', () => ({
  router: { replace: jest.fn(), push: jest.fn() },
  useLocalSearchParams: () => (mockNotice ? { notice: mockNotice } : {}),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('../src/utils/app-exit', () => ({ exitApplication: jest.fn() }));
jest.mock('../src/services/mobile-auth', () => ({
  MobileServiceError: class MobileServiceError extends Error {},
  getMobileSession: jest.fn(async () => null),
  loginMobileAgent: (...args) => mockLogin(...args),
  readEndedSession: jest.fn(async () => mockEnded),
  readUnsentRecords: jest.fn(async () => mockUnsent),
}));

const {
  loginPendingEvidenceNotice,
  otherAccountsPendingEvidenceNote,
  signOutPendingEvidenceNote,
} = require('../src/utils/pending-evidence');
const LoginScreen = require('../src/app/index').default;

async function renderLogin() {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(LoginScreen)); });
  return JSON.stringify(tree.toJSON());
}

beforeEach(() => {
  mockNotice = undefined;
  mockEnded = null;
  mockUnsent = { current: 0, ended: 0, others: 0 };
});

test('the notices name how many records wait and who can send them', () => {
  const unsent = (ended, others) => ({ current: 0, ended, others });
  expect(loginPendingEvidenceNotice(unsent(0, 0), false)).toBeNull();
  expect(loginPendingEvidenceNotice(unsent(0, 1), false)).toBe('Esta tablet guarda 1 registro sin enviar. Inicia sesión '
    + 'con la cuenta que lo registró para enviarlo; si esa cuenta ya no tiene acceso, avisa a OCC.');
  expect(loginPendingEvidenceNotice(unsent(1, 3), false)).toBe('Esta tablet guarda 4 registros sin enviar. Inicia sesión '
    + 'con la cuenta que los registró para enviarlos; si esa cuenta ya no tiene acceso, avisa a OCC.');
  // N7: the agent whose session ended and comes back counts only its own records, never another account's.
  expect(loginPendingEvidenceNotice(unsent(3, 2), true))
    .toBe('Inicia sesión de nuevo para enviar 3 registros guardados en esta tablet.');
  expect(loginPendingEvidenceNotice(unsent(0, 2), true)).toBeNull();
  expect(signOutPendingEvidenceNote(0)).toBeNull();
  expect(signOutPendingEvidenceNote(2)).toBe('Tienes 2 registros sin enviar en esta tablet. Se conservan al cerrar sesión y '
    + 'se envían cuando vuelvas a entrar con tu cuenta.');
  expect(otherAccountsPendingEvidenceNote(1)).toBe('Esta tablet guarda además 1 registro sin enviar de otra cuenta. Solo esa '
    + 'cuenta puede enviarlo al iniciar sesión; si ya no tiene acceso, avisa a OCC.');
});

test('after a 401 the access screen says the records are still on the tablet', async () => {
  mockNotice = 'session_expired';
  mockEnded = { accountId: '40000000-0000-4000-8000-000000000002', reason: 'refused', endedAt: '2026-11-16T20:03:00.000Z' };
  mockUnsent = { current: 0, ended: 3, others: 0 };
  const screen = await renderLogin();
  expect(screen).toContain('ELEVANT cerró la sesión anterior.');
  expect(screen).toContain('Inicia sesión de nuevo para enviar 3 registros guardados en esta tablet.');
});

test('without unsent records the access screen shows no notice', async () => {
  const screen = await renderLogin();
  expect(screen).not.toContain('sin enviar');
  expect(screen).not.toContain('guardados en esta tablet');
});
