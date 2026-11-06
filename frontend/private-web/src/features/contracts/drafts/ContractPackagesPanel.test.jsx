import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractPackagesPanel from './ContractPackagesPanel';
import ManagedDraftsPage from './ManagedDraftsPage';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import {
  commercialApi, getContractDraftReadiness, getContractDraftScope, getManagedDrafts, updateManagedDraft,
} from '../../../services/commercialGovernanceApi';

// All components, state, permissions and package services are real. Only HTTP adapters are replaced.
vi.mock('../../../services/commercialGovernanceApi', async importOriginal => ({
  ...(await importOriginal()), commercialApi: vi.fn(), getManagedDrafts: vi.fn(), updateManagedDraft: vi.fn(),
  getContractDraftReadiness: vi.fn(), getContractDraftScope: vi.fn(),
}));

const component = (id = 'gpu') => ({ serviceId: id, serviceCode: id.toUpperCase(), serviceName: id === 'gpu' ? 'Energía' : 'Equipaje',
  billingUnit: 'minute', includedQuantity: 60, excessBlockSize: 15, excessBlockPrice: 20 });
const packageVersion = (patch = {}) => ({ id: 'p1', code: 'BASIC', name: 'Rampa básica', versionNumber: 2, status: 'Published',
  currencyCode: 'USD', basePrice: 500, scope: 'Turnaround', flightDirection: null, periodDays: null,
  validFrom: '2026-10-01', validTo: null, version: 'package-rv-2', components: [component()], ...patch });
const draft = (patch = {}) => ({ id: 'd1', version: 'contract-rv-1', versionStatus: 'Draft', airline: 'Demo Airlines',
  contractCode: 'CTR-1', terms: 'Terms', validFrom: '2026-10-01', validTo: null, currencyCode: 'USD', stations: [], comments: [],
  rates: [{ id: 'r1', serviceName: 'Energía', billingUnit: 'minute', unitPrice: 20, minimumQuantity: 1, isConfirmed: true },
    { id: 'r2', serviceName: 'Equipaje', billingUnit: 'operation', unitPrice: 30, minimumQuantity: 1, isConfirmed: true }], ...patch });
const grants = ['contracts.drafts.read', 'contracts.drafts.update'];
let catalog;
let bound;
let currentDraft;
let failures;
const writes = () => commercialApi.mock.calls.filter(([, options]) => options?.method);
const lastBody = () => JSON.parse(writes().at(-1)[1].body);
const failure = (status, code) => Object.assign(new Error('Private server detail'), { status, code });

function provider(children, permissions = grants) {
  return <DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Employee', department: 'contracts', permissions }}>{children}</DepartmentAccessProvider>;
}
function mount(props = {}, permissions = grants) {
  return render(provider(<ContractPackagesPanel draft={currentDraft} {...props} />, permissions));
}

beforeEach(() => {
  currentDraft = draft(); failures = []; bound = [];
  catalog = [packageVersion(), packageVersion({ id: 'p2', code: 'BAGS', components: [component('bags')] }),
    packageVersion({ id: 'dop', code: 'DOMINICAN', currencyCode: 'DOP' }),
    packageVersion({ id: 'draft', code: 'DRAFT', status: 'Draft' }),
    packageVersion({ id: 'history', code: 'HISTORY', status: 'Superseded', validFrom: '2026-01-01', validTo: '2026-09-30' })];
  commercialApi.mockImplementation(async (path, options) => {
    if (!options?.method) {
      if (path === '/finance/packages') return structuredClone(catalog);
      if (path === '/contracts/drafts/d1/packages') return structuredClone(bound);
      throw new Error(`Unexpected route ${path}`);
    }
    if (failures.length) throw failures.shift();
    const body = JSON.parse(options.body);
    bound = catalog.filter(item => body.packageVersionIds.includes(item.id));
    currentDraft = { ...currentDraft, version: `contract-rv-${writes().length + 1}` };
    return { id: 'd1' };
  });
  getManagedDrafts.mockImplementation(async () => [structuredClone(currentDraft)]);
  updateManagedDraft.mockResolvedValue({ id: 'd1' });
  // The server reports the current version ready for Finance and its scope.
  getContractDraftReadiness.mockImplementation(async () => ({ versionId: 'd1', version: currentDraft.version,
    versionStatus: 'Draft', ready: true, portalAccount: 'Active', issues: [] }));
  getContractDraftScope.mockImplementation(async () => ({ versionId: 'd1', version: currentDraft.version,
    versionStatus: 'Draft', services: [], stations: [] }));
  // Keeps the real parent observers from making network calls during integration tests.
  vi.stubEnv('NEXT_PUBLIC_ELEVANT_API_URL', 'https://api.example.test');
  vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Offline test transport')));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe('ContractPackagesPanel', () => {

  it.each([
    ['2026-12-31', 'Seleccionar GPU v1', 'Seleccionar GPU v2', 'gpu-v1'],
    ['2027-01-01', 'Seleccionar GPU v2', 'Seleccionar GPU v1', 'gpu-v2'],
    ['2027-01-02', 'Seleccionar GPU v2', 'Seleccionar GPU v1', 'gpu-v2'],
  ])('offers the version effective on %s instead of the latest publication status', async (validFrom, eligible, ineligible, id) => {
    currentDraft = draft({ validFrom });
    catalog = [
      packageVersion({ id: 'gpu-v2', code: 'GPU', versionNumber: 2, validFrom: '2027-01-01' }),
      packageVersion({ id: 'gpu-v1', code: 'GPU', versionNumber: 1, status: 'Superseded' }),
    ];
    mount();
    const checkbox = await screen.findByRole('checkbox', { name: eligible });
    expect(screen.queryByRole('checkbox', { name: ineligible })).not.toBeInTheDocument();
    await userEvent.click(checkbox);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.');
    expect(lastBody()).toMatchObject({ expectedVersion: 'contract-rv-1', packageVersionIds: [id] });
  });

  it('keeps a bound historical version eligible before a future replacement without changing its definition', async () => {
    currentDraft = draft({ validFrom: '2026-12-31' });
    const historic = packageVersion({ id: 'gpu-v1', code: 'GPU', versionNumber: 1, status: 'Superseded' });
    bound = [historic];
    catalog = [historic, packageVersion({ id: 'gpu-v2', code: 'GPU', versionNumber: 2, basePrice: 900,
      validFrom: '2027-01-01', components: [component('bags')] }),
    packageVersion({ id: 'bags', code: 'BAGS', components: [component('bags')] })];
    mount();
    const group = await screen.findByRole('group', { name: 'Paquete GPU v1' });
    expect(within(group).getByRole('checkbox')).toBeChecked();
    expect(within(group).getByText(/Histórica · USD 500.00/)).toBeInTheDocument();
    expect(within(group).getByText(/incluye 60 minute; excedente de 15 por USD 20.00/)).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar GPU v2' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar BAGS v2' }));
    expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeEnabled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.');
    expect(lastBody().packageVersionIds).toEqual(['bags', 'gpu-v1']);
  });

  it('keeps replaced bound definitions visible while requiring an explicit eligible replacement', async () => {
    currentDraft = draft({ validFrom: '2027-01-01' });
    const historic = packageVersion({ id: 'gpu-v1', code: 'GPU', versionNumber: 1, status: 'Superseded', basePrice: 450 });
    bound = [historic];
    catalog = [historic, packageVersion({ id: 'gpu-v2', code: 'GPU', versionNumber: 2, basePrice: 700, validFrom: '2027-01-01' })];
    mount();
    const oldBox = await screen.findByRole('checkbox', { name: 'Seleccionar GPU v1' });
    expect(oldBox).toBeChecked();
    expect(within(screen.getByRole('group', { name: 'Paquete GPU v1' })).getByText(/Histórica · USD 450.00/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('no es elegible');
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar GPU v2' }));
    expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeDisabled();
    await userEvent.click(oldBox);
    expect(oldBox).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.');
    expect(lastBody().packageVersionIds).toEqual(['gpu-v2']);
  });

  it.each([
    ['USD', '2026-10-01', '2027-06-30', '2027-06-30', true],
    ['USD', '2026-10-01', '2027-06-30', '2027-07-01', false],
    ['USD', '2026-10-01', '2027-06-30', null, false],
    ['DOP', '2026-10-01', null, null, false],
    ['USD', '2027-01-02', null, null, false],
  ])('checks currency %s and full contract validity (%s/%s/%s)', async (currencyCode, validFrom, validTo, contractEnd, eligible) => {
    currentDraft = draft({ validFrom: '2027-01-01', validTo: contractEnd });
    catalog = [packageVersion({ currencyCode, validFrom, validTo })];
    mount();
    await screen.findByText('Este contrato no tiene paquetes seleccionados.');
    const checkbox = screen.queryByRole('checkbox', { name: 'Seleccionar BASIC v2' });
    if (eligible) expect(checkbox).toBeEnabled();
    else {
      expect(checkbox).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeDisabled();
    }
    expect(writes()).toHaveLength(0);
  });

  it('does not fall back to an older long-lived version when the effective replacement cannot cover the contract', async () => {
    currentDraft = draft({ validFrom: '2027-01-01', validTo: '2027-12-31' });
    catalog = [
      packageVersion({ id: 'gpu-v1', code: 'GPU', versionNumber: 1, status: 'Superseded' }),
      packageVersion({ id: 'gpu-v2', code: 'GPU', versionNumber: 2, validFrom: '2027-01-01', validTo: '2027-06-30' }),
    ];
    mount();
    await screen.findByText('Este contrato no tiene paquetes seleccionados.');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(writes()).toHaveLength(0);
  });

  it('reloads eligibility when the contract start changes without a rowversion change', async () => {
    currentDraft = draft({ validFrom: '2026-12-31' });
    catalog = [
      packageVersion({ id: 'gpu-v1', code: 'GPU', versionNumber: 1, status: 'Superseded' }),
      packageVersion({ id: 'gpu-v2', code: 'GPU', versionNumber: 2, validFrom: '2027-01-01' }),
    ];
    const onDirtyChange = vi.fn();
    const view = mount({ onDirtyChange });
    await screen.findByText('Este contrato no tiene paquetes seleccionados.');
    currentDraft = { ...currentDraft, validFrom: '2027-01-01' };
    view.rerender(provider(<ContractPackagesPanel draft={currentDraft} onDirtyChange={onDirtyChange} />));
    await waitFor(() => expect(commercialApi.mock.calls.filter(([url]) => url === '/finance/packages')).toHaveLength(2));
    expect(await screen.findByRole('checkbox', { name: 'Seleccionar GPU v2' })).not.toBeChecked();
    expect(screen.queryByRole('checkbox', { name: 'Seleccionar GPU v1' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar GPU v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.');
    expect(lastBody().packageVersionIds).toEqual(['gpu-v2']);
  });

  it('selects eligible publications in the contract currency and submits IDs with concurrency', async () => {
    const onSaved = vi.fn(); mount({ onSaved });
    const box = await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' });
    expect(screen.queryByRole('checkbox', { name: /DOMINICAN|DRAFT|HISTORY/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    await userEvent.click(box); await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.');
    expect(writes()[0][0]).toBe('/contracts/drafts/d1/packages'); expect(writes()[0][1].method).toBe('PUT');
    expect(lastBody()).toEqual({ requestId: expect.any(String), expectedVersion: 'contract-rv-1', packageVersionIds: ['p1'] });
    expect(onSaved).toHaveBeenCalledOnce();
    expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeDisabled();
  });

  it('shows immutable selected historical definitions and permits replacing them with a published version', async () => {
    const historic = packageVersion({ id: 'history', code: 'HISTORY', status: 'Superseded', scope: 'Flight', flightDirection: 'Arrival', versionNumber: 1 });
    bound = [historic]; mount();
    const historicBox = await screen.findByRole('checkbox', { name: 'Seleccionar HISTORY v1' });
    expect(historicBox).toBeChecked(); expect(screen.getByText(/Histórica · USD 500.00 · Vuelo · Llegada/)).toBeInTheDocument();
    expect(within(screen.getByRole('group', { name: 'Paquete HISTORY v1' })).getByText(/incluye 60 minute; excedente de 15 por USD 20.00/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeDisabled();
    await userEvent.click(historicBox);
    expect(historicBox).toBeDisabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.'); expect(lastBody().packageVersionIds).toEqual(['p1']);
  });

  it('removes every selected package using an explicit empty selection', async () => {
    bound = [catalog[0]]; mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.'); expect(lastBody().packageVersionIds).toEqual([]);
  });

  it('uses a stable RequestId and expectedVersion on a retry after an uncertain response', async () => {
    failures = [new TypeError('Timeout')]; mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByRole('alert'); const first = lastBody();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await screen.findByText('Paquetes guardados.'); expect(lastBody()).toEqual(first);
  });

  it('shows an actionable server rejection for overlapping service coverage and preserves selection', async () => {
    failures = [failure(400, 'ambiguous_package_coverage')];
    catalog[1] = packageVersion({ id: 'p2', code: 'OVERLAP' }); mount();
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar OVERLAP v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('cubiertos por más de un paquete');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar BASIC v2' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar OVERLAP v2' })).toBeChecked();
    expect(screen.queryByText(/Private server/)).not.toBeInTheDocument();
  });

  it.each(['PendingFinanceApproval', 'Approved'])('renders %s contracts as read only without fetching the selection catalog', async status => {
    currentDraft = draft({ versionStatus: status }); bound = [packageVersion({ scope: 'Period', periodDays: 30 })]; mount();
    await screen.findByText('BASIC · v2 · Rampa básica');
    expect(screen.getByText(/Período · 30 días/)).toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar paquetes' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls.map(([path]) => path)).toEqual(['/contracts/drafts/d1/packages']);
  });

  it.each([false, true])('respects the contract edit permission and parent canEdit=%s', async canEdit => {
    bound = [packageVersion()]; mount({ canEdit }, ['contracts.drafts.read']);
    await screen.findByText('BASIC · v2 · Rampa básica');
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument(); expect(writes()).toHaveLength(0);
  });

  it('requires a contract rowversion before allowing a mutation', async () => {
    currentDraft = draft({ version: '' }); mount();
    expect(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' })).toBeDisabled();
    expect(screen.getByRole('alert')).toHaveTextContent('obtener su versión vigente');
  });

  it('retains bound definitions if the catalog fails and recovers through refresh', async () => {
    bound = [packageVersion()];
    const adapter = commercialApi.getMockImplementation(); let failCatalog = true;
    commercialApi.mockImplementation((path, options) => path === '/finance/packages' && failCatalog
      ? Promise.reject(failure(403)) : adapter(path, options));
    mount(); await screen.findByText('BASIC · v2 · Rampa básica');
    expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso');
    expect(screen.getByRole('button', { name: 'Guardar paquetes' })).toBeDisabled();
    failCatalog = false; await userEvent.click(screen.getByRole('button', { name: 'Actualizar paquetes' }));
    await screen.findByRole('checkbox', { name: 'Seleccionar BAGS v2' });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('recovers from a bound-list error and displays the empty state', async () => {
    commercialApi.mockRejectedValueOnce(failure(500)); mount();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar paquetes' }));
    await screen.findByText('Este contrato no tiene paquetes seleccionados.');
  });

  it('keeps further mutations locked if the parent cannot refresh the saved rowversion', async () => {
    mount({ onSaved: async () => { throw new Error('Refresh failed'); } });
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Los paquetes se guardaron. Actualice el borrador');
    expect(screen.getByRole('button', { name: 'Actualizar paquetes' })).toBeDisabled();
    expect(screen.getByRole('checkbox', { name: 'Seleccionar BAGS v2' })).toBeDisabled();
  });
});

describe('ManagedDraftsPage package integration', () => {
  it('refreshes the parent rowversion after binding and uses it on the next change', async () => {
    render(provider(<ManagedDraftsPage />));
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await userEvent.click(await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' }));
    expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeDisabled();
    expect(screen.getByLabelText('Condiciones del contrato')).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await waitFor(() => expect(getManagedDrafts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Seleccionar BAGS v2' })).toBeEnabled());
    expect(lastBody().expectedVersion).toBe('contract-rv-1');
    expect(screen.getByRole('button', { name: 'Enviar a Finanzas' })).toBeEnabled();
    await userEvent.click(screen.getByRole('checkbox', { name: 'Seleccionar BAGS v2' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar paquetes' }));
    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(lastBody()).toMatchObject({ expectedVersion: 'contract-rv-2', packageVersionIds: ['p1', 'p2'] });
    expect(getManagedDrafts).toHaveBeenCalledTimes(3);
  });

  it('requires saving local contract changes before selecting packages', async () => {
    render(provider(<ManagedDraftsPage />));
    await userEvent.click(await screen.findByRole('button', { name: /Demo Airlines/ }));
    await screen.findByRole('checkbox', { name: 'Seleccionar BASIC v2' });
    await userEvent.type(screen.getByLabelText('Condiciones del contrato'), ' revised');
    expect(screen.getByRole('checkbox', { name: 'Seleccionar BASIC v2' })).toBeDisabled();
    expect(screen.getByText(/Guarde primero los cambios/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(updateManagedDraft).toHaveBeenCalledOnce());
    await waitFor(() => expect(screen.getByRole('checkbox', { name: 'Seleccionar BASIC v2' })).toBeEnabled());
  });
});
