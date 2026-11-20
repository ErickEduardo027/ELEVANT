import { describe, expect, it } from 'vitest';
import { EMAIL_PURPOSES, EMAIL_RECOVERY, purposeLabel } from './emailDeliveries';

// Every EmailPurpose of the server (backend/Elevant.Domain/Enumerations/IdentityEnums.cs) has a Spanish label.
const SERVER_PURPOSES = ['Activation', 'LoginCode', 'PasswordReset', 'Test', 'ContractActivated', 'InvoiceIssued',
  'PaymentReceived', 'CommercialDecision', 'ContractReadyToSign', 'PermitRejected', 'PermitRevoked', 'PermitExpiring',
  'ContractExpiring', 'ContractSuspended', 'PortalUserChanged', 'AdjustmentNoteIssued', 'InvoiceOverdue'];

describe('email purposes of the outbox', () => {
  it('labels every purpose the server queues, the airline notices of phase 2 included', () => {
    expect(Object.keys(EMAIL_PURPOSES).sort()).toEqual([...SERVER_PURPOSES].sort());
    expect(purposeLabel('ContractReadyToSign')).toBe('Contrato listo para firmar');
    expect(purposeLabel('PermitRevoked')).toBe('Verificación de permiso revocada');
    expect(purposeLabel('PortalUserChanged')).toBe('Cambio de usuarios del portal');
    // Phase 4, block C (4-N23).
    expect(purposeLabel('AdjustmentNoteIssued')).toBe('Nota de ajuste emitida');
    expect(purposeLabel('InvoiceOverdue')).toBe('Factura vencida');
    expect(purposeLabel('Unknown')).toBe('Correo del sistema');
  });

  it('points a lost reset link to the airline portal, the only sign-in that sends one (N19, N36)', () => {
    // Only portal accounts receive a reset email (EfAccountEmailStore.RequestPasswordResetAsync); AVIAM Web's
    // «¿Olvidaste tu contraseña?» sends nothing, so the hint names the portal's link as it now reads.
    expect(EMAIL_RECOVERY.PasswordReset)
      .toBe('El usuario puede pedir otro enlace con «¿Olvidó su contraseña?» en el portal de la aerolínea.');
    expect(EMAIL_RECOVERY.PasswordReset).not.toMatch(/Olvidaste/);
  });

  it('tells what to do when an airline notice did not go out, without claiming it was sent', () => {
    for (const purpose of ['ContractReadyToSign', 'PermitRejected', 'PermitRevoked', 'PermitExpiring', 'ContractExpiring',
      'ContractSuspended', 'PortalUserChanged', 'AdjustmentNoteIssued', 'InvoiceOverdue']) {
      expect(EMAIL_RECOVERY[purpose]).toMatch(/portal/);
      expect(EMAIL_RECOVERY[purpose]).not.toMatch(/enviamos|se envió/i);
    }
  });
});
