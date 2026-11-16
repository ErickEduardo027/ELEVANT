const mockStore = new Map();
const mockApi = {
  signRampOperationDocument: jest.fn(),
  recordRampDamageMark: jest.fn(),
  attachRampDamagePhoto: jest.fn(),
  getRampOperationDocuments: jest.fn(),
  addRampCharterService: jest.fn(),
  updateRampCharterDetails: jest.fn(),
};
const mockContext = jest.fn();
const mockRegister = jest.fn();
const mockPhotos = { keep: jest.fn(), read: jest.fn(), forget: jest.fn() };
let mockUuid = 0;

jest.mock('@react-native-async-storage/async-storage', () => ({
  getItem: jest.fn(async key => mockStore.get(key) ?? null),
  setItem: jest.fn(async (key, value) => { mockStore.set(key, value); }),
  removeItem: jest.fn(async key => { mockStore.delete(key); }),
}));
jest.mock('expo-crypto', () => ({
  randomUUID: () => `90000000-0000-4000-8000-${String(++mockUuid).padStart(12, '0')}`,
}));
jest.mock('@elevant/api-client', () => ({
  ElevantApiError: class ElevantApiError extends Error {
    constructor({ status }) { super(`API ${status}`); this.kind = 'http'; this.status = status; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.message === 'offline'),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
}));
jest.mock('../src/services/mobile-auth', () => ({
  getMobileSessionRequestContext: (...args) => mockContext(...args),
  rejectMobileSessionRequest: jest.fn(async () => true),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: (...args) => mockPhotos.keep(...args),
  readWalkaroundPhoto: (...args) => mockPhotos.read(...args),
  forgetWalkaroundPhoto: (...args) => mockPhotos.forget(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { readFlightReportOutbox } = require('../src/synchronization/flight-report-outbox');
const { addCharterService, flushFlightReport, markDamage, saveCharterDetails, signDocument, subscribeFlightReport } = require('../src/services/flight-report');

const accountId = '20000000-0000-4000-8000-000000000001';
const operationId = '70000000-0000-4000-8000-000000000001';
const installationId = '81000000-0000-4000-8000-000000000001';
const sha = 'a'.repeat(64);
const view = { operationId, documents: [], damageMarks: [] };

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: 's1', accessToken: 'token', session: { actor: { accountId } } });
  mockRegister.mockResolvedValue({ installationId });
  mockPhotos.keep.mockImplementation((uri, markId) => `file:///documents/walkaround/${markId}.jpg`);
  mockPhotos.read.mockResolvedValue({ size: 3 });
  for (const method of Object.values(mockApi)) method.mockResolvedValue(view);
});

test('a signature carries the hash the signer saw and is sent with its own key', async () => {
  await signDocument(operationId, 'ServiceOrder', 'AirlineRepresentative', 'Ana Pérez', sha, [[0.1, 0.2, 0.3, 0.4]]);
  await flushFlightReport();
  expect(mockApi.signRampOperationDocument).toHaveBeenCalledWith(operationId, 'ServiceOrder', 'AirlineRepresentative',
    { signerName: 'Ana Pérez', documentSha256: sha, strokes: [[0.1, 0.2, 0.3, 0.4]] }, installationId,
    expect.stringMatching(/^90000000-/));
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
});

test('a damage mark travels before its photo, and the photo file is removed only once confirmed', async () => {
  const markId = await markDamage(operationId, { x: 0.4, y: 0.3, note: ' Abolladura ' },
    { uri: 'file:///cache/camera.jpg', contentType: 'image/jpeg' });
  expect(mockPhotos.keep).toHaveBeenCalledWith('file:///cache/camera.jpg', markId, 'image/jpeg');
  await flushFlightReport();
  expect(mockApi.recordRampDamageMark.mock.invocationCallOrder[0])
    .toBeLessThan(mockApi.attachRampDamagePhoto.mock.invocationCallOrder[0]);
  expect(mockApi.recordRampDamageMark).toHaveBeenCalledWith(operationId, markId,
    expect.objectContaining({ x: 0.4, y: 0.3, note: 'Abolladura' }), installationId, expect.any(String));
  expect(mockApi.attachRampDamagePhoto).toHaveBeenCalledWith(operationId, markId, { size: 3 }, 'image/jpeg', installationId);
  expect(mockPhotos.forget).toHaveBeenCalledWith(`file:///documents/walkaround/${markId}.jpg`);
});

test('a form that changed after signing is held for review, not retried, and the photo waits for storage', async () => {
  mockApi.signRampOperationDocument.mockRejectedValueOnce(new ElevantApiError({ status: 409 }));
  await signDocument(operationId, 'FlightReport', 'Coordinator', 'Riley Ramp', sha, [[0.1, 0.2, 0.3, 0.4]]);
  await flushFlightReport();
  const [held] = await readFlightReportOutbox(accountId);
  expect(held.state).toBe('blocked');

  mockApi.attachRampDamagePhoto.mockRejectedValueOnce(new ElevantApiError({ status: 503 }));
  await markDamage(operationId, { x: 0.5, y: 0.5, note: 'Rayón en la puerta' },
    { uri: 'file:///cache/2.jpg', contentType: 'image/jpeg' });
  await flushFlightReport();
  const items = await readFlightReportOutbox(accountId);
  const photo = items.find(item => item.command.kind === 'damagePhoto');
  expect(photo.state).toBe('pending');
  expect(photo.attempts).toBe(1);
  expect(mockPhotos.forget).not.toHaveBeenCalled();
});

test('the last server view of the forms is kept per operation', async () => {
  const states = [];
  const stop = subscribeFlightReport(state => states.push(state));
  const signed = { ...view, damageMarks: [{ id: '91000000-0000-4000-8000-000000000001', x: 0.1, y: 0.1, note: 'ok',
    reportedAt: '2026-11-04T16:00:00.000Z', hasPhoto: false }] };
  mockApi.recordRampDamageMark.mockResolvedValueOnce(signed);
  await markDamage(operationId, { x: 0.1, y: 0.1, note: 'Golpe leve' });
  await flushFlightReport();
  stop();
  expect(states.at(-1).documents[operationId]).toEqual(signed);
});

test('a charter request signature carries the ID or passport only in the command it sends', async () => {
  await signDocument(operationId, 'CharterServiceRequest', 'AirlineRepresentative', 'Ana Pérez', sha, [[0.1, 0.2, 0.3, 0.4]], 'PA1234567');
  await flushFlightReport();
  expect(mockApi.signRampOperationDocument).toHaveBeenCalledWith(operationId, 'CharterServiceRequest', 'AirlineRepresentative',
    { signerName: 'Ana Pérez', documentSha256: sha, strokes: [[0.1, 0.2, 0.3, 0.4]], signerIdentification: 'PA1234567' },
    installationId, expect.any(String));
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
});

test('charter services and carrier data travel in order and keep the last server view of the charter', async () => {
  const charter = { operationId, charterId: '91000000-0000-4000-8000-000000000001', currencyCode: 'USD', carrierAddress: 'Miami',
    chargesPayableBy: null, prepaymentStatus: 'Pending', prepaymentAmount: null, catalog: [] };
  mockApi.addRampCharterService.mockResolvedValue(charter);
  mockApi.updateRampCharterDetails.mockResolvedValue(charter);
  const serviceId = '30000000-0000-4000-8000-000000000001';
  mockRegister.mockRejectedValue(new Error('offline'));
  await addCharterService(operationId, serviceId, 2);
  await addCharterService(operationId, serviceId, 3);
  await saveCharterDetails(operationId, 'Miami', null);
  expect((await readFlightReportOutbox(accountId)).map(item => item.command.kind)).toEqual(['charterService', 'charterDetails']);
  await flushFlightReport();
  mockRegister.mockResolvedValue({ installationId });
  await flushFlightReport();
  expect(mockApi.addRampCharterService).toHaveBeenCalledWith(operationId, { serviceDefinitionId: serviceId, quantity: 3 },
    installationId, expect.any(String));
  expect(mockApi.addRampCharterService.mock.invocationCallOrder[0])
    .toBeLessThan(mockApi.updateRampCharterDetails.mock.invocationCallOrder[0]);
  let latest;
  subscribeFlightReport(value => { latest = value; })();
  expect(latest.charters[operationId]).toEqual(charter);
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
});
