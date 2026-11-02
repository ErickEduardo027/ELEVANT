import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import AirlinePermitsPage from './AirlinePermitsPage';
import { getAirlinePermitsForContracts, reviewAirlinePermit } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getAirlinePermitsForContracts: vi.fn(), reviewAirlinePermit: vi.fn(), openPrivateDocument: vi.fn(),
}));

const permit = { id: 'p-1', airline: 'Demo Airlines', kind: 'OperatingPermit', number: 'JAC-2026-002', issuer: 'JAC',
  issuedOn: '2026-10-01', expiresOn: '2026-11-20', validity: 'Expiring', review: 'Submitted', reviewNote: null,
  documentUrl: null, version: 'v1' };

beforeEach(() => { getAirlinePermitsForContracts.mockResolvedValue([permit]); });
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('lists permits to verify with their validity and verifies one', async () => {
  reviewAirlinePermit.mockResolvedValue({ ...permit, review: 'Verified' });
  render(<AirlinePermitsPage canVerify />);
  expect(await screen.findByText('Demo Airlines')).toBeInTheDocument();
  expect(getAirlinePermitsForContracts).toHaveBeenCalledWith('Submitted');
  expect(screen.getByText('Vence en 30 días o menos')).toBeInTheDocument();
  await userEvent.click(screen.getByRole('button', { name: 'Verificar' }));
  expect(reviewAirlinePermit).toHaveBeenCalledWith('p-1', true, '', 'v1');
  expect(await screen.findByText(/ya quedó activo/)).toBeInTheDocument();
});

it('requires a reason to reject and hides the actions without the verify permission', async () => {
  const { unmount } = render(<AirlinePermitsPage canVerify />);
  await userEvent.click(await screen.findByRole('button', { name: 'Rechazar' }));
  const confirm = screen.getAllByRole('button', { name: 'Rechazar' }).at(-1);
  expect(confirm).toBeDisabled();
  await userEvent.type(screen.getByLabelText(/Motivo/), 'El número no coincide');
  await userEvent.click(confirm);
  expect(reviewAirlinePermit).toHaveBeenCalledWith('p-1', false, 'El número no coincide', 'v1');
  unmount();
  render(<AirlinePermitsPage canVerify={false} />);
  await screen.findByText('Demo Airlines');
  expect(screen.queryByRole('button', { name: 'Verificar' })).not.toBeInTheDocument();
});
