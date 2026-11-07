import { describe, expect, it, vi } from 'vitest';

const api = vi.hoisted(() => ({ updateOccStandAttributes: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: () => api }));

import { describeReasons, translateCoverageError, updateOccStandAttributes } from './occCoverageService';

const key = 'a0000000-0000-7000-8000-000000000009';
const attributes = { date: '2026-08-19', hasBoardingBridge: false, isRemote: true, maxAircraftSize: null, isActive: true,
  expectedVersion: 'AAAAAAAAB9E=' };

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

  it('explains every code of a refused stand change in Spanish, never by the server title (2-A)', () => {
    const inactive = translateCoverageError({ status: 422, code: 'terminal_inactive', reasons: ['terminal_inactive'],
      title: 'The coverage breaks assignment rules.' });
    expect(inactive.message).toBe('La terminal de esta posición está desactivada: reactívala primero en «Datos maestros».');
    expect(describeReasons(inactive.reasons)).toEqual([inactive.message]);
    expect(translateCoverageError({ status: 409, code: 'version_conflict' }).message)
      .toMatch(/La posición cambió mientras la editabas, aquí o en «Datos maestros»/);
    expect(translateCoverageError({ status: 409, code: 'idempotency_conflict' }).message).toMatch(/ya se usó con otros datos/);
    expect(translateCoverageError({ status: 400, code: 'expected_version_required' }).message).toMatch(/Actualiza la vista/);
    expect(translateCoverageError({ status: 409, code: 'version_conflict' })).toMatchObject({ status: 409,
      code: 'version_conflict' });
  });

  it('refuses invalid stand data before sending and keeps a network failure uncertain (2-A)', async () => {
    await expect(updateOccStandAttributes('s-1', { ...attributes, expectedVersion: '' }, key))
      .rejects.toMatchObject({ status: 400, message: 'Revisa los datos del formulario.' });
    expect(api.updateOccStandAttributes).not.toHaveBeenCalled();
    api.updateOccStandAttributes.mockRejectedValueOnce(new TypeError('Failed to fetch'));
    const uncertain = await updateOccStandAttributes('s-1', attributes, key).catch(error => error);
    // No status: the intent keeps its key and the retry replays the first result.
    expect(uncertain).toMatchObject({ status: null, message: 'No fue posible completar la acción. Intenta de nuevo.' });
    api.updateOccStandAttributes.mockResolvedValueOnce({ stationId: 'st' });
    await expect(updateOccStandAttributes('s-1', attributes, key)).resolves.toEqual({ stationId: 'st' });
    expect(api.updateOccStandAttributes).toHaveBeenLastCalledWith('s-1', attributes, key);
  });
});
