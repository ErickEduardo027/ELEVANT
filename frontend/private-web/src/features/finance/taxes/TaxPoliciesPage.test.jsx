import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import TaxPoliciesPage from './TaxPoliciesPage';
import PreinvoiceTaxesPanel from './PreinvoiceTaxesPanel';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { commercialApi } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', async original => ({ ...(await original()), commercialApi: vi.fn() }));
const policy = { id: 'p1', airlineId: 'a1', airlineName: 'Synthetic Airline', stationId: 's1', stationCode: 'PUJ',
  currencyCode: 'USD', conceptKind: 'Service', conceptCode: 'GPU', treatment: 'Taxable', rate: 0,
  basis: null, validFrom: '2026-10-01', validTo: null, status: 'Published', version: 'rv1' };
let rows;
function mount(child = <TaxPoliciesPage />, permissions = ['finance.taxes.read', 'finance.taxes.create', 'finance.taxes.update']) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Employee', department: 'finance', permissions }}>{child}</DepartmentAccessProvider>);
}
const writes = () => commercialApi.mock.calls.filter(([, options]) => options?.method);
beforeEach(() => {
  rows = [policy]; commercialApi.mockImplementation(async (path, options) => {
    if (options?.method) return { id: 'new-policy' };
    if (path === '/finance/tax-policies') return structuredClone(rows);
    if (path.endsWith('/context')) return { airlines: [{ id: 'a1', code: 'QA', name: 'Synthetic Airline' }], stations: [{ id: 's1', code: 'PUJ', name: 'Synthetic Station' }] };
    return { id: 'draft1', version: 'rv1', currencyCode: 'USD', net: 100, discount: 0, tax: null, gross: 100, treatmentsConfigured: false,
      lines: [{ id: 'l1', lineNumber: 1, conceptKind: 'Service', conceptCode: 'GPU', description: 'Synthetic GPU', treatment: 'Unconfigured', net: 100, discount: 0, tax: null, gross: 100 }] };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });
describe('Tax policy management', () => {
  it('requires read access before requesting data', () => {
    mount(<TaxPoliciesPage />, []); expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso'); expect(commercialApi).not.toHaveBeenCalled();
  });
  it('shows explicit zero and immutable history with read access', async () => {
    mount(<TaxPoliciesPage />, ['finance.taxes.read']);
    await screen.findByText('GPU'); expect(screen.getByText('Gravado · 0%')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Nueva política' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls).toHaveLength(1);
  });
  it('creates exempt treatment only with basis and exact context', async () => {
    mount(); await screen.findByText('GPU'); await userEvent.click(screen.getByRole('button', { name: 'Nueva política' }));
    await userEvent.selectOptions(screen.getByLabelText('Aerolínea'), 'a1'); await userEvent.selectOptions(screen.getByLabelText('Estación'), 's1');
    await userEvent.selectOptions(screen.getByLabelText('Tipo de concepto'), 'Package'); await userEvent.type(screen.getByLabelText('Código del concepto'), 'RAMP');
    await userEvent.type(screen.getByLabelText('Desde'), '2026-10-01'); await userEvent.selectOptions(screen.getByLabelText('Tratamiento'), 'Exempt');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nueva política' }));
    expect(screen.getByLabelText('Fundamento')).toBeInvalid(); expect(writes()).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Fundamento'), 'Synthetic reviewed basis');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar nueva política' }));
    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ airlineId: 'a1', stationId: 's1', conceptKind: 'Package', conceptCode: 'RAMP',
      treatment: 'Exempt', rate: null, basis: 'Synthetic reviewed basis', expectedVersion: null, requestId: expect.any(String) });
  });
  it('publishes with expectedVersion and preserves a command after uncertain responses', async () => {
    rows = [{ ...policy, status: 'Draft' }]; mount(); await screen.findByText('GPU');
    commercialApi.mockRejectedValueOnce(new TypeError('Private exception'));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar GPU' }));
    expect(await screen.findByRole('alert')).not.toHaveTextContent('Private exception');
    await userEvent.click(screen.getByRole('button', { name: 'Publicar GPU' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(JSON.parse(writes()[0][1].body)).toEqual(JSON.parse(writes()[1][1].body));
    expect(JSON.parse(writes()[1][1].body)).toMatchObject({ expectedVersion: 'rv1' });
  });
  it('shows loading, empty and recoverable errors', async () => {
    rows = []; commercialApi.mockRejectedValueOnce({ status: 500, message: 'Private SQL' }); mount();
    expect(screen.getByRole('status')).toHaveTextContent('Cargando'); await screen.findByRole('alert');
    expect(screen.queryByText('Private SQL')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' })); await screen.findByText('Aún no hay políticas de impuestos.');
  });
  it('shows unknown taxes without inventing zero and applies only through the separate endpoint', async () => {
    mount(<PreinvoiceTaxesPanel preinvoiceId="draft1" status="Draft" />);
    await screen.findByText('Synthetic GPU'); expect(screen.getAllByText('Sin configurar').length).toBeGreaterThan(0);
    await userEvent.click(screen.getByRole('button', { name: 'Aplicar tratamientos pendientes' }));
    await waitFor(() => expect(writes()).toHaveLength(1)); expect(writes()[0][0]).toBe('/finance/preinvoices/draft1/taxes');
    expect(JSON.parse(writes()[0][1].body)).toMatchObject({ expectedVersion: 'rv1', requestId: expect.any(String) });
  });
});
