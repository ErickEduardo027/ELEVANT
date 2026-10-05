import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RampMobileAccessInbox from './RampMobileAccessInbox';

afterEach(() => cleanup());

it('shows a pending HR request and submits a linked ramp account for approval', async () => {
  const onApprove = vi.fn().mockResolvedValue(true);
  const onReject = vi.fn().mockResolvedValue(true);
  render(<RampMobileAccessInbox requests={[{
    id: 'request-1', rampProfileId: 'profile-1', status: 'Pending',
    requestedAt: '2026-10-04T15:00:00Z', version: 'request-version',
  }]} profiles={[{ id: 'profile-1', name: 'Lucia Ramos', employeeNumber: 'RA-100',
    stations: ['PUJ'], accountId: null, version: 'profile-version' }]} roleId="ramp-role"
  onApprove={onApprove} onReject={onReject} />);
  expect(screen.getByText('Lucia Ramos')).toBeInTheDocument();
  await userEvent.type(screen.getByRole('textbox', { name: 'Correo de acceso móvil' }), 'lucia@example.test');
  await userEvent.type(screen.getByLabelText('Contraseña temporal móvil'), 'Synthetic-Ramp!5678');
  await userEvent.click(screen.getByRole('button', { name: 'Aprobar y crear cuenta' }));
  expect(onApprove).toHaveBeenCalledWith({ firstName: 'Lucia', lastName: 'Ramos',
    email: 'lucia@example.test', roleId: 'ramp-role',
    temporaryPassword: 'Synthetic-Ramp!5678', rampAgentId: 'profile-1',
    accessRequestId: 'request-1', accessRequestVersion: 'request-version',
    expectedRampProfileVersion: 'profile-version', expectedStationCodes: ['PUJ'] });
});

it('requires a reason before rejecting and does not offer decisions after fulfillment', async () => {
  const onReject = vi.fn().mockResolvedValue(true);
  const { rerender } = render(<RampMobileAccessInbox requests={[{
    id: 'request-1', rampProfileId: 'profile-1', status: 'Pending',
    requestedAt: '2026-10-04T15:00:00Z', version: 'request-version',
  }]} profiles={[{ id: 'profile-1', name: 'Lucia Ramos', employeeNumber: 'RA-100',
    stations: ['PUJ'], accountId: null, version: 'profile-version' }]} roleId="ramp-role"
  onApprove={vi.fn()} onReject={onReject} />);
  await userEvent.type(screen.getByRole('textbox', { name: 'Motivo de rechazo' }), 'Datos incompletos');
  await userEvent.click(screen.getByRole('button', { name: 'Rechazar solicitud' }));
  expect(onReject).toHaveBeenCalledWith('request-1', 'Datos incompletos', 'request-version');
  rerender(<RampMobileAccessInbox requests={[{
    id: 'request-1', rampProfileId: 'profile-1', status: 'Fulfilled',
    requestedAt: '2026-10-04T15:00:00Z', accountId: 'account-1',
  }]} profiles={[{ id: 'profile-1', name: 'Lucia Ramos', employeeNumber: 'RA-100',
    stations: ['PUJ'], accountId: 'account-1' }]} roleId="ramp-role"
  onApprove={vi.fn()} onReject={onReject} />);
  expect(screen.queryByRole('button', { name: 'Aprobar y crear cuenta' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Rechazar solicitud' })).not.toBeInTheDocument();
});

it('disables decisions when the reviewed profile lacks a concurrency version', () => {
  render(<RampMobileAccessInbox requests={[{
    id: 'request-1', rampProfileId: 'profile-1', status: 'Pending',
    version: 'request-version', requestedAt: '2026-10-04T15:00:00Z',
  }]} profiles={[{ id: 'profile-1', name: 'Lucia Ramos',
    stations: ['PUJ'], accountId: null }]} roleId="ramp-role"
  onApprove={vi.fn()} onReject={vi.fn()} />);
  expect(screen.getByRole('button', { name: 'Aprobar y crear cuenta' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Rechazar solicitud' })).toBeDisabled();
});
