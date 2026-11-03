import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));

const { translateFlightFeedError, REFRESH_MESSAGES } = await import('./occFlightFeedService');

describe('translateFlightFeedError', () => {
  it('explains import conflicts, including an unknown airport', () => {
    expect(translateFlightFeedError({ status: 409, title: 'The origin or destination airport is not known yet.' }, 'import').message)
      .toBe('Aún no se conoce el aeropuerto de origen o destino de este vuelo.');
    expect(translateFlightFeedError({ status: 409, title: 'The proposed flights cannot be imported together.' }, 'import').message)
      .toMatch(/no se pueden importar juntas/);
    expect(translateFlightFeedError({ status: 403 }).status).toBe(403);
    expect(translateFlightFeedError(new TypeError('pair')).message).toBe('Elige una llegada y una salida distintas.');
  });

  it('has a message for every refresh answer of the server', () => {
    for (const status of ['Refreshed', 'Reused', 'Throttled', 'BudgetExhausted', 'Paused', 'NotConfigured', 'NoContracts', 'Busy', 'Failed'])
      expect(REFRESH_MESSAGES[status]).toBeTruthy();
  });
});
