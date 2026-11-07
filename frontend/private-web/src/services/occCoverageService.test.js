import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));

import { describeReasons, translateCoverageError } from './occCoverageService';

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
  });
});
