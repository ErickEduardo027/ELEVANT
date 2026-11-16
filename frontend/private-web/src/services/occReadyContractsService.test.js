import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));

const { translateReadyContractsError } = await import('./occReadyContractsService');

describe('translateReadyContractsError', () => {
  it('turns statuses into Spanish messages and keeps aborts', () => {
    expect(translateReadyContractsError({ status: 403 })).toMatchObject({ status: 403,
      message: 'Tu acceso no incluye la planificación de esta estación.' });
    expect(translateReadyContractsError(new TypeError('date')).message).toBe('Elige una fecha válida.');
    expect(translateReadyContractsError({ status: 500 }).message).toMatch(/No se pudieron cargar/);
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    expect(translateReadyContractsError(abort)).toBe(abort);
  });
});
