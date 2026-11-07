import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
}));

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createPrivateWebApiClient }));
vi.mock('../features/auth/authService', () => ({
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
  readSession: () => null,
}));

const {
  assignOccStand, isStalePosition, POSITION_PROBLEM_MESSAGES, recordOccArrival, releaseOccStand, translatePositionError,
} = await import('./occPositionsService');

const turnaroundId = '70000000-0000-7000-8000-000000000012';
const standId = '20000000-0000-7000-8000-000000000005';
const key = '90000000-0000-4000-8000-000000000001';
const problem = (status, code, reasons = []) => new ElevantApiError({ kind: 'http', status,
  title: 'The stand is not available for this turnaround.', code, reasons });

describe('positions map adapter (3-N08, 3-N10, 3-B)', () => {
  const client = { recordOccArrival: vi.fn(), assignOccStand: vi.fn(), releaseOccStand: vi.fn() };
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createPrivateWebApiClient.mockReturnValue(client);
    for (const method of Object.values(client)) method.mockResolvedValue({ positions: [] });
  });

  it('sends the arrival with its local time converted, its type and reason, and the headers only with an ETag', async () => {
    const arrival = { aircraftRegistration: 'HI1055', arrivedAt: '2026-11-05T17:05:00.000Z',
      aircraftTypeId: '60000000-0000-7000-8000-000000000001', reason: null };
    await recordOccArrival(turnaroundId, arrival, { ifMatch: '"AAAAAAAAB+E="', idempotencyKey: key });
    expect(client.recordOccArrival).toHaveBeenCalledWith(turnaroundId, arrival, { ifMatch: '"AAAAAAAAB+E="',
      idempotencyKey: key });
    // An account that cannot read the flight's version sends the command as older screens did.
    await recordOccArrival(turnaroundId, { aircraftRegistration: 'HI1055' }, { ifMatch: null, idempotencyKey: key });
    expect(client.recordOccArrival).toHaveBeenLastCalledWith(turnaroundId, { aircraftRegistration: 'HI1055', arrivedAt: null,
      aircraftTypeId: null, reason: null }, {});
    await assignOccStand(turnaroundId, standId, null, { ifMatch: '"AAAAAAAAB+E="', idempotencyKey: key });
    expect(client.assignOccStand).toHaveBeenCalledWith(turnaroundId, { standId, reason: null },
      { ifMatch: '"AAAAAAAAB+E="', idempotencyKey: key });
    await releaseOccStand(turnaroundId);
    expect(client.releaseOccStand).toHaveBeenCalledWith(turnaroundId, {});
  });

  it('explains each refusal by its code in Spanish and keeps its status, code and rules', async () => {
    for (const code of ['arrival_locked', 'reason_required', 'aircraft_type_locked', 'aircraft_type_unavailable',
      'turnaround_closed', 'version_conflict', 'idempotency_conflict', 'expected_version_required']) {
      const translated = translatePositionError(problem(code === 'version_conflict' ? 412 : 409, code));
      expect(translated.message).toBe(POSITION_PROBLEM_MESSAGES[code]);
      expect(translated.code).toBe(code);
      expect(translated.message).not.toMatch(/stand is not available/);
    }
    // A combined-stand rule names itself; the rules stay for the screen.
    const narrow = translatePositionError(problem(409, 'stand_unavailable', ['stand_narrowbody_only']));
    expect([narrow.status, narrow.code, narrow.reasons]).toEqual([409, 'stand_unavailable', ['stand_narrowbody_only']]);
    expect(narrow.message).not.toBe(POSITION_PROBLEM_MESSAGES.stand_unavailable);
    expect(narrow.message).toMatch(/estrech/i);
    expect(translatePositionError(problem(409, 'stand_unavailable')).message).toBe(POSITION_PROBLEM_MESSAGES.stand_unavailable);
    expect(translatePositionError(problem(403)).message).toBe('Tu acceso no permite registrar llegadas ni asignar posiciones.');
    // A body the client refuses is invalid data, never a network failure.
    expect(translatePositionError(new TypeError('The arrival is invalid.'))).toMatchObject({ status: 400,
      code: 'invalid_position_request', message: POSITION_PROBLEM_MESSAGES.invalid_position_request });
    client.releaseOccStand.mockRejectedValueOnce(problem(401));
    await expect(releaseOccStand(turnaroundId)).rejects.toMatchObject({ status: 401 });
    expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
  });

  it('asks the screen to read the flight again after a stale version, a missing one or a conflict', () => {
    expect([409, 412, 428].map(status => isStalePosition({ status }))).toEqual([true, true, true]);
    expect([400, 403, 404, null].map(status => isStalePosition({ status }))).toEqual([false, false, false, false]);
  });
});
