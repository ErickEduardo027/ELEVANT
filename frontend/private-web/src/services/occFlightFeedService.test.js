import { describe, expect, it, vi } from 'vitest';

vi.mock('../features/auth/authService', () => ({ handleUnauthorizedResponse: vi.fn(), readSession: () => null }));

const { FLIGHT_FEED_MESSAGES, flightFeedMessage, importOccFlightProposals, pauseReasonText, placementReasons,
  REFRESH_MESSAGES } = await import('./occFlightFeedService');

const failure = (status, code, reasons = []) => Object.assign(new Error('The proposed flights cannot be imported together.'),
  { status, code, reasons, title: 'The proposed flights cannot be imported together.' });

describe('flight feed messages', () => {
  it('explains each import refusal by its code, never by the server title', () => {
    expect(flightFeedMessage(failure(409, 'flight_counterpart_unknown')))
      .toBe('Aún no se conoce el aeropuerto de origen o destino de este vuelo.');
    // 2-N16: a suspended or expired contract says so instead of blaming the pair.
    expect(flightFeedMessage(failure(409, 'contract_not_in_force'))).toMatch(/suspendido o vencido/);
    expect(flightFeedMessage(failure(409, 'charter_required'))).toMatch(/charter sin contrato/);
    expect(flightFeedMessage(failure(409, 'flight_proposal_passed'))).toBe('Ese vuelo ya pasó: no se puede restaurar.');
    expect(flightFeedMessage(failure(403))).toBe(FLIGHT_FEED_MESSAGES.forbidden);
    expect(flightFeedMessage(failure(409))).toBe('El registro cambió; actualice e intente de nuevo.');
    // No answer at all is a retry, not invalid data.
    expect(flightFeedMessage(new TypeError('Failed to fetch'))).toBe('No fue posible completar la acción. Intenta nuevamente.');
    for (const code of Object.keys(FLIGHT_FEED_MESSAGES))
      expect(flightFeedMessage(failure(409, code))).not.toMatch(/cannot be imported/);
  });

  it('refuses a pair without versions before sending it, as invalid data', async () => {
    const failed = await importOccFlightProposals({ arrivalProposalId: '70000000-0000-7000-8000-000000000001',
      departureProposalId: '70000000-0000-7000-8000-000000000002', expectedArrivalVersion: '', expectedDepartureVersion: 'v' },
    'a0000000-0000-7000-8000-000000000009').catch(error => error);
    expect(failed).toMatchObject({ status: 400, code: 'invalid_flight_import' });
    expect(flightFeedMessage(failed)).toBe(FLIGHT_FEED_MESSAGES.invalid_flight_import);
  });

  it('describes the stand rules of a refused import', () => {
    expect(placementReasons(failure(409, 'stand_unavailable', ['stand_taken', 'neighbour_widebody', 'stand_taken'])))
      .toEqual(['Otro vuelo ocupa esa posición en ese horario.',
        'Ocuparla limitaría a estrecho una posición vecina que ya tiene un avión ancho.']);
    expect(placementReasons(failure(409, 'stand_unavailable'))).toEqual([]);
  });

  it('translates every pause code of the synchronizer (2-N29)', () => {
    expect(pauseReasonText('quota_exceeded')).toBe('se agotó la cuota del plan del proveedor');
    expect(pauseReasonText('unauthorized')).toBe('el proveedor rechazó la credencial configurada');
    expect(pauseReasonText('rate_limited')).toBe('el proveedor pidió esperar entre consultas');
    expect(pauseReasonText('failed_network')).toBe('no hubo conexión con el proveedor');
    expect(pauseReasonText('failed_503')).toBe('el proveedor respondió con un error (503)');
    expect(pauseReasonText('anything_else')).toBe('error del proveedor');
    expect(pauseReasonText(null)).toBe('error del proveedor');
  });

  it('has a message for every refresh answer of the server', () => {
    for (const status of ['Refreshed', 'Reused', 'Throttled', 'BudgetExhausted', 'Paused', 'NotConfigured', 'NoContracts', 'Busy', 'Failed'])
      expect(REFRESH_MESSAGES[status]).toBeTruthy();
  });
});
