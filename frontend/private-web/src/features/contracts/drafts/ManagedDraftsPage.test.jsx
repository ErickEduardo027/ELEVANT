import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ManagedDraftsPage from './ManagedDraftsPage';
import { activateManagedDraft, getManagedDrafts, updateManagedDraft } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedDrafts: vi.fn(), updateManagedDraft: vi.fn(), activateManagedDraft: vi.fn(),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('requires explicit tariff confirmation before a draft can be activated', async () => {
  getManagedDrafts.mockResolvedValue([{
    id: 'draft-1', airline: 'Demo Airlines', contractCode: 'CTR-1', terms: 'Terms',
    validFrom: '2026-10-01', validTo: null, currencyCode: 'USD', stations: [], comments: [],
    rates: [{ id: 'rate-1', serviceName: 'Rampa', billingUnit: 'operation',
      unitPrice: 0, minimumQuantity: 1, isConfirmed: false }],
  }]);
  updateManagedDraft.mockResolvedValue({});
  render(<ManagedDraftsPage />);
  await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
  expect(screen.getByRole('button', { name: 'Activar contrato' })).toBeDisabled();
  await userEvent.click(screen.getByRole('checkbox', { name: /Confirmar tarifa/i }));
  await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
  await waitFor(() => expect(updateManagedDraft).toHaveBeenCalledWith('draft-1',
    expect.objectContaining({ rates: [expect.objectContaining({ isConfirmed: true, unitPrice: 0 })] })));
  expect(activateManagedDraft).not.toHaveBeenCalled();
});
