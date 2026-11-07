import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createPrivateWebApiClient: vi.fn(),
  getOccPlanningSnapshot: vi.fn(),
  getOccPlanningOptionsWithMetadata: vi.fn(),
  assignOccPlanningOperationWithMetadata: vi.fn(),
  getManualTurnaroundOptions: vi.fn(),
  createManualTurnaround: vi.fn(),
  programOccShift: vi.fn(),
  getOccAssignmentReadiness: vi.fn(),
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
const optionsMetadata = { options, etag: '"planning-options-v1"' };
const assignmentMetadata = {
  assignment: {
    turnaroundId,
    operationId: '70000000-0000-0000-0000-000000000016',
    operationStatus: 'Assigned',
    agent: {
      assignmentId: '70000000-0000-0000-0000-000000000017',
      agentId: '30000000-0000-0000-0000-000000000001',
      displayName: 'Riley Ramp',
      employeeNumber: 'DEV-RA-001',
      operationalPositionId: '30000000-0000-0000-0000-000000000002',
      operationalPositionCode: 'RAMP-AGENT',
      operationalPositionName: 'Ramp Agent',
      assignmentRole: 'primary',
      assignedAt: '2026-08-19T11:00:00-04:00',
    },
    services: [],
  },
  etag: '"assigned-v2"',
};

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'current-access-token' });
  mocks.getOccPlanningSnapshot.mockResolvedValue(snapshot);
  mocks.getOccPlanningOptionsWithMetadata.mockResolvedValue(optionsMetadata);
  mocks.assignOccPlanningOperationWithMetadata.mockResolvedValue(assignmentMetadata);
  mocks.getManualTurnaroundOptions.mockResolvedValue({ station: snapshot.station, date: snapshot.date, airlines: [], airports: [] });
  mocks.createManualTurnaround.mockResolvedValue({ turnaroundId, operationCode: 'MAN-TEST', replayed: false });
  mocks.programOccShift.mockResolvedValue({ turnaroundId, shiftId: 'shift-1', replayed: false });
  mocks.createPrivateWebApiClient.mockReturnValue({
    getOccPlanningSnapshot: mocks.getOccPlanningSnapshot,
    getOccPlanningOptionsWithMetadata: mocks.getOccPlanningOptionsWithMetadata,
    assignOccPlanningOperationWithMetadata: mocks.assignOccPlanningOperationWithMetadata,
    getManualTurnaroundOptions: mocks.getManualTurnaroundOptions,
    createManualTurnaround: mocks.createManualTurnaround,
    programOccShift: mocks.programOccShift,
  });
});

describe('planningService', () => {
  it('loads manual choices and creates a flight through the shared authenticated client', async () => {
    const request = { turnaroundId, stationId, airlineId: 'airline-1' };
    await planningService.getManualTurnaroundOptions(stationId, '2026-08-19');
    await planningService.createManualTurnaround(request);

    expect(mocks.getManualTurnaroundOptions).toHaveBeenCalledWith(
      { stationId, date: '2026-08-19' }, { signal: undefined });
    expect(mocks.createManualTurnaround).toHaveBeenCalledWith(request, { signal: undefined });
  });
  it('keeps the Problem Details code of a refused manual flight so the dialog explains it (2-A)', async () => {
    mocks.createManualTurnaround.mockRejectedValueOnce(new ElevantApiError({ kind: 'http', status: 409,
      title: 'The aircraft type is not available.', code: 'aircraft_type_unavailable' }));
    await expect(planningService.createManualTurnaround({ turnaroundId })).rejects.toMatchObject({
      status: 409, code: 'manual-conflict', problemCode: 'aircraft_type_unavailable' });
  });
  it('programs an OCC shift through the shared client', async () => {
    const request = { agentId: 'agent-1', startsAtLocal: '08:00:00', endsAtLocal: '12:00:00' };
    await planningService.programPlanningShift(turnaroundId, request);
    expect(mocks.programOccShift).toHaveBeenCalledWith(turnaroundId, request, { signal: undefined });
  });
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
    ).resolves.toBe(optionsMetadata);

    expect(mocks.getOccPlanningOptionsWithMetadata).toHaveBeenCalledWith(turnaroundId, {
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
      getOccPlanningOptionsWithMetadata: async () => {
        observedTokens.push(clientOptions.getAccessToken());
        return optionsMetadata;
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

  it('classifies an options HTTP 409 as a recoverable operational conflict', async () => {
    mocks.getOccPlanningOptionsWithMetadata.mockRejectedValue(
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
      code: 'options-conflict',
      recoverable: true,
      message: 'No fue posible preparar una versión asignable de esta operación. Actualice la planificación y revise su estado.',
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

  it('exposes only the reviewed assignment write and not the removed prototype writes', () => {
    expect(planningService).not.toHaveProperty('createPlannedFlight');
    expect(planningService).not.toHaveProperty('assignPlannedFlight');
    expect(planningService.assignPlanningOperation).toBeTypeOf('function');
  });

  it('assigns one agent with the exact strong ETag and preserves the AbortSignal', async () => {
    const controller = new AbortController();
    const agentId = '30000000-0000-0000-0000-000000000001';

    await expect(
      planningService.assignPlanningOperation(
        turnaroundId,
        agentId,
        '"planning-options-v1"',
        { signal: controller.signal }
      )
    ).resolves.toBe(assignmentMetadata);

    expect(mocks.assignOccPlanningOperationWithMetadata).toHaveBeenCalledWith(
      turnaroundId,
      { agentId },
      '"planning-options-v1"',
      { signal: controller.signal }
    );
  });

  it.each([
    [403, 'forbidden', false, 'Su cuenta no tiene permiso para asignar esta operación.'],
    [404, 'not-found', true, 'La escala ya no está disponible para asignación. La planificación se actualizará.'],
    [409, 'conflict', true, 'La operación o el agente cambiaron mientras preparaba la asignación. Revise las opciones actualizadas.'],
    [412, 'stale', true, 'Las opciones de asignación cambiaron. Revise la versión actual antes de confirmar nuevamente.'],
  ])(
    'classifies assignment HTTP %s without exposing server details',
    async (status, code, refreshRequired, message) => {
      mocks.assignOccPlanningOperationWithMetadata.mockRejectedValue(
        new ElevantApiError({
          kind: 'http',
          status,
          title: 'Sensitive internal assignment state',
          traceId: 'private-trace',
        })
      );

      const error = await planningService
        .assignPlanningOperation(
          turnaroundId,
          '30000000-0000-0000-0000-000000000001',
          '"planning-options-v1"'
        )
        .catch(reason => reason);

      expect(error).toMatchObject({ status, code, refreshRequired, message });
      expect(error.message).not.toContain('Sensitive internal assignment state');
      expect(error).not.toHaveProperty('traceId');
    }
  );

  it('expires the session when an assignment returns HTTP 401', async () => {
    mocks.assignOccPlanningOperationWithMetadata.mockRejectedValue(
      new ElevantApiError({ kind: 'http', status: 401, title: 'Sensitive token detail' })
    );

    const error = await planningService
      .assignPlanningOperation(
        turnaroundId,
        '30000000-0000-0000-0000-000000000001',
        '"planning-options-v1"'
      )
      .catch(reason => reason);

    expect(mocks.handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    expect(error).toMatchObject({ status: 401, code: 'unauthorized', recoverable: false });
    expect(error.message).not.toContain('Sensitive token detail');
  });

  it('treats a network assignment failure as an ambiguous outcome that requires refresh', async () => {
    mocks.assignOccPlanningOperationWithMetadata.mockRejectedValue(
      new TypeError('socket and private infrastructure details')
    );

    const error = await planningService
      .assignPlanningOperation(
        turnaroundId,
        '30000000-0000-0000-0000-000000000001',
        '"planning-options-v1"'
      )
      .catch(reason => reason);

    expect(error).toMatchObject({
      code: 'unknown-outcome',
      refreshRequired: true,
      message:
        'No fue posible confirmar la asignación. La planificación se actualizará antes de volver a intentar.',
    });
    expect(error.message).not.toContain('socket');
  });

  it('treats an aborted assignment request as an ambiguous outcome that requires reconciliation', async () => {
    const abortError = new DOMException('The operation was aborted.', 'AbortError');
    mocks.assignOccPlanningOperationWithMetadata.mockRejectedValue(abortError);

    const error = await planningService
      .assignPlanningOperation(
        turnaroundId,
        '30000000-0000-0000-0000-000000000001',
        '"planning-options-v1"'
      )
      .catch(reason => reason);

    expect(error).toMatchObject({
      code: 'unknown-outcome',
      refreshRequired: true,
      message:
        'No fue posible confirmar la asignación. La planificación se actualizará antes de volver a intentar.',
    });
  });
});
describe('assignment readiness (2-N25)', () => {
  it('reads the marks of a station and date and hides the failure details', async () => {
    const marks = { stationId, date: '2026-08-19', assignments: [] };
    mocks.getOccAssignmentReadiness.mockResolvedValueOnce(marks).mockRejectedValueOnce(new Error('SQL timeout at 10.0.0.4'));
    mocks.createPrivateWebApiClient.mockReturnValue({ getOccAssignmentReadiness: mocks.getOccAssignmentReadiness });
    const signal = new AbortController().signal;
    await expect(planningService.getAssignmentReadiness({ stationId, date: '2026-08-19', signal })).resolves.toEqual(marks);
    expect(mocks.getOccAssignmentReadiness).toHaveBeenCalledWith({ stationId, date: '2026-08-19' }, { signal });
    const failure = await planningService.getAssignmentReadiness({ stationId, date: '2026-08-19' }).catch(error => error);
    expect(failure.message).toBe('No fue posible comprobar si los agentes asignados pueden operar.');
    expect(failure.message).not.toMatch(/SQL/);
  });
});
