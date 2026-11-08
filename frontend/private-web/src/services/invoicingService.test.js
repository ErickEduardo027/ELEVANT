import { ElevantApiError } from '@elevant/api-client';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  createClient: vi.fn(), readSession: vi.fn(), unauthorized: vi.fn(), pending: vi.fn(), close: vi.fn(), issue: vi.fn(),
}));
vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: mocks.createClient }));
vi.mock('../features/auth/authService', () => ({
  readSession: mocks.readSession, handleUnauthorizedResponse: mocks.unauthorized,
}));

import { INVOICING_PROBLEM_MESSAGES } from './financeErrors';
import {
  blockingReasonMessage, closeOperationsWithoutCharge, closureError, getFinancePendingOperations, invoicingError,
  issueInvoiceFromOperations,
} from './invoicingService';

const problem = (status, code) => new ElevantApiError({ kind: 'http', status, code, title: 'Server title' });
const stationId = '20000000-0000-7000-8000-000000000003';
const key = '33333333-3333-4333-8333-333333333333';

beforeEach(() => {
  vi.clearAllMocks();
  mocks.readSession.mockReturnValue({ token: 'finance-token' });
  mocks.createClient.mockReturnValue({ getFinancePendingOperations: mocks.pending,
    closeOperationsWithoutCharge: mocks.close, issueInvoiceFromOperations: mocks.issue });
});

describe('invoicingService (phase 4, block A)', () => {
  it('reads «Por facturar» without cache and closes with the key of the intent', async () => {
    const signal = new AbortController().signal;
    mocks.pending.mockResolvedValue({ operations: [] });
    await getFinancePendingOperations({ stationId, limit: 50 }, { signal });
    expect(mocks.pending).toHaveBeenCalledWith({ stationId, limit: 50 }, { cache: 'no-store', signal });
    const command = { stationId, operations: [{ operationId: 'op-1', version: 'v1' }], reason: 'Servicios sin tarifa' };
    mocks.close.mockResolvedValue({ closureId: 'c-1', operationIds: ['op-1'], replayed: false });
    await closeOperationsWithoutCharge(command, key);
    expect(mocks.close).toHaveBeenCalledWith(command, key);
    expect(mocks.createClient.mock.calls[0][0].getAccessToken()).toBe('finance-token');
  });

  it('sends the session to sign in again on a 401', async () => {
    mocks.issue.mockRejectedValue(problem(401));
    await expect(issueInvoiceFromOperations({ stationId })).rejects.toMatchObject({ status: 401 });
    expect(mocks.unauthorized).toHaveBeenCalledWith({ status: 401 });
  });

  it('explains every code in Spanish with what resolves it, never the server title', () => {
    expect(invoicingError(problem(422, 'exchange_rate_missing'))).toMatch(/Tasas de cambio/);
    expect(invoicingError(problem(422, 'airline_inactive'))).toMatch(/inactiva/);
    expect(invoicingError(problem(422, 'zero_total'))).toMatch(/Puede cerrar estas operaciones sin cargo/);
    expect(invoicingError(problem(422, 'too_many_lines'))).toMatch(/500 líneas/);
    expect(invoicingError(problem(422, 'date_window_exceeded'))).toMatch(/31 días/);
    expect(invoicingError(problem(409, 'idempotency_conflict'))).toMatch(/otras operaciones/);
    expect(invoicingError(problem(409, 'version_conflict'))).toMatch(/Actualizamos la lista/);
    expect(invoicingError(problem(409, 'pending_preinvoice'))).toMatch(/borrador anterior/);
    expect(closureError(problem(422, 'operation_has_charge'))).toMatch(/emita su factura/);
    expect(closureError(problem(400, 'reason_required'))).toBe('Indique el motivo (entre 5 y 500 caracteres).');
    for (const code of Object.keys(INVOICING_PROBLEM_MESSAGES)) {
      expect(invoicingError(problem(422, code))).toBe(INVOICING_PROBLEM_MESSAGES[code]);
      expect(invoicingError(problem(422, code))).not.toMatch(/Server title/);
    }
  });

  it('reads the reason an older server sent and falls back by status', () => {
    expect(invoicingError({ status: 422, reasons: ['mixed_airline'] })).toMatch(/misma aerolínea/);
    expect(invoicingError(problem(403))).toBe('No tiene permiso para emitir facturas en esta estación.');
    expect(invoicingError(new TypeError('Failed to fetch'))).toMatch(/Puede reintentar/);
    expect(closureError(new TypeError('Failed to fetch'))).toMatch(/No se pudo confirmar el cierre/);
    expect(blockingReasonMessage('exchange_rate_missing')).toBe(INVOICING_PROBLEM_MESSAGES.exchange_rate_missing);
    expect(blockingReasonMessage('toString')).toBe('Requiere revisión antes de facturar.');
  });
});
