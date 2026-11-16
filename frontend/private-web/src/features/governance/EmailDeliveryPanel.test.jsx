import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailDeliveryPanel from './EmailDeliveryPanel';
import { listEmailDeliveries, sendTestEmail } from '../../services/departmentGovernanceService';
import { getEmailOutbox } from '../../services/commercialGovernanceApi';

vi.mock('../../services/departmentGovernanceService', () => ({ listEmailDeliveries: vi.fn(), sendTestEmail: vi.fn() }));
vi.mock('../../services/commercialGovernanceApi', () => ({ getEmailOutbox: vi.fn() }));

const delivery = (status, extra = {}) => ({ id: 'd-1', recipient: 'erick@example.test', purpose: 'Test', status, attempts: status === 'Pending' ? 0 : 1,
  createdAt: '2026-11-02T18:00:00Z', sentAt: status === 'Sent' ? '2026-11-02T18:00:05Z' : null, lastError: null, ...extra });
const entry = (extra = {}) => ({ id: 'e-1', recipient: 'ana@carrier.example.com', purpose: 'Activation', status: 'Pending',
  attempts: 0, createdAt: '2026-11-06T10:00:00Z', sentAt: null, updatedAt: '2026-11-06T10:00:00Z', reason: null,
  reference: null, ...extra });
const page = (entries, extra = {}) => ({ smtpConfigured: true, page: 1, limit: 20, hasMore: false, entries, ...extra });

beforeEach(() => { getEmailOutbox.mockResolvedValue(page([])); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('sends a test email and waits until the server reports it as sent', async () => {
  listEmailDeliveries
    .mockResolvedValueOnce({ smtpConfigured: true, deliveries: [] })
    .mockResolvedValueOnce({ smtpConfigured: true, deliveries: [delivery('Pending')] })
    .mockResolvedValue({ smtpConfigured: true, deliveries: [delivery('Sent')] });
  sendTestEmail.mockResolvedValue(delivery('Pending'));
  render(<EmailDeliveryPanel pollMs={20} />);

  expect(await screen.findByText('SMTP configurado')).toBeInTheDocument();
  await userEvent.type(screen.getByLabelText(/Enviar un correo de prueba a/), 'erick@example.test');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar correo de prueba' }));
  expect(sendTestEmail).toHaveBeenCalledWith('erick@example.test');
  expect(await screen.findByText(/Correo de prueba enviado a erick@example.test/)).toBeInTheDocument();
  // The outbox is read again once the test is queued and once it leaves the queue.
  expect(getEmailOutbox.mock.calls.length).toBeGreaterThanOrEqual(3);
});

it('explains why an email did not go out and what it was about, without the server text (1-N22)', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: false, deliveries: [] });
  getEmailOutbox.mockResolvedValue(page([
    entry({ id: 'e-1', purpose: 'ContractActivated', status: 'Failed', attempts: 5, reason: 'smtp_authentication',
      reference: { kind: 'contract', id: 'c-1', label: 'DEV-CONTRACT-0001', context: 'Demo Airlines' } }),
    entry({ id: 'e-2', purpose: 'LoginCode', status: 'Discarded', reason: 'superseded',
      reference: { kind: 'account', id: 'a-1', label: 'Casey Airline', context: 'Demo Airlines' } }),
    entry({ id: 'e-3', purpose: 'CommercialDecision', reference: { kind: 'request', id: 'r-1', label: 'QA-REQ-0001',
      context: 'Caribe Cargo' } }),
  ], { smtpConfigured: false }));
  render(<EmailDeliveryPanel />);
  expect(await screen.findByText(/SMTP sin configurar/)).toBeInTheDocument();
  const list = await screen.findByRole('list', { name: 'Correos de la bandeja' });
  const [contract, code, decision] = within(list).getAllByRole('listitem');
  expect(contract).toHaveTextContent('Contrato activo');
  expect(contract).toHaveTextContent('Contrato DEV-CONTRACT-0001 · Demo Airlines');
  expect(contract).toHaveTextContent('rechazó las credenciales de la cuenta no-reply');
  expect(contract).toHaveTextContent('Falló');
  expect(code).toHaveTextContent('Código de acceso');
  expect(code).toHaveTextContent('Cuenta de Casey Airline · Demo Airlines');
  expect(code).toHaveTextContent('Lo reemplazó un envío más reciente.');
  expect(code).toHaveTextContent('Descartado');
  expect(decision).toHaveTextContent('Decisión de solicitud');
  expect(decision).toHaveTextContent('En cola');
  expect(list).not.toHaveTextContent(/smtp_|SmtpException|ContractActivated/);
});

it('says how to recover a failed or expired email and that a replaced one needs nothing (1-N09, 1-N12)', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: true, deliveries: [] });
  getEmailOutbox.mockResolvedValue(page([
    entry({ id: 'e-1', status: 'Discarded', reason: 'invitation_closed' }),
    entry({ id: 'e-2', status: 'Discarded', reason: 'superseded' }),
    entry({ id: 'e-3', status: 'Discarded', reason: 'expired' }),
    entry({ id: 'e-4', status: 'Failed', attempts: 5, reason: 'smtp_rejected' }),
    entry({ id: 'e-5', purpose: 'LoginCode', status: 'Discarded', reason: 'superseded' }),
    entry({ id: 'e-6', purpose: 'LoginCode', status: 'Discarded', reason: 'expired' }),
    entry({ id: 'e-7' }),
  ]));
  render(<EmailDeliveryPanel />);
  const list = await screen.findByRole('list', { name: 'Correos de la bandeja' });
  const [closed, replaced, expired, failed, replacedCode, expiredCode, queued] = within(list).getAllByRole('listitem');
  const resend = /Reenviar invitación/;
  expect(closed).toHaveTextContent('La invitación se cerró con una contraseña temporal.');
  expect(closed).toHaveTextContent('No requiere acción: la cuenta ya tiene una contraseña temporal.');
  expect(closed).not.toHaveTextContent(resend);
  expect(replaced).toHaveTextContent('No requiere acción: hay un envío más reciente.');
  expect(replaced).not.toHaveTextContent(resend);
  expect(expired).toHaveTextContent(resend);
  expect(expired).not.toHaveTextContent('No requiere acción');
  expect(failed).toHaveTextContent(resend);
  expect(replacedCode).toHaveTextContent('No requiere acción: hay un envío más reciente.');
  expect(replacedCode).not.toHaveTextContent('código nuevo');
  expect(expiredCode).toHaveTextContent('El usuario puede pedir un código nuevo al iniciar sesión.');
  expect(queued).toHaveTextContent('En cola');
  expect(queued).not.toHaveTextContent(/No requiere acción|Reenviar invitación/);
});

it('filters the outbox by status and pages it', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: true, deliveries: [] });
  getEmailOutbox.mockResolvedValue(page([entry()], { hasMore: true }));
  render(<EmailDeliveryPanel />);
  await screen.findByRole('list', { name: 'Correos de la bandeja' });
  await userEvent.selectOptions(screen.getByLabelText('Filtrar correos por estado'), 'Discarded');
  expect(getEmailOutbox).toHaveBeenLastCalledWith({ status: 'Discarded', page: 1, limit: 20 });
  await userEvent.click(await screen.findByRole('button', { name: 'Siguiente' }));
  expect(getEmailOutbox).toHaveBeenLastCalledWith({ status: 'Discarded', page: 2, limit: 20 });
});

it('keeps a recoverable error and the unauthorized state apart', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: true, deliveries: [] });
  getEmailOutbox.mockRejectedValueOnce(Object.assign(new Error('Internal'), { status: 500 }))
    .mockResolvedValue(page([]));
  render(<EmailDeliveryPanel />);
  const failure = await screen.findByRole('alert');
  expect(failure).toHaveTextContent('No se pudo cargar la bandeja de correos.');
  await userEvent.click(within(failure).getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Todavía no hay correos.')).toBeInTheDocument();
  cleanup();
  getEmailOutbox.mockRejectedValue(Object.assign(new Error('Forbidden'), { status: 403 }));
  render(<EmailDeliveryPanel />);
  expect(await screen.findByText('Solo el superadministrador revisa la bandeja de correos.')).toBeInTheDocument();
});

it('rejects an invalid address before calling the API', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: true, deliveries: [] });
  render(<EmailDeliveryPanel />);
  await userEvent.type(await screen.findByLabelText(/Enviar un correo de prueba a/), 'no-es-correo');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar correo de prueba' }));
  expect(screen.getAllByRole('status').some(item => item.textContent === 'Escribe un correo válido.')).toBe(true);
  expect(sendTestEmail).not.toHaveBeenCalled();
});
