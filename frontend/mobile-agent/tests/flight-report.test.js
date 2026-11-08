const mockStore = new Map();
const mockApi = {
  recordRampMilestone: jest.fn(), updateRampFlightData: jest.fn(), startRampOperation: jest.fn(),
  transitionRampOperationService: jest.fn(), applyRampServiceCharge: jest.fn(), submitRampOperationChecklist: jest.fn(),
  sendOperationalMessage: jest.fn(), recordRampDamageMark: jest.fn(), attachRampDamagePhoto: jest.fn(),
};
const mockContext = jest.fn();
const mockReject = jest.fn();
const mockRegister = jest.fn();
const mockLegacy = { read: jest.fn(), remove: jest.fn() };
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
    constructor({ status, code }) { super(`API ${status}`); this.kind = 'http'; this.status = status; this.code = code; }
  },
}));
jest.mock('../src/config/elevant-api', () => ({
  createMobileAgentApiClient: jest.fn(() => mockApi),
  isMobileAgentNetworkError: jest.fn(error => error?.message === 'offline'),
}));
jest.mock('../src/storage/mobile-session', () => ({
  MobileSessionStorageError: class MobileSessionStorageError extends Error {},
  readLegacyRampCommandsIfCurrent: (...args) => mockLegacy.read(...args),
  removeLegacyRampCommandIfCurrent: (...args) => mockLegacy.remove(...args),
  removeRampChecklistDraftIfCurrent: jest.fn(async () => 'removed'),
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
const { recordMilestone, saveFlightData, markDamage, flushFlightReport, subscribeFlightReport, resetFlightReportForTests } =
  require('../src/services/flight-report');
const { startAssignedRampOperation } = require('../src/services/ramp-operation-start');
const { transitionRampOperationService } = require('../src/services/ramp-operation-service-execution');
const serverClock = require('../src/synchronization/server-clock');

const accountId = '20000000-0000-4000-8000-000000000001';
const operationId = '70000000-0000-4000-8000-000000000001';
const response = (milestones = []) => ({ receiptId: '80000000-0000-4000-8000-000000000001', operationId, milestones,
  passengersIn: null, passengersOut: null, mtowKg: null, aircraftRegistration: null });

const installationId = '81000000-0000-4000-8000-000000000001';
const otherOperationId = '70000000-0000-4000-8000-000000000002';
const serviceId = '73000000-0000-4000-8000-000000000001';
const offline = () => new Error('offline');
const key = n => `91000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const milestone = (code, operation = operationId) => ({ kind: 'milestone', operationId: operation, code,
  occurredAt: '2026-11-04T16:00:00.000Z' });
const started = (operation = operationId) => ({ receiptId: '80000000-0000-4000-8000-000000000002', operation: {
  id: operation, status: 'InProgress', plannedStartAt: null, plannedEndAt: null, actualStartAt: '2026-11-04T16:00:00.000Z',
  actualEndAt: null } });
const transitioned = status => ({ receiptId: '80000000-0000-4000-8000-000000000003', service: { id: serviceId, status,
  contractedQuantity: 1, executedQuantity: 0, billingUnit: 'operation' } });
const kinds = items => items.map(item => `${item.command.kind}:${item.state}`);

beforeEach(() => {
  mockStore.clear();
  jest.clearAllMocks();
  resetFlightReportForTests();
  serverClock.resetServerClockForTests();
  mockContext.mockResolvedValue({ sessionId: 's1', accessToken: 'token', session: { actor: { accountId } } });
  mockRegister.mockResolvedValue({ installationId });
  mockReject.mockResolvedValue(true);
  mockLegacy.read.mockResolvedValue({ kind: 'current', commands: [] });
  mockLegacy.remove.mockResolvedValue('removed');
});

afterEach(() => { jest.useRealTimers(); });

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

describe('one queue, first in first out per operation (3-I)', () => {
  test('without signal the start and a service transition wait in order with the tapped time and go out with their keys', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-04T16:00:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    mockApi.startRampOperation.mockRejectedValue(offline());
    await expect(startAssignedRampOperation(operationId, { timeZone: 'America/Santo_Domingo' }))
      .resolves.toMatchObject({ state: 'queued', startedAt: '2026-11-04T16:00:00.000Z' });
    jest.setSystemTime(new Date('2026-11-04T16:05:00.000Z'));
    await expect(transitionRampOperationService(operationId, serviceId, { targetStatus: 'InProgress' },
      { serviceName: 'Equipaje' })).resolves.toMatchObject({ state: 'queued' });
    const queued = await readFlightReportOutbox(accountId);
    expect(queued.map(item => [item.command.kind, item.command.occurredAt])).toEqual([
      ['start', '2026-11-04T16:00:00.000Z'], ['serviceTransition', '2026-11-04T16:05:00.000Z']]);
    // Without signal only the first command of the operation is tried: nothing overtakes the start.
    expect(mockApi.transitionRampOperationService).not.toHaveBeenCalled();

    mockApi.startRampOperation.mockResolvedValue(started());
    mockApi.transitionRampOperationService.mockResolvedValue(transitioned('InProgress'));
    await flushFlightReport();
    expect(mockApi.startRampOperation).toHaveBeenLastCalledWith(operationId, installationId, queued[0].idempotencyKey,
      undefined, { startedAt: '2026-11-04T16:00:00.000Z' });
    expect(mockApi.transitionRampOperationService).toHaveBeenCalledWith(operationId, serviceId,
      { targetStatus: 'InProgress', occurredAt: '2026-11-04T16:05:00.000Z' }, installationId, queued[1].idempotencyKey);
    expect(mockApi.startRampOperation.mock.invocationCallOrder.at(-1))
      .toBeLessThan(mockApi.transitionRampOperationService.mock.invocationCallOrder[0]);
    expect(await readFlightReportOutbox(accountId)).toEqual([]);
    let latest;
    subscribeFlightReport(value => { latest = value; })();
    // The operation screen re-reads ELEVANT's view when its commands go out on their own.
    expect(latest.revisions[operationId]).toBe(2);
  });

  test('a walk-around photo ELEVANT cannot store now does not hold back the milestones after it', async () => {
    const markId = '76000000-0000-4000-8000-000000000001';
    await enqueueFlightReportCommand(accountId, { kind: 'damageMark', operationId, markId, x: 0.4, y: 0.6, note: 'Golpe',
      reportedAt: '2026-11-04T16:00:00.000Z' }, key(1));
    await enqueueFlightReportCommand(accountId, { kind: 'damagePhoto', operationId, markId, fileUri: 'file:///mark.jpg',
      contentType: 'image/jpeg' }, key(2));
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON'), key(3));
    mockApi.recordRampDamageMark.mockResolvedValue({ operationId, documents: [], damageMarks: [] });
    mockApi.attachRampDamagePhoto.mockRejectedValue(new ElevantApiError({ status: 503 }));
    mockApi.recordRampMilestone.mockResolvedValue(response());
    await flushFlightReport();
    const [photo, ...rest] = await readFlightReportOutbox(accountId);
    expect(rest).toEqual([]);
    expect(photo).toMatchObject({ idempotencyKey: key(2), state: 'pending', attempts: 1 });
    expect(mockApi.recordRampMilestone).toHaveBeenCalledWith(operationId, 'BLOCK_ON', '2026-11-04T16:00:00.000Z',
      installationId, key(3));
  });

  test('any other temporary failure holds only the rest of its operation; without signal everything waits', async () => {
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON'), key(1));
    await enqueueFlightReportCommand(accountId, { kind: 'flightData', operationId, passengersIn: 10, passengersOut: 9,
      mtowKg: null, aircraftRegistration: null }, key(2));
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON', otherOperationId), key(3));
    mockApi.recordRampMilestone.mockImplementation(async operation => {
      if (operation === operationId) throw new ElevantApiError({ status: 503 });
      return response();
    });
    await flushFlightReport();
    expect(kinds(await readFlightReportOutbox(accountId))).toEqual(['milestone:pending', 'flightData:pending']);
    expect(mockApi.updateRampFlightData).not.toHaveBeenCalled();
    expect(mockApi.recordRampMilestone).toHaveBeenCalledWith(otherOperationId, 'BLOCK_ON', expect.any(String),
      installationId, key(3));

    await enqueueFlightReportCommand(accountId, milestone('PUSHBACK', otherOperationId), key(4));
    mockApi.recordRampMilestone.mockReset();
    mockApi.recordRampMilestone.mockRejectedValue(offline());
    await flushFlightReport();
    // No signal: the first attempt stops the pass, the other operation's milestone is not even tried.
    expect(mockApi.recordRampMilestone).toHaveBeenCalledTimes(1);
    expect(kinds(await readFlightReportOutbox(accountId)))
      .toEqual(['milestone:pending', 'flightData:pending', 'milestone:pending']);
  });

  test('a start ELEVANT refuses keeps its code and holds the rest of its operation until it is tapped again', async () => {
    await enqueueFlightReportCommand(accountId, { kind: 'start', operationId, occurredAt: '2026-11-04T15:50:00.000Z' }, key(1));
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON'), key(2));
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON', otherOperationId), key(3));
    mockApi.startRampOperation.mockRejectedValue(new ElevantApiError({ status: 409, code: 'time_outside_operation_window' }));
    mockApi.recordRampMilestone.mockResolvedValue(response());
    await flushFlightReport();
    const [start, waiting] = await readFlightReportOutbox(accountId);
    expect(start).toMatchObject({ idempotencyKey: key(1), state: 'blocked', lastCode: 'time_outside_operation_window',
      lastError: 'La hora queda fuera de la ventana de la operación. Revísala y corrígela.' });
    expect(waiting).toMatchObject({ idempotencyKey: key(2), state: 'pending', attempts: 0 });
    expect(mockApi.recordRampMilestone).toHaveBeenCalledTimes(1);
    expect(mockApi.recordRampMilestone).toHaveBeenCalledWith(otherOperationId, 'BLOCK_ON', expect.any(String),
      installationId, key(3));

    // «Iniciar» again: the new tap takes the refused start's turn, before the milestone that waits for it.
    mockApi.startRampOperation.mockResolvedValue(started());
    await expect(startAssignedRampOperation(operationId)).resolves.toMatchObject({ state: 'confirmed' });
    expect(mockApi.startRampOperation.mock.calls.at(-1)[2]).not.toBe(key(1));
    expect(mockApi.recordRampMilestone).toHaveBeenLastCalledWith(operationId, 'BLOCK_ON', expect.any(String),
      installationId, key(2));
    expect(await readFlightReportOutbox(accountId)).toEqual([]);
  });

  test('commands an older version reserved move into the queue once with their key and their first body', async () => {
    mockLegacy.read.mockResolvedValue({ kind: 'current', commands: [
      { storageKey: 'transition-key', idempotencyKey: key(2), kind: 'serviceTransition', operationId, serviceId,
        payload: JSON.stringify({ targetStatus: 'Completed', executedQuantity: 2 }) },
      { storageKey: 'start-key', idempotencyKey: key(1), kind: 'start', operationId },
      { storageKey: 'chat-key', idempotencyKey: key(3), kind: 'chatMessage', operationId, payload: 'Puente listo' },
    ] });
    mockApi.startRampOperation.mockResolvedValue(started());
    mockApi.transitionRampOperationService.mockResolvedValue(transitioned('Completed'));
    mockApi.sendOperationalMessage.mockResolvedValue({ id: key(9) });
    await flushFlightReport();
    // The start goes first and, like the deployed APK did, without a body: its receipt hash is the first one.
    expect(mockApi.startRampOperation).toHaveBeenCalledWith(operationId, installationId, key(1), undefined, undefined);
    expect(mockApi.transitionRampOperationService).toHaveBeenCalledWith(operationId, serviceId,
      { targetStatus: 'Completed', executedQuantity: 2 }, installationId, key(2));
    expect(mockApi.sendOperationalMessage).toHaveBeenCalledWith(operationId, { content: 'Puente listo' }, key(3),
      installationId);
    expect(mockApi.startRampOperation.mock.invocationCallOrder[0])
      .toBeLessThan(mockApi.transitionRampOperationService.mock.invocationCallOrder[0]);
    expect(mockLegacy.remove.mock.calls.map(call => call[2])).toEqual(['start-key', 'transition-key', 'chat-key']);
    await flushFlightReport();
    expect(mockLegacy.read).toHaveBeenCalledTimes(1);
  });
});

describe('the end of a session never loses the queue (3-N12)', () => {
  test('after a 401 the queue stays on the device, nothing goes out signed out, and the same account sends it later', async () => {
    const { MobileServiceError } = require('../src/services/mobile-service-error');
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON'), key(1));
    mockApi.recordRampMilestone.mockRejectedValueOnce(new ElevantApiError({ status: 401 }));
    await flushFlightReport();
    expect(mockReject).toHaveBeenCalledWith('s1');
    expect(kinds(await readFlightReportOutbox(accountId))).toEqual(['milestone:pending']);

    // Signed out: the pass stops before sending anything.
    mockContext.mockRejectedValue(new MobileServiceError('unauthenticated'));
    await flushFlightReport();
    expect(mockApi.recordRampMilestone).toHaveBeenCalledTimes(1);
    expect(kinds(await readFlightReportOutbox(accountId))).toEqual(['milestone:pending']);

    // The same account signs in again: the milestone goes out with its first key.
    mockContext.mockResolvedValue({ sessionId: 's2', accessToken: 'token-2', session: { actor: { accountId } } });
    mockApi.recordRampMilestone.mockResolvedValue(response());
    await flushFlightReport();
    expect(mockApi.recordRampMilestone).toHaveBeenLastCalledWith(operationId, 'BLOCK_ON', '2026-11-04T16:00:00.000Z',
      installationId, key(1));
    expect(await readFlightReportOutbox(accountId)).toEqual([]);
  });
});

describe('the tablet’s clock (3-N18)', () => {
  test('a tablet eleven minutes ahead queues the start, a service and a damage at ELEVANT’s time', async () => {
    jest.useFakeTimers({ now: new Date('2026-11-04T16:11:00.000Z'),
      doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'] });
    // ELEVANT answered «15:59:59» (one-second header) in a one-second round trip: the tablet runs eleven minutes ahead.
    expect(serverClock.observeServerDate(new Date('2026-11-04T15:59:59.000Z').toUTCString(), Date.now() - 1_000,
      Date.now())).toBe(true);
    expect(serverClock.clockOffsetMs()).toBe(-11 * 60_000);
    mockApi.startRampOperation.mockRejectedValue(offline());
    await expect(startAssignedRampOperation(operationId, { timeZone: 'America/Santo_Domingo' }))
      .resolves.toMatchObject({ state: 'queued', startedAt: '2026-11-04T16:00:00.000Z' });
    jest.setSystemTime(new Date('2026-11-04T16:16:00.000Z'));
    await transitionRampOperationService(operationId, serviceId, { targetStatus: 'InProgress' }, { serviceName: 'Equipaje' });
    await markDamage(operationId, { x: 0.4, y: 0.6, note: 'Golpe en la puerta 2L' });
    const queued = await readFlightReportOutbox(accountId);
    expect(queued.map(item => [item.command.kind, item.command.occurredAt ?? item.command.reportedAt])).toEqual([
      ['start', '2026-11-04T16:00:00.000Z'], ['serviceTransition', '2026-11-04T16:05:00.000Z'],
      ['damageMark', '2026-11-04T16:05:00.000Z']]);
    // With signal they go out with those times, not the tablet's.
    mockApi.startRampOperation.mockResolvedValue(started());
    mockApi.transitionRampOperationService.mockResolvedValue(transitioned('InProgress'));
    mockApi.recordRampDamageMark.mockResolvedValue({ operationId, documents: [], damageMarks: [] });
    await flushFlightReport();
    expect(mockApi.startRampOperation).toHaveBeenLastCalledWith(operationId, installationId, queued[0].idempotencyKey,
      undefined, { startedAt: '2026-11-04T16:00:00.000Z' });
    expect(mockApi.transitionRampOperationService).toHaveBeenCalledWith(operationId, serviceId,
      { targetStatus: 'InProgress', occurredAt: '2026-11-04T16:05:00.000Z' }, installationId, queued[1].idempotencyKey);
    expect(mockApi.recordRampDamageMark.mock.calls[0][2]).toMatchObject({ reportedAt: '2026-11-04T16:05:00.000Z' });
  });
});

describe('the operation’s window and the order of the milestones (3-N25)', () => {
  test('a milestone ELEVANT refuses by its rule waits for review in Spanish and holds nothing back', async () => {
    await enqueueFlightReportCommand(accountId, milestone('BLOCK_ON'), key(1));
    await enqueueFlightReportCommand(accountId, { ...milestone('WALKAROUND_START'), occurredAt: '2026-11-04T12:00:00.000Z' },
      key(2));
    await enqueueFlightReportCommand(accountId, milestone('DNCD'), key(3));
    mockApi.recordRampMilestone.mockImplementation(async (_operation, code) => {
      if (code === 'BLOCK_ON') throw new ElevantApiError({ status: 409, code: 'milestone_out_of_order' });
      if (code === 'WALKAROUND_START') throw new ElevantApiError({ status: 409, code: 'time_outside_operation_window' });
      return response();
    });
    await flushFlightReport();
    const [blockOn, walkaround, ...rest] = await readFlightReportOutbox(accountId);
    expect(blockOn).toMatchObject({ idempotencyKey: key(1), state: 'blocked', lastCode: 'milestone_out_of_order',
      lastError: 'Bloqueo debe ser anterior al Push-back.' });
    expect(walkaround).toMatchObject({ idempotencyKey: key(2), state: 'blocked', lastCode: 'time_outside_operation_window',
      lastError: 'La hora queda fuera de la ventana de la operación. Revísala y corrígela.' });
    // A refused milestone is not a refused start: the next one of the operation went out.
    expect(rest).toEqual([]);
    expect(mockApi.recordRampMilestone).toHaveBeenCalledWith(operationId, 'DNCD', '2026-11-04T16:00:00.000Z',
      installationId, key(3));
  });
});
