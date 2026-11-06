import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PackagesPage from './PackagesPage';
import { DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { commercialApi, discardFinancePackage, retireFinancePackage } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', async importOriginal => ({
  ...(await importOriginal()), commercialApi: vi.fn(), discardFinancePackage: vi.fn(), retireFinancePackage: vi.fn(),
}));

const component = { serviceId: 'gpu', serviceCode: 'GPU', serviceName: 'Energía', billingUnit: 'minute',
  includedQuantity: 60, excessBlockSize: 15, excessBlockPrice: 20 };
const packageVersion = (patch = {}) => ({ id: 'p1', code: 'BASIC', name: 'Rampa básica', versionNumber: 1, status: 'Draft',
  currencyCode: 'USD', basePrice: 500, scope: 'Turnaround', flightDirection: null, periodDays: null,
  validFrom: '2026-10-01', validTo: null, version: 'rv-1', components: [{ ...component }], ...patch });
const services = [{ id: 'gpu', code: 'GPU', name: 'Energía', defaultBillingUnit: 'minute', isActive: true },
  { id: 'bags', code: 'BAGS', name: 'Equipaje', defaultBillingUnit: 'operation', isActive: true },
  { id: 'old', code: 'OLD', name: 'Inactivo', isActive: false }];
const units = [{ code: 'minute', name: 'Minuto', isActive: true }, { code: 'operation', name: 'Operación', isActive: true }];
const permissions = ['finance.packages.read', 'finance.packages.create', 'finance.packages.update', 'finance.packages.publish'];
let packages;
let writeFailures;
let revision;

const writes = () => commercialApi.mock.calls.filter(([, options]) => options?.method);
const lastBody = () => JSON.parse(writes().at(-1)[1].body);
const failure = (status, code) => Object.assign(new Error('Private server exception text'), { status, code });

function mount(grants = permissions) {
  return render(<DepartmentAccessProvider observe={false} initialAccess={{ kind: 'Employee', department: 'finance', permissions: grants }}>
    <PackagesPage /></DepartmentAccessProvider>);
}

beforeEach(() => {
  packages = [packageVersion()]; writeFailures = []; revision = 1;
  commercialApi.mockImplementation(async (path, options) => {
    if (!options?.method) {
      if (path === '/finance/packages') return structuredClone(packages);
      if (path === '/finance/services') return services;
      if (path === '/finance/billing-units') return units;
    }
    if (writeFailures.length) throw writeFailures.shift();
    const body = JSON.parse(options.body);
    if (path.endsWith('/publish')) {
      const target = packages.find(item => path === `/finance/packages/${item.id}/publish`);
      packages = packages.map(item => ({ ...item, status: item.id === target.id ? 'Published'
        : item.code === target.code && item.status === 'Published' ? 'Superseded' : item.status,
      version: item.id === target.id ? `rv-${++revision}` : item.version }));
      return { id: target.id };
    }
    const id = options.method === 'POST' ? `p${packages.length + 1}` : path.split('/').at(-1);
    const existing = packages.find(item => item.id === id);
    const result = packageVersion({ ...body, id, version: `rv-${++revision}`,
      versionNumber: existing?.versionNumber ?? Math.max(0, ...packages.filter(item => item.code === body.code).map(item => item.versionNumber)) + 1,
      components: body.components.map(value => ({ ...component, ...value })) });
    packages = [...packages.filter(item => item.id !== id), result];
    return { id };
  });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

async function createForm(scope = 'Turnaround') {
  await screen.findByLabelText('Nombre');
  await userEvent.click(screen.getByRole('button', { name: 'Nuevo paquete' }));
  await userEvent.type(screen.getByLabelText('Código'), 'FLIGHT-1');
  await userEvent.type(screen.getByLabelText('Nombre'), 'Cobertura de vuelo');
  await userEvent.type(screen.getByLabelText('Precio base'), '600.25');
  await userEvent.selectOptions(screen.getByLabelText('Alcance'), scope);
  await userEvent.selectOptions(screen.getByLabelText('Añadir servicio'), 'gpu');
}

describe('PackagesPage through the real package and catalog adapters', () => {
  it.each(['Arrival', 'Departure'])('creates a flight draft with explicit %s direction and numeric components', async direction => {
    mount(); await createForm('Flight');
    await userEvent.selectOptions(screen.getByLabelText('Moneda'), 'DOP');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(writes()).toHaveLength(0);
    expect(screen.getByLabelText('Dirección del vuelo')).toBeInvalid();
    await userEvent.selectOptions(screen.getByLabelText('Dirección del vuelo'), direction);
    await userEvent.clear(screen.getByLabelText('Cantidad incluida de GPU'));
    await userEvent.type(screen.getByLabelText('Cantidad incluida de GPU'), '60');
    await userEvent.clear(screen.getByLabelText('Tamaño del bloque excedente de GPU'));
    await userEvent.type(screen.getByLabelText('Tamaño del bloque excedente de GPU'), '15');
    await userEvent.clear(screen.getByLabelText('Precio del bloque excedente de GPU'));
    await userEvent.type(screen.getByLabelText('Precio del bloque excedente de GPU'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(writes()[0][0]).toBe('/finance/packages');
    expect(writes()[0][1].method).toBe('POST');
    expect(lastBody()).toEqual({ requestId: expect.any(String), expectedVersion: null, code: 'FLIGHT-1', name: 'Cobertura de vuelo',
      currencyCode: 'DOP', basePrice: 600.25, scope: 'Flight', flightDirection: direction, periodDays: null,
      validFrom: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/), validTo: null,
      components: [{ serviceId: 'gpu', billingUnit: 'minute', includedQuantity: 60, excessBlockSize: 15, excessBlockPrice: 20 }] });
  });

  it.each(['0', '367', '1.5'])('rejects an invalid period of %s days before HTTP', async days => {
    mount(); await createForm('Period');
    await userEvent.type(screen.getByLabelText('Días del período'), days);
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(screen.getByLabelText('Días del período')).toBeInvalid(); expect(writes()).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Días del período'));
    await userEvent.type(screen.getByLabelText('Días del período'), '366');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(lastBody()).toMatchObject({ scope: 'Period', periodDays: 366, flightDirection: null });
  });

  it('clears scope-specific values when changing to turnaround', async () => {
    mount(); await createForm('Flight');
    await userEvent.selectOptions(screen.getByLabelText('Dirección del vuelo'), 'Arrival');
    await userEvent.selectOptions(screen.getByLabelText('Alcance'), 'Period');
    expect(screen.queryByLabelText('Dirección del vuelo')).not.toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('Días del período'), '5');
    await userEvent.selectOptions(screen.getByLabelText('Alcance'), 'Turnaround');
    expect(screen.queryByLabelText('Días del período')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(lastBody()).toMatchObject({ scope: 'Turnaround', periodDays: null, flightDirection: null });
  });

  it('requires a component and prevents duplicate services, invalid blocks and inverted dates', async () => {
    mount(); await createForm();
    expect(within(screen.getByLabelText('Añadir servicio')).queryByRole('option', { name: /GPU/ })).not.toBeInTheDocument();
    expect(within(screen.getByLabelText('Añadir servicio')).queryByRole('option', { name: /OLD/ })).not.toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText('Tamaño del bloque excedente de GPU'));
    await userEvent.type(screen.getByLabelText('Tamaño del bloque excedente de GPU'), '0');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(screen.getByLabelText('Tamaño del bloque excedente de GPU')).toBeInvalid(); expect(writes()).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Tamaño del bloque excedente de GPU'));
    await userEvent.type(screen.getByLabelText('Tamaño del bloque excedente de GPU'), '1');
    await userEvent.type(screen.getByLabelText('Hasta (opcional)'), '2025-01-01');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(screen.getByLabelText('Hasta (opcional)')).toBeInvalid(); expect(writes()).toHaveLength(0);
    await userEvent.clear(screen.getByLabelText('Hasta (opcional)'));
    await userEvent.click(screen.getByRole('button', { name: 'Quitar GPU' }));
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Añada al menos un servicio'); expect(writes()).toHaveLength(0);
  });

  it('locks identity, saves against rowversion, then publishes with the refreshed rowversion', async () => {
    mount(); await screen.findByLabelText('Nombre');
    expect(screen.getByLabelText('Código')).toBeDisabled(); expect(screen.getByLabelText('Moneda')).toBeDisabled();
    await userEvent.clear(screen.getByLabelText('Precio base')); await userEvent.type(screen.getByLabelText('Precio base'), '540');
    expect(screen.getByRole('button', { name: 'Publicar' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(lastBody()).toMatchObject({ expectedVersion: 'rv-1', basePrice: 540 });
    expect(writes()[0][1].method).toBe('PUT');
    const saveId = lastBody().requestId;
    await userEvent.click(await screen.findByRole('button', { name: 'Publicar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    await screen.findByText('Paquete publicado.');
    expect(writes().at(-1)[0]).toBe('/finance/packages/p1/publish');
    expect(lastBody()).toEqual({ expectedVersion: 'rv-2', requestId: expect.any(String) });
    expect(lastBody().requestId).not.toBe(saveId);
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).not.toBeInTheDocument();
  });

  it.each(['Published', 'Superseded'])('preserves %s history and copies into a new draft under the same code', async status => {
    packages = [packageVersion({ status })]; mount(); await screen.findByLabelText('Nombre');
    expect(screen.getByLabelText('Precio base')).toBeDisabled(); expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Publicar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /eliminar|descartar/i })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Nueva versión' }));
    expect(screen.getByLabelText('Código')).toHaveValue('BASIC'); expect(screen.getByLabelText('Código')).toBeDisabled();
    expect(screen.getByLabelText('Moneda')).toBeDisabled();
    await userEvent.type(screen.getByLabelText('Nombre'), ' revisada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(writes()[0][1].method).toBe('POST'); expect(lastBody()).toMatchObject({ code: 'BASIC', expectedVersion: null });
    expect(packages.find(item => item.id === 'p1').status).toBe(status);
    expect(await screen.findByRole('button', { name: /BASIC · v2/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /BASIC · v1/ })).toBeInTheDocument();
  });

  it('retries an uncertain save with the same request and starts a new command after an edit', async () => {
    mount(); await screen.findByLabelText('Nombre');
    await userEvent.type(screen.getByLabelText('Nombre'), ' nueva');
    writeFailures = [new TypeError('Network down'), new TypeError('Network down')];
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByRole('alert'); const first = lastBody();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await waitFor(() => expect(writes()).toHaveLength(2)); expect(lastBody()).toEqual(first);
    await userEvent.type(screen.getByLabelText('Nombre'), ' editada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.');
    expect(lastBody().requestId).not.toBe(first.requestId);
  });

  it('retries publishing with a stable command ID', async () => {
    mount(); await screen.findByLabelText('Nombre'); writeFailures = [new TypeError('Timeout')];
    async function publish() {
      await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
      await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    }
    await publish(); await screen.findByRole('alert'); const first = lastBody();
    await publish(); await screen.findByText('Paquete publicado.'); expect(lastBody()).toEqual(first);
  });

  it('keeps edits after a conflict and requires an explicit refresh before using a new version', async () => {
    mount(); await screen.findByLabelText('Nombre');
    await userEvent.type(screen.getByLabelText('Nombre'), ' local'); writeFailures = [failure(409, 'version_conflict')];
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La versión cambió');
    expect(screen.getByLabelText('Nombre')).toHaveValue('Rampa básica local');
    expect(screen.queryByText(/Private server/)).not.toBeInTheDocument();
    packages = [packageVersion({ version: 'rv-9', name: 'Remota' })];
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    expect(await screen.findByLabelText('Nombre')).toHaveValue('Remota');
    await userEvent.type(screen.getByLabelText('Nombre'), ' revisada');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar borrador' }));
    await screen.findByText('Borrador de paquete guardado.'); expect(lastBody().expectedVersion).toBe('rv-9');
  });

  it('shows empty and recoverable loading errors without exposing server text', async () => {
    packages = [];
    commercialApi.mockRejectedValueOnce(failure(500)); mount();
    expect(screen.getByText('Cargando paquetes…')).toBeInTheDocument();
    expect(await screen.findByRole('alert')).toHaveTextContent('No se pudo completar');
    await userEvent.click(screen.getByRole('button', { name: 'Actualizar' }));
    await screen.findByText('Aún no hay paquetes definidos.');
  });

  it('allows reading without management access and does not fetch editable catalogs', async () => {
    mount(['finance.packages.read']); await screen.findByLabelText('Nombre');
    expect(screen.getByLabelText('Nombre')).toBeDisabled();
    expect(screen.queryByRole('button', { name: 'Nuevo paquete' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Guardar borrador' })).not.toBeInTheDocument();
    expect(commercialApi.mock.calls.map(([path]) => path)).toEqual(['/finance/packages']);
  });

  it('discards a draft with a reason and retries an uncertain answer with the same key (1-N27)', async () => {
    discardFinancePackage.mockRejectedValueOnce(new TypeError('Network down')).mockImplementation(async id => {
      packages = packages.map(item => (item.id === id ? { ...item, status: 'Discarded', version: 'rv-9' } : item));
      return { id };
    });
    mount([...permissions, 'finance.packages.delete']); await screen.findByLabelText('Nombre');
    expect(screen.queryByRole('button', { name: 'Retirar paquete' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Descartar borrador' }));
    const dialog = screen.getByRole('alertdialog', { name: /Descartar el borrador BASIC/ });
    expect(within(dialog).getByText(/Se conserva como descartado en el historial/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar borrador' }));
    expect(within(dialog).getByRole('alert')).toHaveTextContent('Escriba el motivo');
    expect(discardFinancePackage).not.toHaveBeenCalled();
    await userEvent.type(within(dialog).getByLabelText('Motivo'), '  Borrador duplicado por error.  ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar borrador' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('No se pudo completar');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Descartar borrador' }));
    await screen.findByText('Borrador descartado. Se conserva en el historial.');
    const [first, second] = discardFinancePackage.mock.calls;
    expect(first.slice(0, 2)).toEqual(['p1', { expectedVersion: 'rv-1', reason: 'Borrador duplicado por error.' }]);
    expect(second[2]).toBe(first[2]);
    expect(within(screen.getByRole('button', { name: /BASIC · v1/ })).getByText('Descartada')).toBeInTheDocument();
    expect(screen.getByText(/Borrador descartado: se conserva en el historial/)).toBeInTheDocument();
  });

  it('retires the published version, explaining a stale version by its code and re-reading the list', async () => {
    packages = [packageVersion({ status: 'Published' })];
    retireFinancePackage.mockRejectedValueOnce(failure(409, 'version_conflict')).mockImplementation(async id => {
      packages = packages.map(item => (item.id === id ? { ...item, status: 'Retired', version: 'rv-9' } : item));
      return { id };
    });
    mount([...permissions, 'finance.packages.retire']); await screen.findByLabelText('Nombre');
    await userEvent.click(screen.getByRole('button', { name: 'Retirar paquete' }));
    let dialog = screen.getByRole('alertdialog', { name: /Retirar BASIC · versión 1/ });
    expect(within(dialog).getByText(/los contratos ya aprobados conservan el paquete/i)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Precio publicado por error.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar paquete' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('La versión cambió');
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(screen.queryByText(/Private server/)).not.toBeInTheDocument();
    await userEvent.click(await screen.findByRole('button', { name: 'Retirar paquete' }));
    dialog = screen.getByRole('alertdialog', { name: /Retirar BASIC · versión 1/ });
    await userEvent.type(within(dialog).getByLabelText('Motivo'), 'Precio publicado por error.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Retirar paquete' }));
    await screen.findByText('Paquete retirado. Contratos ya no puede asignarlo.');
    expect(within(screen.getByRole('button', { name: /BASIC · v1/ })).getByText('Retirada')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retirar paquete' })).not.toBeInTheDocument();
    expect(retireFinancePackage.mock.calls[1][1]).toEqual({ expectedVersion: 'rv-1', reason: 'Precio publicado por error.' });
  });

  it('names scopes and statuses in Spanish and proposes a valid unit for a legacy service unit (1-E, 1-N26)', async () => {
    packages = [packageVersion({ status: 'Superseded' })];
    services.push({ id: 'legacy', code: 'LEGACY', name: 'Heredado', defaultBillingUnit: 'Operación', isActive: true });
    try {
      mount(); await screen.findByLabelText('Nombre');
      expect(within(screen.getByRole('button', { name: /BASIC · v1/ })).getByText('Reemplazada')).toBeInTheDocument();
      expect(within(screen.getByLabelText('Alcance')).getAllByRole('option').map(option => option.textContent))
        .toEqual(['Por escala', 'Por vuelo', 'Por período']);
      await userEvent.click(screen.getByRole('button', { name: 'Nuevo paquete' }));
      await userEvent.selectOptions(screen.getByLabelText('Añadir servicio'), 'legacy');
      expect(screen.getByLabelText('Unidad de LEGACY')).toHaveValue('operation');
    } finally { services.pop(); }
  });

  it('does not request data without read permission', () => {
    mount([]); expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso'); expect(commercialApi).not.toHaveBeenCalled();
  });
});
