import { describe, expect, it } from 'vitest';
import { afterFinanceApproval, contractInForce, financeApprovalEffect, longDay } from './approvalEffect';

describe('what the Finance approval does, by contract status (1-F, 2-C)', () => {
  it('reads an ISO date in Spanish without shifting the day', () => {
    expect(longDay('2026-09-01')).toBe('1 de septiembre de 2026');
    expect(longDay('2026-12-31')).toBe('31 de diciembre de 2026');
  });

  it('treats only active or suspended contracts as in force', () => {
    expect(['Active', 'Suspended'].map(contractInForce)).toEqual([true, true]);
    expect(['Draft', 'Expired', 'Terminated', undefined].map(contractInForce)).toEqual([false, false, false, false]);
  });

  it('tells Contratos that a new or expired contract still activates after the signatures and the permit', () => {
    for (const status of ['Draft', 'Expired', undefined]) {
      expect(afterFinanceApproval(status, '2026-09-01')).toMatch(/firman la aerolínea y AVIAM .*entonces el contrato se activa/);
    }
  });

  it('tells Contratos that an amendment of a contract in force replaces the version in force at its second signature', () => {
    const active = afterFinanceApproval('Active', '2026-09-01');
    expect(active).toMatch(/con la segunda firma esta versión reemplaza a la vigente desde el 1 de septiembre de 2026/);
    expect(active).toMatch(/hasta esas firmas se factura con la versión vigente/);
    expect(active).not.toMatch(/sin esperar firmas/);
    expect(active).not.toMatch(/entonces el contrato se activa/);
    const suspended = afterFinanceApproval('Suspended', '2026-09-01');
    expect(suspended).toMatch(/con la segunda firma esta versión reemplaza a la vigente desde el 1 de septiembre de 2026; el contrato sigue suspendido/);
    expect(suspended).toMatch(/se aplican cuando se reactive/);
  });

  it('tells Finance the effect of approving in the dialog, the notice and the validity note', () => {
    const fresh = financeApprovalEffect('Draft', '2026-09-01');
    expect(fresh.explained).toMatch(/solo entonces el contrato se activa/);
    expect(fresh.done).toBe('Precios aprobados. Contratos continúa con la vigencia y las firmas; el contrato se activa después.');
    expect(fresh.validity).toMatch(/Contratos la confirma después de tu aprobación/);
    const active = financeApprovalEffect('Active', '2026-09-01');
    expect(active.explained).toMatch(/todavía no rigen.*con la segunda firma rigen desde el 1 de septiembre de 2026 y la versión vigente termina el día anterior/);
    expect(active.done).toBe('Precios aprobados. Rigen desde el 1 de septiembre de 2026 cuando firmen la aerolínea y AVIAM; hasta entonces se factura con la versión vigente.');
    expect(active.validity).toMatch(/una vez que ambas partes firmen/);
    const suspended = financeApprovalEffect('Suspended', '2026-09-01');
    expect(suspended.explained).toMatch(/se aplican cuando el contrato se reactive/);
    expect(suspended.done).toMatch(/^Precios aprobados\. Reemplazan a la versión vigente desde el 1 de septiembre de 2026/);
  });
});
