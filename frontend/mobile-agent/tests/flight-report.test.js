const mockStore = new Map();
const mockApi = { recordRampMilestone: jest.fn(), updateRampFlightData: jest.fn() };
const mockContext = jest.fn();
const mockReject = jest.fn();
const mockRegister = jest.fn();
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
  rejectMobileSessionRequest: (...args) => mockReject(...args),
}));
jest.mock('../src/storage/walkaround-photos', () => ({
  keepWalkaroundPhoto: jest.fn(), readWalkaroundPhoto: jest.fn(), forgetWalkaroundPhoto: jest.fn(),
}));
jest.mock('../src/services/mobile-device', () => ({
  registerCurrentMobileDevice: (...args) => mockRegister(...args),
}));

const { ElevantApiError } = require('@elevant/api-client');
const { enqueueFlightReportCommand, readFlightReportOutbox, pendingFor } = require('../src/synchronization/flight-report-outbox');
const { recordMilestone, saveFlightData, flushFlightReport, subscribeFlightReport } = require('../src/services/flight-report');

const accountId = '20000000-0000-4000-8000-000000000001';
const operationId = '70000000-0000-4000-8000-000000000001';
const response = (milestones = []) => ({ receiptId: '80000000-0000-4000-8000-000000000001', operationId, milestones,
  passengersIn: null, passengersOut: null, mtowKg: null, aircraftRegistration: null });

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  mockContext.mockResolvedValue({ sessionId: 's1', accessToken: 'token', session: { actor: { accountId } } });
  mockRegister.mockResolvedValue({ installationId: '81000000-0000-4000-8000-000000000001' });
  mockReject.mockResolvedValue(true);
});

test('keeps only the last unsent tap of a milestone and the newest flight data', async () => {
  const command = code => ({ kind: 'milestone', operationId, code, occurredAt: '2026-11-04T16:00:00.000Z' });
  await enqueueFlightReportCommand(accountId, command('BLOCK_ON'), '90000000-0000-4000-8000-0000000000a1');
  await enqueueFlightReportCommand(accountId, { ...command('BLOCK_ON'), occurredAt: '2026-11-04T16:02:00.000Z' },
    '90000000-0000-4000-8000-0000000000a2');
  await enqueueFlightReportCommand(accountId, command('PUSHBACK'), '90000000-0000-4000-8000-0000000000a3');
  const items = await readFlightReportOutbox(accountId);
  expect(items.map(item => item.command.code)).toEqual(['BLOCK_ON', 'PUSHBACK']);
  expect(pendingFor(items, operationId).milestones.get('BLOCK_ON').command.occurredAt).toBe('2026-11-04T16:02:00.000Z');
});

test('a tap is saved on the device first and leaves the queue once ELEVANT confirms it', async () => {
  let release;
  mockApi.recordRampMilestone.mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
  const seen = [];
  const stop = subscribeFlightReport(snapshot => seen.push(snapshot.items.length));
  await recordMilestone(operationId, 'BLOCK_ON', new Date('2026-11-04T16:00:00.000Z'));
  expect((await readFlightReportOutbox(accountId)).length).toBe(1);
  release(response([{ code: 'BLOCK_ON', actualAt: '2026-11-04T16:00:00.000Z' }]));
  await flushFlightReport();
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
  expect(mockApi.recordRampMilestone).toHaveBeenCalledWith(operationId, 'BLOCK_ON', '2026-11-04T16:00:00.000Z',
    '81000000-0000-4000-8000-000000000001', expect.stringMatching(/^90000000/));
  expect(seen).toContain(1);
  stop();
});

test('without signal the command stays pending with the same key; a server rejection blocks it for review', async () => {
  mockApi.updateRampFlightData.mockRejectedValue(new Error('offline'));
  await saveFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000, aircraftRegistration: 'HI1099' });
  await flushFlightReport();
  let [item] = await readFlightReportOutbox(accountId);
  expect(item.state).toBe('pending');
  expect(item.attempts).toBeGreaterThanOrEqual(1);
  const key = item.idempotencyKey;
  mockApi.updateRampFlightData.mockRejectedValue(new ElevantApiError({ status: 409 }));
  await flushFlightReport();
  [item] = await readFlightReportOutbox(accountId);
  expect(item).toMatchObject({ idempotencyKey: key, state: 'blocked' });
  expect(mockApi.updateRampFlightData).toHaveBeenLastCalledWith(operationId, expect.objectContaining({ passengersIn: 150 }),
    expect.any(String), key);
});

test('flight data queued by an older version travels without the aircraft type and keeps its first body (3-B)', async () => {
  mockApi.updateRampFlightData.mockResolvedValue(response());
  // An item the deployed APK saved before 3-B: no aircraftTypeId field at all.
  mockStore.set(`elevant.flightReportOutbox.v1.${accountId}`, JSON.stringify([{ idempotencyKey: '90000000-0000-4000-8000-0000000000b1',
    command: { kind: 'flightData', operationId, passengersIn: 120, passengersOut: 118, mtowKg: 70000, aircraftRegistration: null },
    createdAt: '2026-11-04T16:00:00.000Z', state: 'pending', attempts: 0 }]));
  expect(await readFlightReportOutbox(accountId)).toHaveLength(1);
  await flushFlightReport();
  expect(mockApi.updateRampFlightData).toHaveBeenCalledWith(operationId, { passengersIn: 120, passengersOut: 118, mtowKg: 70000,
    aircraftRegistration: null }, expect.any(String), '90000000-0000-4000-8000-0000000000b1');
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
});

test('the aircraft type the agent chose travels with the flight data and replaces the unsent one', async () => {
  mockApi.updateRampFlightData.mockRejectedValue(new Error('offline'));
  await saveFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000, aircraftRegistration: null });
  await flushFlightReport();
  const typeId = '60000000-0000-4000-8000-000000000001';
  await saveFlightData(operationId, { passengersIn: 150, passengersOut: 148, mtowKg: 78000, aircraftRegistration: null,
    aircraftTypeId: typeId });
  await flushFlightReport();
  const [queued] = await readFlightReportOutbox(accountId);
  expect(queued.command).toMatchObject({ kind: 'flightData', aircraftTypeId: typeId });
  expect(await readFlightReportOutbox(accountId)).toHaveLength(1);
  mockApi.updateRampFlightData.mockResolvedValue(response());
  await flushFlightReport();
  expect(mockApi.updateRampFlightData).toHaveBeenLastCalledWith(operationId, { passengersIn: 150, passengersOut: 148,
    mtowKg: 78000, aircraftRegistration: null, aircraftTypeId: typeId }, expect.any(String), expect.any(String));
  expect(await readFlightReportOutbox(accountId)).toEqual([]);
});
