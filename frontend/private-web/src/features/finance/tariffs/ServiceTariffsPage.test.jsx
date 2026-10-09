import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ServiceTariffsPage from './ServiceTariffsPage';
import { DepartmentAccessProvider, administratorAccess } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import {
  getServiceTariff, listBillingUnits, listFinanceServices, listServiceTariffs, publishServiceTariff, saveServiceTariffDraft,
} from '../../../services/financeBookService';

vi.mock('../../../services/financeBookService', async importOriginal => ({
  ...(await importOriginal()),
  listServiceTariffs: vi.fn(), getServiceTariff: vi.fn(), saveServiceTariffDraft: vi.fn(), publishServiceTariff: vi.fn(),
  listFinanceServices: vi.fn(), listBillingUnits: vi.fn(),
}));
vi.mock('../tariffs/TariffsPage', () => ({ default: () => null }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const summary = version => ({ id: 'tv-2', currencyCode: 'USD', status: 'Draft', validFrom: '2026-10-08', validTo: null,
  note: null, rateCount: 1, publishedBy: null, publishedAt: null, version });
const detail = version => ({ summary: summary(version), rates: [{ id: 'r-1', serviceId: 's-1', serviceCode: 'BAGGAGE',
  serviceName: 'Baggage', stationId: null, stationCode: null, billingUnit: 'operation', unitPrice: 130,
  minimumBillableQuantity: 1 }] });

describe('ServiceTariffsPage', () => {
  it('publishes with the version re-read after saving the draft', async () => {
    let current = 'v1';
    listServiceTariffs.mockImplementation(async () => [summary(current)]);
    getServiceTariff.mockImplementation(async () => detail(current));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    saveServiceTariffDraft.mockImplementation(async () => { current = 'v2'; return { id: 'tv-2' }; });
    publishServiceTariff.mockResolvedValue({ id: 'tv-2' });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', DepartmentPermissionCodes.finance)}>
      <ServiceTariffsPage /></DepartmentAccessProvider>);
    const price = await screen.findByLabelText('Precio de BAGGAGE');
    await userEvent.clear(price);
    await userEvent.type(price, '140');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveServiceTariffDraft).toHaveBeenCalledWith('tv-2', expect.objectContaining({ expectedVersion: 'v1' }));
    await screen.findByText('Borrador guardado.');
    await vi.waitFor(() => expect(getServiceTariff).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    expect(publishServiceTariff).toHaveBeenCalledWith('tv-2', 'v2');
  });
});
