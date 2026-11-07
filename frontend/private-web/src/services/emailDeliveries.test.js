import { describe, expect, it } from 'vitest';
import { EMAIL_PURPOSES, EMAIL_RECOVERY, purposeLabel } from './emailDeliveries';

// Every EmailPurpose of the server (backend/Elevant.Domain/Enumerations/IdentityEnums.cs) has a Spanish label.
const SERVER_PURPOSES = ['Activation', 'LoginCode', 'PasswordReset', 'Test', 'ContractActivated', 'InvoiceIssued',
  'PaymentReceived', 'CommercialDecision', 'ContractReadyToSign', 'PermitRejected', 'PermitRevoked', 'PermitExpiring',
  'ContractExpiring', 'ContractSuspended', 'PortalUserChanged'];

describe('email purposes of the outbox', () => {
  it('labels every purpose the server queues, the airline notices of phase 2 included', () => {
    expect(Object.keys(EMAIL_PURPOSES).sort()).toEqual([...SERVER_PURPOSES].sort());
    expect(purposeLabel('ContractReadyToSign')).toBe('Contrato listo para firmar');
    expect(purposeLabel('PermitRevoked')).toBe('Verificación de permiso revocada');
    expect(purposeLabel('PortalUserChanged')).toBe('Cambio de usuarios del portal');
    expect(purposeLabel('Unknown')).toBe('Correo del sistema');
  });

  it('tells what to do when an airline notice did not go out, without claiming it was sent', () => {
    for (const purpose of ['ContractReadyToSign', 'PermitRejected', 'PermitRevoked', 'PermitExpiring', 'ContractExpiring',
      'ContractSuspended', 'PortalUserChanged']) {
      expect(EMAIL_RECOVERY[purpose]).toMatch(/portal/);
      expect(EMAIL_RECOVERY[purpose]).not.toMatch(/enviamos|se envió/i);
    }
  });
});
