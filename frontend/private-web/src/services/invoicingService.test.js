import { ElevantApiError } from '@elevant/api-client';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../config/elevantApiClient', () => ({ createPrivateWebApiClient: vi.fn() }));
vi.mock('../features/auth/authService', () => ({ readSession: vi.fn(), handleUnauthorizedResponse: vi.fn() }));

import { invoicingError } from './invoicingService';

const refused = (status, reasons = []) =>
  new ElevantApiError({ kind: 'http', status, title: 'The operations cannot be invoiced together.', reasons });

describe('invoicingError', () => {
  it('explains in Spanish the reason a refused e-CF names, never the server title', () => {
    expect(invoicingError(refused(422, ['charge_excluded_by_contract'])))
      .toBe('Alguna operación lleva un cargo que su contrato excluye: pida a OCC reabrir la revisión y quitarlo.');
    expect(invoicingError(refused(422, ['excluded_in_review'])))
      .toBe('OCC excluyó de la facturación un servicio de alguna operación. Actualizamos la lista.');
    expect(invoicingError(refused(422, ['mixed_airline'])))
      .toBe('Una factura solo puede incluir operaciones de la misma aerolínea.');
    expect(invoicingError(refused(409, ['already_invoiced'])))
      .toBe('Alguna operación ya fue facturada. Actualizamos la lista.');
  });

  it('falls back on the status when the reason is unknown', () => {
    expect(invoicingError(refused(422, ['some_future_reason']))).toBe('Estas operaciones no pueden facturarse juntas.');
    expect(invoicingError(refused(403))).toBe('No tiene permiso para emitir facturas en esta estación.');
    expect(invoicingError(refused(409))).toBe('La selección cambió mientras se emitía. Actualizamos la lista.');
    expect(invoicingError(Object.assign(new Error('network'), { status: 0 })))
      .toMatch(/^No se pudo confirmar la emisión/);
  });
});
