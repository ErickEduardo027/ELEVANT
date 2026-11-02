import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import EmailDeliveryPanel from './EmailDeliveryPanel';
import { listEmailDeliveries, sendTestEmail } from '../../services/departmentGovernanceService';

vi.mock('../../services/departmentGovernanceService', () => ({ listEmailDeliveries: vi.fn(), sendTestEmail: vi.fn() }));

const delivery = (status, extra = {}) => ({ id: 'd-1', recipient: 'erick@example.test', purpose: 'Test', status, attempts: status === 'Pending' ? 0 : 1,
  createdAt: '2026-11-02T18:00:00Z', sentAt: status === 'Sent' ? '2026-11-02T18:00:05Z' : null, lastError: null, ...extra });

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
  expect(screen.getByRole('list', { name: 'Últimos envíos' })).toHaveTextContent('Enviado');
});

it('shows the failure reason and warns when SMTP is not configured', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: false,
    deliveries: [delivery('Failed', { lastError: 'SmtpException: 5.7.8 Username and Password not accepted' })] });
  render(<EmailDeliveryPanel />);
  expect(await screen.findByText(/SMTP sin configurar/)).toBeInTheDocument();
  expect(screen.getByText(/Username and Password not accepted/)).toBeInTheDocument();
  expect(screen.getByText('Falló')).toBeInTheDocument();
});

it('rejects an invalid address before calling the API', async () => {
  listEmailDeliveries.mockResolvedValue({ smtpConfigured: true, deliveries: [] });
  render(<EmailDeliveryPanel />);
  await userEvent.type(await screen.findByLabelText(/Enviar un correo de prueba a/), 'no-es-correo');
  await userEvent.click(screen.getByRole('button', { name: 'Enviar correo de prueba' }));
  expect(screen.getByRole('status')).toHaveTextContent('Escribe un correo válido.');
  expect(sendTestEmail).not.toHaveBeenCalled();
});
