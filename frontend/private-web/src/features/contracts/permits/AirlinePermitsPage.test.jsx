import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AirlinePermitsPage, { decisionNotice } from './AirlinePermitsPage';
import { getAirlinePermitsForContracts, reviewAirlinePermit, revokeAirlinePermit } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getAirlinePermitsForContracts: vi.fn(), reviewAirlinePermit: vi.fn(), revokeAirlinePermit: vi.fn(), openPrivateDocument: vi.fn(),
}));

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const permit = { id: 'p-1', airline: 'Demo Airlines', kind: 'OperatingPermit', number: 'JAC-2026-002', issuer: 'JAC',
  issuedOn: '2026-10-01', expiresOn: '2026-11-20', validity: 'Expiring', review: 'Submitted', reviewNote: null,
  documentUrl: null, version: 'v1', revokedAt: null, revocationReason: null };
const verified = { ...permit, review: 'Verified', reviewNote: 'Vigente según la JAC.', version: 'v2' };
const decision = (patch, contracts = []) => ({ ...permit, ...patch, contracts });
const problem = (status, code) => Object.assign(new Error('The permit changed; reload and retry.'), { status, code });

beforeEach(() => { getAirlinePermitsForContracts.mockResolvedValue([permit]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('verifies with the version and a key, and tells the contract the server activated (2-N30)', async () => {
  reviewAirlinePermit.mockResolvedValue(decision({ review: 'Verified' },
    [{ contractId: 'c-1', contractCode: 'CTR-2026-0001', status: 'Active' }]));
  render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('Demo Airlines')).toBeInTheDocument();
  expect(getAirlinePermitsForContracts).toHaveBeenCalledWith('Submitted');
  expect(screen.getByText('Vence en 30 días o menos')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
  expect(reviewAirlinePermit).toHaveBeenCalledWith('p-1', { verified: true, note: null, expectedVersion: 'v1' },
    expect.stringMatching(UUID));
  expect(await screen.findByRole('status')).toHaveTextContent('El contrato CTR-2026-0001 ya quedó activo.');
});

it('never promises an activation the server did not make', () => {
  expect(decisionNotice(decision({ review: 'Verified' }), 'verify')).toMatch(/Ningún contrato cambió de estado/);
  expect(decisionNotice(decision({ review: 'Verified', kind: 'Insurance' }), 'verify'))
    .toMatch(/no activa contratos: solo el permiso de operación/);
  expect(decisionNotice(decision({ review: 'Verified' }), 'verify')).not.toMatch(/activo/);
  expect(decisionNotice(decision({ review: 'Rejected' }), 'reject')).toMatch(/correo con la nota quedó en cola/);
  expect(decisionNotice(decision({ review: 'Rejected' }), 'reject')).not.toMatch(/enviamos|se envió/);
});

it('requires a reason to reject and hides the actions without the verify permission', async () => {
  reviewAirlinePermit.mockResolvedValue(decision({ review: 'Rejected', reviewNote: 'El número no coincide' }));
  const { unmount } = render(<AirlinePermitsPage canVerify />);
  await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
  const dialog = screen.getByRole('dialog', { name: 'Rechazar permiso JAC-2026-002' });
  const confirm = within(dialog).getByRole('button', { name: 'Rechazar' });
  expect(confirm).toBeDisabled();
  await userEvent.type(within(dialog).getByLabelText(/Motivo del rechazo/), 'El número no coincide');
  await userEvent.click(confirm);
  expect(reviewAirlinePermit).toHaveBeenCalledWith('p-1',
    { verified: false, note: 'El número no coincide', expectedVersion: 'v1' }, expect.stringMatching(UUID));
  expect(await screen.findByRole('status')).toHaveTextContent('quedó en cola');
  unmount();
  render(<AirlinePermitsPage canVerify={false} />);
  await screen.findByText('Demo Airlines');
  expect(screen.queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
});

it('revokes a verified permit with a reason and names the contract it suspended (2-N09)', async () => {
  getAirlinePermitsForContracts.mockResolvedValue([verified]);
  revokeAirlinePermit.mockResolvedValue(decision({ review: 'Revoked', revokedAt: '2026-11-06T16:00:00Z',
    revocationReason: 'Se verificó otra matrícula.' }, [{ contractId: 'c-1', contractCode: 'CTR-2026-0001', status: 'Suspended' }]));
  render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('Nota de la verificación: Vigente según la JAC.')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Rechazar' })).not.toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Revocar verificación' }));
  const dialog = screen.getByRole('dialog', { name: /Revocar la verificación del permiso JAC-2026-002/ });
  expect(dialog).toHaveTextContent('sus contratos activos se suspenden ahora');
  await userEvent.type(within(dialog).getByLabelText(/Motivo de la revocación/), 'Se verificó otra matrícula.');
  await userEvent.click(within(dialog).getByRole('button', { name: 'Revocar verificación' }));
  expect(revokeAirlinePermit).toHaveBeenCalledWith('p-1', { reason: 'Se verificó otra matrícula.', expectedVersion: 'v2' },
    expect.stringMatching(UUID));
  const status = await screen.findByRole('status');
  expect(status).toHaveTextContent('Quedó suspendido el contrato CTR-2026-0001');
  expect(status).toHaveTextContent('El aviso a la aerolínea quedó en cola.');
});

it('shows the revocation reason of a revoked permit', async () => {
  getAirlinePermitsForContracts.mockResolvedValue([{ ...verified, review: 'Revoked', revokedAt: '2026-11-06T16:00:00Z',
    revocationReason: 'Se verificó otra matrícula.' }]);
  render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('Verificación revocada')).toBeInTheDocument();
  expect(screen.getByText(/Motivo: Se verificó otra matrícula\./)).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Revocar verificación' })).not.toBeInTheDocument();
});

it('explains a closed review in Spanish and reads the list again', async () => {
  reviewAirlinePermit.mockRejectedValue(problem(409, 'review_closed'));
  render(<AirlinePermitsPage canVerify />);
  await userEvent.click(await screen.findByRole('button', { name: 'Verificar' }));
  const alert = await screen.findByRole('alert');
  expect(alert).toHaveTextContent('Ese permiso ya fue revisado; se volvió a cargar la lista.');
  expect(alert).not.toHaveTextContent(/The permit/);
  expect(getAirlinePermitsForContracts).toHaveBeenCalledTimes(2);
});

it('repeats the same key after an uncertain result and a new one after an answer', async () => {
  reviewAirlinePermit.mockRejectedValueOnce(new Error('network')).mockRejectedValueOnce(new Error('network'))
    .mockResolvedValueOnce(decision({ review: 'Verified' })).mockResolvedValueOnce(decision({ review: 'Verified' }));
  render(<AirlinePermitsPage canVerify />);
  await userEvent.click(await screen.findByRole('button', { name: 'Verificar' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
  await screen.findByRole('alert');
  await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
  await screen.findByRole('status');
  await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
  await vi.waitFor(() => expect(reviewAirlinePermit).toHaveBeenCalledTimes(4));
  const [first, second, third, fourth] = reviewAirlinePermit.mock.calls.map(call => call[2]);
  expect(first).toBe(second);
  expect(third).toBe(first);
  expect(fourth).not.toBe(first);
});

it('keeps the unauthorized and recoverable error states', async () => {
  getAirlinePermitsForContracts.mockRejectedValueOnce(problem(403, 'forbidden'));
  const { unmount } = render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('No tienes acceso a los permisos de aerolíneas.')).toBeInTheDocument();
  unmount();
  getAirlinePermitsForContracts.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce([]);
  render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('No se pudieron cargar los permisos. Intenta de nuevo.')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Sin permisos en esta vista')).toBeInTheDocument();
});
