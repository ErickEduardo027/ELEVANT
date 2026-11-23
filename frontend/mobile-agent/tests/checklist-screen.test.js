// «Checklist operativo» (N5): the answers marked after the session ended stay on the tablet for the account that opened
// the checklist, and the screen shows them again once that account signs in. N6: the screen says that the session
// ended instead of blaming the device, never leaves on its own (D-N6: ENTRAR DE NUEVO), saves the answers again before
// sending them and tells a storage failure from a session that ended. The screen, its services, the storage and the
// session service are real; ELEVANT is a small fake, as in ramp-operation-checklist-draft.test.js.
// N12 (D-N12): each control carries one number, the PDF's, and no internal code; the summary reads «Versión 1» and
// keeps the template's code as a small secondary text.
// N13 (D-N13): the summary is headed «CHECKLIST OPERATIVO», and what the screen says when a send or a read goes wrong
// is plain, with tú: no «comando», «canónico» nor «fuente de verdad».
const React = require('react');
const renderer = require('react-test-renderer');
const { StyleSheet } = require('react-native');

const mockAsyncData = new Map();
const mockSecureData = new Map();
let mockUuidCounter = 0;
/** How many of the next writes of a checklist draft fail, as on a tablet whose storage fails (N6). */
let mockDraftWriteFailures = 0;
/** Every write of a checklist draft, failed or not. */
const mockDraftWrites = [];

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getAllKeys: jest.fn(async () => [...mockAsyncData.keys()]),
    getItem: jest.fn(async key => mockAsyncData.get(key) ?? null),
    setItem: jest.fn(async (key, value) => {
      if (key.startsWith('elevant:mobile:ramp-checklist-draft:v1:')) {
        mockDraftWrites.push(key);
        if (mockDraftWriteFailures > 0) {
          mockDraftWriteFailures -= 1;
          throw new Error('The device storage failed.');
        }
      }
      mockAsyncData.set(key, value);
    }),
    removeItem: jest.fn(async key => { mockAsyncData.delete(key); }),
    multiRemove: jest.fn(async keys => { keys.forEach(key => mockAsyncData.delete(key)); }),
  },
}));
jest.mock('expo-secure-store', () => ({
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
  isAvailableAsync: jest.fn(async () => true),
  getItemAsync: jest.fn(async key => mockSecureData.get(key) ?? null),
  setItemAsync: jest.fn(async (key, value) => { mockSecureData.set(key, value); }),
  deleteItemAsync: jest.fn(async key => { mockSecureData.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: jest.fn(() => {
    mockUuidCounter += 1;
    return `10000000-0000-4000-8000-${String(mockUuidCounter).padStart(12, '0')}`;
  }),
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ kind = 'http', status, code }) {
      super(`API ${status}`);
      this.kind = kind;
      this.status = status;
      this.code = code;
    }
  },
  SessionPortal: { ramp_mobile_app: 'ramp_mobile_app' },
  SessionOrganizationType: { aviam_operator: 'aviam_operator' },
  SessionMembershipKind: { internal_staff: 'internal_staff' },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(options => mockElevant.client(options ?? {})),
  isMobileAgentNetworkError: jest.fn(error => error?.mockNetwork === true),
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
}));
jest.mock('expo-router', () => {
  // Inside the root layout, the stack shows the checklist (N6).
  const Stack = () => require('react').createElement(require('../src/app/checklist/[id]').default);
  Stack.Screen = () => null;
  return {
    Stack,
    router: { back: jest.fn(), canDismiss: jest.fn(() => true), dismissAll: jest.fn(), push: jest.fn(), replace: jest.fn() },
    usePathname: () => '/checklist/70000000-0000-4000-8000-000000000001',
    useLocalSearchParams: () => ({ id: '70000000-0000-4000-8000-000000000001' }),
    useFocusEffect: callback => require('react').useEffect(callback, [callback]),
  };
});
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('react-native-safe-area-context', () => ({ SafeAreaView: require('react-native').View }));
// The root layout's background work is not under test here.
jest.mock('expo-status-bar', () => ({ StatusBar: () => null }));
jest.mock('../src/services/mobile-presence', () => ({
  startMobilePresence: jest.fn(), stopMobilePresence: jest.fn(), refreshMobilePresenceSession: jest.fn(async () => {}),
  recordMobilePresenceActivity: jest.fn(),
}));
jest.mock('../src/services/mobile-change-feed', () => ({ startMobileChangeFeed: jest.fn(), stopMobileChangeFeed: jest.fn() }));
jest.mock('../src/components/flight-report/connection-badge', () => ({ startFlightReportSync: jest.fn(() => () => {}) }));

const { router } = require('expo-router');
const { ElevantApiError } = require('@elevant/api-client');
const { loginMobileAgent, resetMobileSessionRenewalForTests } = require('../src/services/mobile-auth');
const { MobileServiceError } = require('../src/services/mobile-service-error');
const { forgetConfirmedMobileDevice } = require('../src/services/mobile-device');
const { getOwnCoverage } = require('../src/services/ramp-coverage');
const { flushFlightReport, resetFlightReportForTests } = require('../src/services/flight-report');
const checklistService = require('../src/services/ramp-operation-checklist');
const { resetServerClockForTests } = require('../src/synchronization/server-clock');
const ChecklistScreen = require('../src/app/checklist/[id]').default;
const RootLayout = require('../src/app/_layout').default;

const ACCOUNT = '40000000-0000-4000-8000-000000000002';
const OPERATION = '70000000-0000-4000-8000-000000000001';
const CHECKLIST = '71000000-0000-4000-8000-000000000001';
const range = (from, to) => Array.from({ length: to - from + 1 }, (_, index) => from + index);

const actor = {
  accountId: ACCOUNT,
  email: 'ramp.agent@dev.elevant.test',
  displayName: 'Riley Ramp',
  roles: [{ roleId: '41000000-0000-4000-8000-000000000002', code: 'RAMP_AGENT', name: 'Agente de rampa',
    portal: 'ramp_mobile_app', userType: 'ramp_agent' }],
  memberships: [{ membershipId: '42000000-0000-4000-8000-000000000002',
    organizationId: '10000000-0000-4000-8000-000000000001', organizationCode: 'AVIAM', organizationName: 'AVIAM',
    organizationType: 'aviam_operator', kind: 'internal_staff' }],
  stationScopes: [{ stationId: '20000000-0000-4000-8000-000000000003', stationCode: 'PUJ' }],
};

/** AVIAM's checklist: 21 controls in three sections of seven, none answered on ELEVANT yet. */
const checklist = {
  operationId: OPERATION,
  checklist: {
    id: CHECKLIST, status: 'InProgress', startedAt: '2026-11-16T19:40:00.000Z', submittedAt: null,
    template: { code: 'RAMP-AC', name: 'Checklist operativo', version: 1 },
    sections: [0, 1, 2].map(section => ({
      name: `Sección ${section + 1}`,
      items: range(section * 7 + 1, section * 7 + 7).map(number => ({
        id: `72000000-0000-4000-8000-${String(number).padStart(12, '0')}`, code: `RAMP-${number}`,
        label: `Control ${number}`, sortOrder: number, isRequired: true, requiresNoteWhenNotOk: false,
      })),
    })),
  },
};

const base64Url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
const jwt = claims => `${base64Url({ alg: 'HS256', typ: 'at+jwt' })}.${base64Url(claims)}.c2lnbmF0dXJl`;

/**
 * ELEVANT's session endpoints (ADR-0021, ADR-0046) and the operation's checklist; OCC can revoke the tablet, and the
 * account can lose its access to the app (403).
 */
const mockElevant = {
  reset() {
    Object.assign(this, { accepted: new Set(), families: [], sequence: 0, forbidden: false, submissions: [] });
  },
  nextRefreshToken() {
    this.sequence += 1;
    return `refresh-${String(this.sequence).padStart(3, '0')}-${'r'.repeat(32)}`;
  },
  issue(family) {
    this.sequence += 1;
    const now = Math.floor(Date.now() / 1000);
    const accessToken = jwt({ sub: ACCOUNT, jti: `jti-${this.sequence}`, iat: now, exp: now + 900,
      auth_time: family.startedAt });
    this.accepted.add(accessToken);
    return {
      accessToken, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(), actor,
      refreshToken: family.current, refreshExpiresAt: new Date(Date.now() + 30 * 24 * 60 * 60_000).toISOString(),
    };
  },
  /** OCC revokes the tablet: ELEVANT refuses the access token at once, and its renewal as well (401). */
  revoke() {
    this.accepted.clear();
    this.families.forEach(family => { family.revoked = true; });
  },
  client(options) {
    const authorized = async () => {
      if (!this.accepted.has(await options.getAccessToken?.())) throw new ElevantApiError({ status: 401 });
      // The account no longer qualifies for the app: ELEVANT answers 403 to whatever it asks.
      if (this.forbidden) throw new ElevantApiError({ status: 403 });
    };
    return {
      createSession: async () => {
        const family = { startedAt: Math.floor(Date.now() / 1000), current: this.nextRefreshToken(), revoked: false };
        this.families.push(family);
        return this.issue(family);
      },
      getCurrentSession: async () => {
        await authorized();
        return { actor };
      },
      registerMobileDevice: async request => {
        await authorized();
        return { installationId: request.installationId, platform: request.platform, appVersion: '1.0.0',
          lastSeenAt: new Date().toISOString() };
      },
      refreshSession: async refreshToken => {
        const family = this.families.find(candidate => candidate.current === refreshToken);
        if (!family || family.revoked) throw new ElevantApiError({ status: 401 });
        family.current = this.nextRefreshToken();
        return this.issue(family);
      },
      getOwnRampCoverage: async () => {
        await authorized();
        return { coverages: [] };
      },
      getRampOperationChecklist: async () => {
        await authorized();
        return checklist;
      },
      submitRampOperationChecklist: async (_operationId, body) => {
        await authorized();
        this.submissions.push(body);
        return { receiptId: '73000000-0000-4000-8000-000000000001', checklist: { id: CHECKLIST, status: 'Submitted',
          startedAt: '2026-11-16T19:40:00.000Z', submittedAt: new Date().toISOString(),
          answerCount: body.answers.length } };
      },
    };
  },
};

/** Lets the screen's work finish: the draft is saved 250 ms after the last answer. */
const settle = (milliseconds = 50) =>
  renderer.act(() => new Promise(resolve => { setTimeout(resolve, milliseconds); }));

async function mount(screen = ChecklistScreen) {
  let tree;
  await renderer.act(async () => { tree = renderer.create(React.createElement(screen)); });
  await settle();
  return tree;
}

/** The checklist as the tablet shows it: inside the root layout, with its global session notice (N6). */
const mountInLayout = () => mount(RootLayout);

/** How many times `text` shows on the screen. */
const occurrences = (tree, text) => screenText(tree).split(text).length - 1;

/** The regions TalkBack reads out at once. */
const assertiveRegions = tree => tree.root.findAll(node =>
  typeof node.type === 'string' && node.props.accessibilityLiveRegion === 'assertive');

/** The answer choice `label` of control `number` (OK, N/A or NO). */
const choice = (tree, number, label) => tree.root.findAll(node => node.props?.label === label &&
  node.props?.context === `Control ${number}` && typeof node.props.onPress === 'function')[0];

async function answerOk(tree, numbers) {
  for (const number of numbers) {
    const ok = choice(tree, number, 'OK');
    await renderer.act(async () => { ok.props.onPress(); });
  }
}

/** The 21 controls, section by section: the screen ends on the last section, where ENVIAR CHECKLIST is. */
async function answerAll(tree) {
  await answerOk(tree, range(1, 7));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(8, 14));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(15, 21));
}

const button = (tree, title) =>
  tree.root.findAll(node => node.props?.title === title && typeof node.props.onPress === 'function')[0];

async function press(tree, title) {
  const target = button(tree, title);
  await renderer.act(async () => { target.props.onPress(); });
}

const progress = tree =>
  tree.root.findAll(node => node.props?.accessibilityRole === 'progressbar')[0].props.accessibilityLabel;

/** Another request finds out that ELEVANT refused the session (S3); the open screen hears the end (N6). */
const endTheSessionWhileTheScreenIsOpen = () => renderer.act(async () => {
  await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });
});

/** The text the screen shows, button titles included. */
function screenText(tree) {
  const collect = node => node == null ? [] : typeof node === 'string' ? [node]
    : Array.isArray(node) ? node.flatMap(collect) : collect(node.children);
  return collect(tree.toJSON()).join(' ');
}

/** The badge of the summary card. */
const badge = tree => tree.root.findAll(node => typeof node.props?.text === 'string' && 'tone' in node.props)[0].props;

/**
 * What the old screen blamed instead of the session, and the jargon it showed (N6): also «comando», «canónico» and
 * «fuente de verdad», which a ramp agent never needs to read (N13).
 */
const BLAMES_THE_DEVICE = /Desbloque|proteger|payload|canónic|comando|fuente de verdad/i;

/** The texts of each control card of the section on screen, in order: its number comes first (N12). */
const controlTexts = tree => tree.root
  .findAll(node => typeof node.type === 'function' && node.props.item !== undefined &&
    typeof node.props.onChange === 'function')
  .map(card => card.findAll(node => node.type === 'Text').map(node => [].concat(node.props.children).join('')));
const textNode = (tree, value) => tree.root.findAll(node => node.type === 'Text' && node.props.children === value)[0];
const styleOf = node => StyleSheet.flatten(node.props.style) ?? {};
const weight = value => ({ normal: 400, bold: 700 })[value] ?? Number(value ?? 400);

beforeEach(() => {
  jest.clearAllMocks();
  mockAsyncData.clear();
  mockSecureData.clear();
  mockUuidCounter = 0;
  mockDraftWriteFailures = 0;
  mockDraftWrites.length = 0;
  mockElevant.reset();
  resetServerClockForTests();
  resetMobileSessionRenewalForTests();
  resetFlightReportForTests();
  forgetConfirmedMobileDevice();
});

test('the answers marked after the session ended come back, 21 of 21, when the agent signs in again', async () => {
  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
  let tree = await mount();
  expect(progress(tree)).toBe('0 de 21 controles respondidos');

  await answerOk(tree, range(1, 7));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(8, 10));
  await settle(400);

  // OCC revokes the tablet and another request finds out: ELEVANT refuses the renewal and the session ends (S3).
  mockElevant.revoke();
  await endTheSessionWhileTheScreenIsOpen();

  // The agent goes on with the checklist: 11 more answers after the end of the session.
  await answerOk(tree, range(11, 14));
  await press(tree, 'SIGUIENTE');
  await answerOk(tree, range(15, 21));
  expect(progress(tree)).toBe('21 de 21 controles respondidos');
  // Leaving the screen saves what was still waiting.
  await renderer.act(async () => { tree.unmount(); });
  await settle(100);

  await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
  tree = await mount();
  expect(progress(tree)).toBe('21 de 21 controles respondidos');
  await renderer.act(async () => { tree.unmount(); });
}, 30_000);

describe('the screen says that the session ended (N6)', () => {
  test('the moment the session ends the screen says so, keeps what the agent marks and offers ENTRAR DE NUEVO', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    await answerOk(tree, range(1, 7));
    await press(tree, 'SIGUIENTE');
    await answerOk(tree, range(8, 10));
    await settle(400);
    expect(badge(tree)).toEqual({ text: 'Borrador', tone: 'blue' });

    // OCC revokes the tablet and another request finds out (S3): the screen hears the end at once.
    mockElevant.revoke();
    await endTheSessionWhileTheScreenIsOpen();
    await settle();
    expect(badge(tree)).toEqual({ text: 'Sesión terminada', tone: 'red' });
    expect(screenText(tree)).toContain('Tu sesión terminó');
    expect(screenText(tree)).toContain('Tus respuestas quedaron guardadas en esta tablet.');

    // What the agent marks afterwards is kept for its account (N5), and nothing blames the device.
    await answerOk(tree, range(11, 14));
    await settle(400);
    expect(screenText(tree)).toContain('Borrador guardado en este dispositivo');
    expect(screenText(tree)).toContain('Tus respuestas quedaron guardadas en esta tablet.');
    expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);

    // The screen never leaves on its own (D-N6): the agent decides when to sign in again.
    expect(router.replace).not.toHaveBeenCalled();
    await press(tree, 'ENTRAR DE NUEVO');
    expect(router.dismissAll).toHaveBeenCalled();
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'session_expired' } });
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('ENVIAR after OCC revoked the session: the screen stays and the checklist goes out once the agent signs in', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    await answerAll(tree);
    await settle(400);

    // OCC revoked the tablet; the screen finds out when the agent sends.
    mockElevant.revoke();
    await press(tree, 'ENVIAR CHECKLIST');
    await settle(100);

    expect(router.replace).not.toHaveBeenCalled();
    expect(badge(tree)).toEqual({ text: 'Sesión terminada', tone: 'red' });
    expect(screenText(tree)).toContain('Tu sesión terminó');
    expect(screenText(tree)).toContain('Tus respuestas quedaron guardadas en esta tablet.');
    // ENVIAR no longer repeats a notice: without a session it is off, and ENTRAR DE NUEVO is the way on.
    expect(button(tree, 'ENVIAR CHECKLIST').props.disabled).toBe(true);
    expect(button(tree, 'ENTRAR DE NUEVO')).toBeDefined();
    expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
    expect(mockElevant.submissions).toHaveLength(0);
    // The submission waits in the queue with these answers: they stay as they were sent.
    expect(choice(tree, 21, 'NO').props.disabled).toBe(true);
    await renderer.act(async () => { tree.unmount(); });

    // The checklist waits in the tablet's queue for the same account, which sends it after signing in.
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    await flushFlightReport();
    expect(mockElevant.submissions).toHaveLength(1);
    expect(mockElevant.submissions[0].answers).toHaveLength(21);
  }, 30_000);

  test('an account that lost its access: the screen says so and ENTRAR DE NUEVO explains it on the access screen', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    await answerAll(tree);
    await settle(400);

    mockElevant.forbidden = true;
    await press(tree, 'ENVIAR CHECKLIST');
    await settle(100);

    expect(router.replace).not.toHaveBeenCalled();
    expect(badge(tree)).toEqual({ text: 'Sesión terminada', tone: 'red' });
    expect(screenText(tree)).toContain('Tu cuenta ya no tiene acceso a la aplicación de rampa');
    expect(screenText(tree)).toContain('Tus respuestas quedaron guardadas en esta tablet.');
    expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
    await press(tree, 'ENTRAR DE NUEVO');
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'access_revoked' } });
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('opening the checklist after the session ended shows ENTRAR DE NUEVO instead of leaving the screen', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    mockElevant.revoke();
    await expect(getOwnCoverage()).rejects.toMatchObject({ code: 'unauthenticated' });

    const tree = await mount();
    expect(router.replace).not.toHaveBeenCalled();
    expect(screenText(tree)).toContain('Tu sesión terminó');
    await press(tree, 'ENTRAR DE NUEVO');
    expect(router.replace).toHaveBeenCalledWith({ pathname: '/', params: { notice: 'session_expired' } });
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);
});

describe('a draft the tablet could not save (N6)', () => {
  test('ENVIAR saves the answers again, waits for it and sends them, instead of repeating a notice', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    await answerOk(tree, range(1, 7));
    await press(tree, 'SIGUIENTE');
    await answerOk(tree, range(8, 14));
    await press(tree, 'SIGUIENTE');
    await answerOk(tree, range(15, 20));
    await settle(400);

    // The device's storage fails once: the last answer is not saved, and the screen says so without blaming the lock.
    mockDraftWriteFailures = 1;
    await answerOk(tree, [21]);
    await settle(400);
    expect(screenText(tree)).toContain('No se pudo guardar el borrador en este dispositivo');
    expect(screenText(tree)).toContain('No se guardaron tus respuestas');
    expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);

    // The storage works again: ENVIAR saves the 21 answers once more and only then sends them.
    const writes = mockDraftWrites.length;
    await press(tree, 'ENVIAR CHECKLIST');
    await settle(100);
    expect(mockDraftWrites).toHaveLength(writes + 1);
    expect(mockElevant.submissions).toHaveLength(1);
    expect(mockElevant.submissions[0].answers).toHaveLength(21);
    expect(screenText(tree)).toContain('Checklist enviado');
    expect(screenText(tree)).not.toContain('No se guardaron tus respuestas');
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('REINTENTAR GUARDADO tries once per tap, never on its own, and then says what to do', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    mockDraftWriteFailures = 2;
    await answerOk(tree, [1]);
    await settle(400);
    expect(screenText(tree)).toContain('No se guardaron tus respuestas');
    expect(screenText(tree)).toContain('Toca REINTENTAR GUARDADO.');

    await press(tree, 'REINTENTAR GUARDADO');
    await settle(100);
    expect(screenText(tree)).toContain('Cierra la app, ábrela de nuevo y avisa a OCC.');
    // Nothing retries on its own: one write per tap.
    await settle(600);
    expect(mockDraftWrites).toHaveLength(2);

    await press(tree, 'REINTENTAR GUARDADO');
    await settle(100);
    expect(mockDraftWrites).toHaveLength(3);
    expect(screenText(tree)).toContain('Borrador guardado en este dispositivo');
    expect(button(tree, 'REINTENTAR GUARDADO')).toBeUndefined();
    expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('a save cancelled under the screen is tried once more for the same account, never an endless «Guardando…»', async () => {
    const save = jest.spyOn(checklistService, 'saveRampOperationChecklistDraft');
    try {
      await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
      const tree = await mount();

      save.mockRejectedValueOnce(new MobileServiceError('cancelled'));
      await answerOk(tree, [1]);
      await settle(400);
      expect(save).toHaveBeenCalledTimes(2);
      expect(save.mock.calls.map(call => call[2])).toEqual([ACCOUNT, ACCOUNT]);
      expect(screenText(tree)).toContain('Borrador guardado en este dispositivo');

      // Cancelled twice: the screen stops waiting and offers to save again.
      save.mockRejectedValueOnce(new MobileServiceError('cancelled'))
        .mockRejectedValueOnce(new MobileServiceError('cancelled'));
      await answerOk(tree, [2]);
      await settle(400);
      expect(screenText(tree)).not.toContain('Guardando borrador');
      expect(button(tree, 'REINTENTAR GUARDADO')).toBeDefined();
      expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
      await renderer.act(async () => { tree.unmount(); });
    } finally {
      save.mockRestore();
    }
  }, 30_000);
});

describe('one numbering and the code in the background (N12, D-N12)', () => {
  test('each control carries the number of its code, 8 to 14 in the second section, and no internal code', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    expect(controlTexts(tree).map(texts => texts.slice(0, 2)))
      .toEqual(range(1, 7).map(number => [String(number), `Control ${number}`]));

    await answerOk(tree, range(1, 7));
    await press(tree, 'SIGUIENTE');
    // One numbering, as in the PDF: the second section goes on from 8 instead of starting again at 1.
    expect(controlTexts(tree).map(texts => texts.slice(0, 2)))
      .toEqual(range(8, 14).map(number => [String(number), `Control ${number}`]));
    expect(screenText(tree)).not.toMatch(/RAMP-\d/);
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('the summary reads «Versión 1» and keeps the template code as a small secondary text', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    const version = textNode(tree, 'Versión 1');
    const code = textNode(tree, 'RAMP-AC');
    expect(version).toBeDefined();
    expect(code).toBeDefined();
    expect(screenText(tree)).not.toContain('· versión');
    expect(styleOf(code).fontSize).toBeLessThanOrEqual(styleOf(version).fontSize);
    expect(weight(styleOf(code).fontWeight)).toBeLessThan(weight(styleOf(version).fontWeight));
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);
});

describe('inside the app, the checklist shows one session notice (N6)', () => {
  test('one notice, one ENTRAR DE NUEVO and one announcement, never saying that answers it did not keep were kept', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mountInLayout();
    await answerOk(tree, range(1, 3));
    await settle(400);

    mockElevant.revoke();
    await endTheSessionWhileTheScreenIsOpen();
    await settle();
    expect(occurrences(tree, 'Tu sesión terminó')).toBe(1);
    expect(tree.root.findAll(node => node.props?.title === 'ENTRAR DE NUEVO' &&
      typeof node.props.onPress === 'function')).toHaveLength(1);
    expect(assertiveRegions(tree)).toHaveLength(1);

    // The tablet cannot save the next answer: the screen says so, and nothing on it claims that it was kept.
    mockDraftWriteFailures = 1;
    await answerOk(tree, [4]);
    await settle(400);
    expect(screenText(tree)).toContain('Las últimas respuestas no se pudieron guardar en esta tablet.');
    expect(screenText(tree)).not.toContain('Lo que registraste queda guardado en esta tablet.');
    expect(occurrences(tree, 'Tu sesión terminó')).toBe(1);
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('a checklist already sent shows no notice of its own, so the layout’s notice stays', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mountInLayout();
    await answerAll(tree);
    await settle(400);
    await press(tree, 'ENVIAR CHECKLIST');
    await settle(100);
    expect(screenText(tree)).toContain('Checklist enviado');

    mockElevant.revoke();
    await endTheSessionWhileTheScreenIsOpen();
    await settle();
    expect(occurrences(tree, 'Tu sesión terminó')).toBe(1);
    expect(screenText(tree)).toContain('Lo que registraste queda guardado en esta tablet.');
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);
});

// N13 (D-N13): a review of the PR 1 found the internal jargon still on screen («comando reservado», «estado canónico»,
// «fuente de verdad», «Comando local pendiente de verificación»). The screen says the same in plain words, with tú.
describe('plain words when a send or a read goes wrong (N13, D-N13)', () => {
  test('the summary is headed «CHECKLIST OPERATIVO», the name the operation screen gives it', async () => {
    await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
    const tree = await mount();
    expect(screenText(tree)).toContain('CHECKLIST OPERATIVO');
    expect(screenText(tree)).not.toContain('CONTROL OPERACIONAL');
    await renderer.act(async () => { tree.unmount(); });
  }, 30_000);

  test('a send ELEVANT did not confirm, whose copy the tablet cannot read back, asks to update before editing', async () => {
    const submit = jest.spyOn(checklistService, 'submitRampOperationChecklist');
    const readPending = jest.spyOn(checklistService, 'readRampChecklistPendingSubmission');
    try {
      await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
      const tree = await mount();
      await answerAll(tree);
      await settle(400);
      submit.mockRejectedValueOnce(new MobileServiceError('request_failed'));
      readPending.mockRejectedValueOnce(new Error('The device storage failed.'));
      await press(tree, 'ENVIAR CHECKLIST');
      await settle(100);

      expect(screenText(tree)).toContain('No pudimos confirmar el envío guardado en esta tablet. Actualiza antes de ' +
        'seguir editando.');
      expect(badge(tree)).toEqual({ text: 'Envío por confirmar', tone: 'orange' });
      expect(button(tree, 'ACTUALIZAR')).toBeDefined();
      expect(choice(tree, 21, 'NO').props.disabled).toBe(true);
      expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);

      // ACTUALIZAR reads the checklist and the tablet's copy again; with both read, the agent edits again.
      await press(tree, 'ACTUALIZAR');
      await settle(100);
      expect(button(tree, 'ENVIAR CHECKLIST')).toBeDefined();
      expect(choice(tree, 21, 'NO').props.disabled).toBe(false);
      await renderer.act(async () => { tree.unmount(); });
    } finally {
      submit.mockRestore();
      readPending.mockRestore();
    }
  }, 30_000);

  test.each([
    ['without a code', new MobileServiceError('conflict'), ''],
    ['with the code ELEVANT explains', new MobileServiceError('conflict', { problemCode: 'ramp_operation_state_conflict' }),
      'La operación ya no admite este registro: está entregada, aprobada o en otro estado. '],
  ])('a send ELEVANT refused because the checklist changed (%s) says it reads the checklist again', async (_d, error,
    cause) => {
    const submit = jest.spyOn(checklistService, 'submitRampOperationChecklist').mockRejectedValueOnce(error);
    try {
      await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
      const tree = await mount();
      await answerAll(tree);
      await settle(400);
      await press(tree, 'ENVIAR CHECKLIST');
      await settle(100);
      expect(screenText(tree)).toContain('El checklist cambió');
      expect(screenText(tree)).toContain(`${cause}Volvemos a leer el checklist en ELEVANT antes de permitir otra acción.`);
      expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
      await renderer.act(async () => { tree.unmount(); });
    } finally {
      submit.mockRestore();
    }
  }, 30_000);

  test.each([
    ['without signal nor a copy on the tablet', 'network_unavailable', 'Sin conexión segura',
      'Esta tablet no tiene una copia de este checklist. Reconecta para cargarlo desde ELEVANT.'],
    ['after the operation changed', 'conflict', 'La operación cambió',
      'Vuelve al detalle, actualízalo y abre el checklist de nuevo.'],
  ])('a checklist that cannot open %s says why in plain words', async (_d, code, title, message) => {
    const read = jest.spyOn(checklistService, 'getRampOperationChecklist')
      .mockRejectedValueOnce(new MobileServiceError(code));
    try {
      await loginMobileAgent('ramp.agent@dev.elevant.test', 'Clave-Segura-2026!');
      const tree = await mount();
      expect(screenText(tree)).toContain(title);
      expect(screenText(tree)).toContain(message);
      expect(screenText(tree)).not.toMatch(BLAMES_THE_DEVICE);
      await renderer.act(async () => { tree.unmount(); });
    } finally {
      read.mockRestore();
    }
  }, 30_000);
});
