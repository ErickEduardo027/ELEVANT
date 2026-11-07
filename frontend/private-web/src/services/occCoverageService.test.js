import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));

import { createPrivateWebApiClient } from '../config/elevantApiClient';
import { handleUnauthorizedResponse } from '../features/auth/authService';
import {
  createOccCoverage, describeReasons, handOverOccOperation, loadOccHandoverOptions, releaseOccCoverage,
  releaseOccOperationAgent, translateCoverageError,
} from './occCoverageService';

const api = {
  createOccCoverage: vi.fn(), releaseOccCoverage: vi.fn(), releaseOccOperationAgent: vi.fn(),
  getOccHandoverOptions: vi.fn(), handOverOccOperation: vi.fn(),
};
const key = '90000000-0000-4000-8000-000000000001';

beforeEach(() => {
  vi.clearAllMocks();
  createPrivateWebApiClient.mockReturnValue(api);
});

describe('coverage errors (ADR-0030)', () => {
  it('keeps the rule codes so the screen can explain each one', () => {
    const error = translateCoverageError({ status: 422, reasons: ['too_many_stands', 'unknown_rule'] });
    expect(error.message).toBe('La cobertura no cumple las reglas de asignación.');
    expect(error.reasons).toEqual(['too_many_stands']);
    expect(describeReasons(error.reasons)).toEqual(['Supera el máximo de posiciones por agente de esta terminal.']);
  });

  it('says why a stand in use cannot be deactivated from Configuración (2-A)', () => {
    const error = translateCoverageError({ status: 422, code: 'stand_in_use', reasons: ['stand_in_use'] });
    expect(error.message).toBe('La posición tiene vuelos sin terminar o coberturas abiertas: no se puede desactivar.');
    expect(error.reasons).toEqual(['stand_in_use']);
  });

  it('falls back to the status when there are no known reasons', () => {
    expect(translateCoverageError({ status: 409 }).message).toMatch(/cambiaron/);
    expect(translateCoverageError({ status: 403, reasons: [] }).reasons).toEqual([]);
    expect(translateCoverageError({ status: 403 }).message).toBe('Tu acceso no permite gestionar la cobertura de posiciones.');
  });

  it('explains the Problem Details code and keeps it with the status (3-J)', () => {
    const rejected = translateCoverageError({ status: 422, code: 'coverage_rejected', reasons: ['terminal_scope_missing'] });
    expect([rejected.status, rejected.code]).toEqual([422, 'coverage_rejected']);
    expect(describeReasons(rejected.reasons)).toEqual(['El agente no tiene alcance vigente en esa terminal.']);
    expect(translateCoverageError({ status: 409, code: 'idempotency_conflict' }).message)
      .toBe('Ese envío ya se usó con otros datos. Se actualizó la vista; inténtalo de nuevo.');
    expect(translateCoverageError({ status: 409, code: 'version_conflict' }).code).toBe('version_conflict');
    expect(translateCoverageError(new TypeError('bad'))).toMatchObject({ status: 400, code: 'invalid_coverage_request',
      message: 'Revisa los datos del formulario.' });
  });
});

describe('coverage and agent commands with the intent key (3-J, 3-F)', () => {
  it('sends the key of a coverage creation and release', async () => {
    api.createOccCoverage.mockResolvedValue({ coverages: [] });
    api.releaseOccCoverage.mockResolvedValue({ coverages: [] });
    await createOccCoverage({ agentId: 'ag-1' }, { idempotencyKey: key });
    await releaseOccCoverage('cv-1', '2026-11-09', { idempotencyKey: key });
    expect(api.createOccCoverage).toHaveBeenCalledWith({ agentId: 'ag-1' }, { idempotencyKey: key });
    expect(api.releaseOccCoverage).toHaveBeenCalledWith('cv-1', '2026-11-09', { idempotencyKey: key });
  });

  it('releases the agent OCC saw and keeps the code of a refusal for the drawer', async () => {
    api.releaseOccOperationAgent.mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(Object.assign(new Error('HTTP 409'), { status: 409, code: 'assignment_changed' }));
    await releaseOccOperationAgent('ta-1', { expectedAssignmentId: 'as-1', idempotencyKey: key });
    expect(api.releaseOccOperationAgent).toHaveBeenCalledWith('ta-1', { expectedAssignmentId: 'as-1', idempotencyKey: key });
    await expect(releaseOccOperationAgent('ta-1', { expectedAssignmentId: 'as-1', idempotencyKey: key }))
      .rejects.toMatchObject({ status: 409, code: 'assignment_changed' });
  });

  it('reads the handover options and hands over with the key; a session that ended goes to the login', async () => {
    api.getOccHandoverOptions.mockResolvedValue({ agents: [] });
    api.handOverOccOperation.mockRejectedValueOnce(Object.assign(new Error('HTTP 401'), { status: 401 }))
      .mockRejectedValueOnce(new TypeError('reason'));
    const controller = new AbortController();
    await expect(loadOccHandoverOptions('ta-1', { signal: controller.signal })).resolves.toEqual({ agents: [] });
    expect(api.getOccHandoverOptions).toHaveBeenCalledWith('ta-1', { signal: controller.signal });
    const command = { agentId: 'ag-2', expectedAssignmentId: 'as-1', reason: 'Fin de turno' };
    await expect(handOverOccOperation('ta-1', command, key)).rejects.toMatchObject({ status: 401 });
    expect(handleUnauthorizedResponse).toHaveBeenCalledWith({ status: 401 });
    await expect(handOverOccOperation('ta-1', command, key)).rejects.toMatchObject({ status: 400, code: 'invalid_handover' });
    expect(api.handOverOccOperation).toHaveBeenCalledWith('ta-1', command, key);
  });
});
