// «Cambia tu contraseña temporal» on the tablet's sign-in screen: an account Gestión Humana created with a temporary
// password is asked to replace it, sees the policy live, and continues into the normal sign-in with the new one.
const React = require('react');
const renderer = require('react-test-renderer');

const mockLogin = jest.fn();
const mockChange = jest.fn();
const mockReplace = jest.fn();

jest.mock('expo-router', () => ({
  router: { push: jest.fn(), replace: (...args) => mockReplace(...args) },
  useLocalSearchParams: () => ({}),
}));
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
jest.mock('../src/utils/pending-evidence', () => ({ loginPendingEvidenceNotice: () => '' }));
jest.mock('../src/utils/app-exit', () => ({ exitApplication: jest.fn() }));
jest.mock('../src/services/mobile-auth', () => {
  class MobileServiceError extends Error {
    constructor(code) {
      super(code);
      this.code = code;
    }
  }
  return {
    MobileServiceError,
    getMobileSession: jest.fn(async () => null),
    readUnsentRecords: jest.fn(async () => null),
    loginMobileAgent: (...args) => mockLogin(...args),
    changeTemporaryPassword: (...args) => mockChange(...args),
  };
});

const { MobileServiceError } = require('../src/services/mobile-auth');
const LoginScreen = require('../src/app/index').default;

const email = 'nuevo.agente@aviam.test';
const temporary = 'Temporal-Clave-2026!';
const next = 'Nueva-Clave-Segura-26';

function text(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}
const input = (tree, label) => tree.root.find(node => node.type === 'TextInput' && node.props.accessibilityLabel === label);
const inputs = (tree, label) => tree.root.findAll(node => node.type === 'TextInput' && node.props.accessibilityLabel === label);
const button = (tree, title) => tree.root.find(node => node.props?.title === title && typeof node.props.onPress === 'function');
const rule = (tree, id) => tree.root.find(node => node.props?.testID === `password-rule-${id}` && node.props.accessible);

async function type(tree, label, value) {
  await renderer.act(async () => { input(tree, label).props.onChangeText(value); });
}
async function press(tree, title) {
  await renderer.act(async () => { button(tree, title).props.onPress(); });
}

async function reachPasswordChange() {
  mockLogin.mockRejectedValueOnce(new MobileServiceError('password_change_required'));
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(LoginScreen)); });
  await type(tree, 'Correo de la cuenta AVIAM', ` ${email} `);
  await type(tree, 'Contraseña de la cuenta AVIAM', temporary);
  await press(tree, 'INICIAR SESIÓN');
  return tree;
}

async function fillNew(tree, value = next, confirmation = value) {
  await type(tree, 'Nueva contraseña', value);
  await type(tree, 'Confirmar nueva contraseña', confirmation);
}

beforeEach(() => { jest.clearAllMocks(); });

test('a temporary password opens the change form with the temporary password prefilled and hidden', async () => {
  const tree = await reachPasswordChange();
  expect(mockLogin).toHaveBeenCalledWith(email, temporary, expect.anything());
  expect(text(tree)).toContain('Cambia tu contraseña temporal');
  expect(text(tree)).toContain(email);
  expect(text(tree)).not.toContain('No pudimos iniciar sesión');
  expect(inputs(tree, 'Contraseña de la cuenta AVIAM')).toHaveLength(0);
  const current = input(tree, 'Contraseña temporal');
  expect(current.props.value).toBe(temporary);
  expect(current.props.secureTextEntry).toBe(true);
  expect(input(tree, 'Nueva contraseña').props.secureTextEntry).toBe(true);
  expect(rule(tree, 'length').props.accessibilityLabel).toContain('pendiente');
  await renderer.act(async () => tree.unmount());
});

test('the policy checklist follows what the agent types and the toggle shows or hides every field', async () => {
  const tree = await reachPasswordChange();
  await type(tree, 'Nueva contraseña', 'abc');
  expect(rule(tree, 'lower').props.accessibilityLabel).toContain('cumplido');
  expect(rule(tree, 'upper').props.accessibilityLabel).toContain('pendiente');
  await type(tree, 'Nueva contraseña', next);
  for (const id of ['length', 'upper', 'lower', 'digit', 'symbol', 'different']) {
    expect(rule(tree, id).props.accessibilityLabel).toContain('cumplido');
  }
  await type(tree, 'Nueva contraseña', temporary);
  expect(rule(tree, 'different').props.accessibilityLabel).toContain('pendiente');

  await renderer.act(async () => {
    tree.root.find(node => node.props?.accessibilityLabel === 'Mostrar contraseñas' && node.props.onPress).props.onPress();
  });
  expect(input(tree, 'Contraseña temporal').props.secureTextEntry).toBe(false);
  expect(input(tree, 'Confirmar nueva contraseña').props.secureTextEntry).toBe(false);
  await renderer.act(async () => tree.unmount());
});

test('a password outside the policy or a different confirmation never reaches ELEVANT', async () => {
  const tree = await reachPasswordChange();
  await fillNew(tree, 'corta1!A');
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(text(tree)).toContain('todavía no cumple todos los requisitos');
  await fillNew(tree, next, `${next}x`);
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(text(tree)).toContain('La confirmación no coincide con la nueva contraseña.');
  expect(mockChange).not.toHaveBeenCalled();
  await renderer.act(async () => tree.unmount());
});

test('204 signs in with the new password and continues to the home screen', async () => {
  const tree = await reachPasswordChange();
  mockChange.mockResolvedValueOnce(undefined);
  mockLogin.mockResolvedValueOnce({});
  await fillNew(tree);
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(mockChange).toHaveBeenCalledWith(email, temporary, next, expect.objectContaining({ signal: expect.anything() }));
  expect(mockLogin).toHaveBeenLastCalledWith(email, next, expect.objectContaining({ signal: expect.anything() }));
  expect(mockReplace).toHaveBeenCalledWith('/home');
  await renderer.act(async () => tree.unmount());
});

test('while the change is in flight the form is busy and cannot be sent twice', async () => {
  const tree = await reachPasswordChange();
  let resolve;
  mockChange.mockReturnValueOnce(new Promise(done => { resolve = done; }));
  mockLogin.mockResolvedValueOnce({});
  await fillNew(tree);
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(button(tree, 'CAMBIANDO…').props.disabled).toBe(true);
  expect(input(tree, 'Nueva contraseña').props.editable).toBe(false);
  await press(tree, 'CAMBIANDO…');
  expect(mockChange).toHaveBeenCalledTimes(1);
  await renderer.act(async () => { resolve(); });
  expect(mockReplace).toHaveBeenCalledWith('/home');
  await renderer.act(async () => tree.unmount());
});

test.each([
  ['password_policy_rejected', 'La nueva contraseña no cumple la política: mínimo 14 caracteres'],
  ['current_password_invalid', 'La contraseña temporal no es válida.'],
  ['rate_limited', 'Demasiados intentos. Espera un minuto antes de reintentar.'],
  ['network_unavailable', 'No hay conexión con la red privada de ELEVANT.'],
  ['request_timeout', 'ELEVANT tardó demasiado en responder.'],
])('%s keeps the form open and explains it', async (code, message) => {
  const tree = await reachPasswordChange();
  mockChange.mockRejectedValueOnce(new MobileServiceError(code));
  await fillNew(tree);
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(text(tree)).toContain(message);
  expect(text(tree)).toContain('Cambia tu contraseña temporal');
  expect(button(tree, 'CAMBIAR CONTRASEÑA').props.disabled).toBe(false);
  expect(mockLogin).toHaveBeenCalledTimes(1);
  expect(mockReplace).not.toHaveBeenCalled();
  await renderer.act(async () => tree.unmount());
});

test('if the sign-in after the change fails the agent is back at sign-in, told to use the new password', async () => {
  const tree = await reachPasswordChange();
  mockChange.mockResolvedValueOnce(undefined);
  mockLogin.mockRejectedValueOnce(new MobileServiceError('device_in_use'));
  await fillNew(tree);
  await press(tree, 'CAMBIAR CONTRASEÑA');
  expect(text(tree)).toContain('Tu contraseña se cambió, pero no pudimos iniciar sesión.');
  expect(text(tree)).toContain('Otro agente está usando esta tablet');
  expect(input(tree, 'Correo de la cuenta AVIAM').props.value).toBe(email);
  expect(input(tree, 'Contraseña de la cuenta AVIAM').props.value).toBe('');
  expect(mockReplace).not.toHaveBeenCalled();
  await renderer.act(async () => tree.unmount());
});

test('VOLVER returns to sign-in without the temporary password', async () => {
  const tree = await reachPasswordChange();
  await press(tree, 'VOLVER');
  expect(text(tree)).toContain('Acceso operativo');
  expect(input(tree, 'Contraseña de la cuenta AVIAM').props.value).toBe('');
  await renderer.act(async () => tree.unmount());
});

test('a too-many-attempts sign-in is explained instead of the generic failure', async () => {
  mockLogin.mockRejectedValueOnce(new MobileServiceError('rate_limited'));
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(LoginScreen)); });
  await type(tree, 'Correo de la cuenta AVIAM', email);
  await type(tree, 'Contraseña de la cuenta AVIAM', temporary);
  await press(tree, 'INICIAR SESIÓN');
  expect(text(tree)).toContain('Demasiados intentos. Espera un minuto antes de reintentar.');
  await renderer.act(async () => tree.unmount());
});
