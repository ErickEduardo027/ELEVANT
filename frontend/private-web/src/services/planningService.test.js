import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  getOccPlanningSnapshot: vi.fn(),
  getOccPlanningOptions: vi.fn(),
  handleUnauthorizedResponse: vi.fn(),
  readSession: vi.fn(),
}));

vi.mock('../config/elevantApiClient', () => ({
  createPrivateWebApiClient: mocks.createPrivateWebApiClient,
}));

vi.mock('../features/auth/authService', () => ({
  handleUnauthorizedResponse: mocks.handleUnauthorizedResponse,
  readSession: mocks.readSession,
}));

import * as planningService from './planningService';

const stationId = '20000000-0000-0000-0000-000000000001';
const turnaroundId = '91000000-0000-0000-0000-000000000002';
const snapshot = {
  station: { id: stationId, code: 'PUJ', name: 'Punta Cana', ianaTimeZone: 'America/Santo_Domingo' },
  date: '2026-08-19',
  turnarounds: [],
};
const options = {
  turnaround: {
    id: turnaroundId,
    operationCode: 'DEV-TAT-0002',
    operationDate: '2026-08-19',
    station: snapshot.station,
    stand: null,
    referenceTime: '2026-08-19T12:00:00-04:00',
  },
  contract: null,
  services: [],
  agents: [],
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'current-access-token' });
  mocks.getOccPlanningSnapshot.mockResolvedValue(snapshot);
  mocks.getOccPlanningOptions.mockResolvedValue(options);
  mocks.createPrivateWebApiClient.mockReturnValue({
    getOccPlanningSnapshot: mocks.getOccPlanningSnapshot,
    getOccPlanningOptions: mocks.getOccPlanningOptions,
  });
});

describe('planningService', () => {
  it('loads an OCC snapshot through the shared client and preserves the AbortSignal', async () => {
    const controller = new AbortController();

    await expect(
      planningService.getPlanningSnapshot({
        stationId,
        date: '2026-08-19',
        signal: controller.signal,
      })
    ).resolves.toBe(snapshot);

    expect(mocks.getOccPlanningSnapshot).toHaveBeenCalledWith(
      { stationId, date: '2026-08-19' },
      { signal: controller.signal }
    );
  });

  it('omits undefined snapshot parameters instead of serializing them', async () => {
    await planningService.getPlanningSnapshot({ stationId });

    expect(mocks.getOccPlanningSnapshot).toHaveBeenCalledWith(
      { stationId },
      { signal: undefined }
    );
  });

  it('loads options for a selected turnaround through the shared client', async () => {
    const controller = new AbortController();

    await expect(
      planningService.getPlanningOptions(turnaroundId, { signal: controller.signal })
    ).resolves.toBe(options);

    expect(mocks.getOccPlanningOptions).toHaveBeenCalledWith(turnaroundId, {
      signal: controller.signal,
    });
  });

  it('reads a fresh session token for every request instead of retaining one', async () => {
    const observedTokens = [];
    mocks.readSession
      .mockReturnValueOnce({ token: 'first-token' })
      .mockReturnValueOnce({ token: 'second-token' });
    mocks.createPrivateWebApiClient.mockImplementation(clientOptions => ({
      getOccPlanningSnapshot: async () => {
        observedTokens.push(clientOptions.getAccessToken());
        return snapshot;
      },
      getOccPlanningOptions: async () => {
        observedTokens.push(clientOptions.getAccessToken());
        return options;
      },
    }));

    await planningService.getPlanningSnapshot();
    await planningService.getPlanningOptions(turnaroundId);

    expect(observedTokens).toEqual(['first-token', 'second-token']);
  });

  it('routes HTTP 401 through the existing expiration handler and exposes only a generic error', async () => {
    mocks.getOccPlanningSnapshot.mockRejectedValue(
      new ElevantApiError({
        kind: 'http',
        status: 401,
        title: 'Sensitive authorization internals',
        traceId: 'private-trace',
      })
    );

    const error = await planningService.getPlanningSnapshot().catch(reason => reason);

    expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    expect(error).toMatchObject({
      name: 'PlanningServiceError',
      status: 401,
      code: 'unauthorized',
      recoverable: false,
      message: 'La sesión expiró. Inicia sesión nuevamente.',
    });
    expect(error.message).not.toContain('Sensitive authorization internals');
    expect(error).not.toHaveProperty('traceId');
  });

  it('classifies HTTP 403 as a non-recoverable permission failure', async () => {
    mocks.getOccPlanningSnapshot.mockRejectedValue(
      new ElevantApiError({
        kind: 'http',
        status: 403,
        title: 'Sensitive policy internals',
        traceId: 'private-trace',
      })
    );

    const error = await planningService.getPlanningSnapshot().catch(reason => reason);

    expect(mocks.handleUnauthorizedResponse).not.toHaveBeenCalled();
    expect(error).toMatchObject({
      name: 'PlanningServiceError',
      status: 403,
      code: 'forbidden',
      recoverable: false,
      message: 'Su cuenta no tiene permiso para consultar esta planificación.',
    });
    expect(error.message).not.toContain('Sensitive policy internals');
    expect(error).not.toHaveProperty('traceId');
  });

  it('classifies an options HTTP 409 as a recoverable contractual ambiguity', async () => {
    mocks.getOccPlanningOptions.mockRejectedValue(
      new ElevantApiError({
        kind: 'http',
        status: 409,
        title: 'Two internal contracts overlap',
        traceId: 'private-trace',
      })
    );

    const error = await planningService
      .getPlanningOptions(turnaroundId)
      .catch(reason => reason);

    expect(error).toMatchObject({
      name: 'PlanningServiceError',
      status: 409,
      code: 'contract-ambiguity',
      recoverable: true,
      message: 'No fue posible determinar un contrato operativo único para este vuelo.',
    });
    expect(error.message).not.toContain('Two internal contracts overlap');
  });

  it('sanitizes network and unexpected failures', async () => {
    mocks.getOccPlanningSnapshot.mockRejectedValue(
      new Error('socket host and private infrastructure details')
    );

    const error = await planningService.getPlanningSnapshot().catch(reason => reason);

    expect(error).toMatchObject({
      name: 'PlanningServiceError',
      code: 'request-failed',
      message: 'No fue posible cargar la planificación operativa.',
    });
    expect(error.message).not.toContain('socket host');
  });

  it('preserves AbortError so hooks can ignore superseded requests', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mocks.getOccPlanningSnapshot.mockRejectedValue(abortError);

    await expect(planningService.getPlanningSnapshot()).rejects.toBe(abortError);
    expect(mocks.handleUnauthorizedResponse).not.toHaveBeenCalled();
  });

  it('does not expose prototype write operations before API write contracts exist', () => {
    expect(planningService).not.toHaveProperty('createPlannedFlight');
    expect(planningService).not.toHaveProperty('assignPlannedFlight');
  });
});
