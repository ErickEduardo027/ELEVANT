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
    expect(saveServiceTariffDraft).toHaveBeenCalledWith('tv-2', expect.objectContaining({ expectedVersion: 'v1' }), expect.any(String));
    await screen.findByText('Borrador guardado.');
    await vi.waitFor(() => expect(getServiceTariff).toHaveBeenCalledTimes(2));
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    expect(publishServiceTariff).toHaveBeenCalledWith('tv-2', 'v2', expect.any(String));
    // The save and the publication are two intents, each with its own Idempotency-Key.
    expect(publishServiceTariff.mock.calls[0][2]).not.toBe(saveServiceTariffDraft.mock.calls[0][2]);
  });

  it('publishes again with the same Idempotency-Key after a lost answer, so the API replays it (1-E)', async () => {
    listServiceTariffs.mockResolvedValue([summary('v1')]);
    getServiceTariff.mockResolvedValue(detail('v1'));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    publishServiceTariff.mockRejectedValueOnce(new TypeError('Network down')).mockResolvedValueOnce({ id: 'tv-2' });
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', DepartmentPermissionCodes.finance)}>
      <ServiceTariffsPage /></DepartmentAccessProvider>);
    await screen.findByLabelText('Precio de BAGGAGE');
    const publish = async () => {
      await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
      await userEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Publicar' }));
    };
    await publish();
    expect(await screen.findByRole('alert')).toHaveTextContent(/No se pudo completar la acción/);
    await publish();
    expect(await screen.findByText('Tarifa publicada.')).toBeInTheDocument();
    const [first, second] = publishServiceTariff.mock.calls;
    expect(second).toEqual(first);
    expect(first).toEqual(['tv-2', 'v1', expect.any(String)]);
  });
});

describe('ServiceTariffsPage units and errors (1-E)', () => {
  const renderPage = () => render(<DepartmentAccessProvider observe={false}
    initialAccess={administratorAccess('finance', DepartmentPermissionCodes.finance)}><ServiceTariffsPage /></DepartmentAccessProvider>);

  it('proposes an active unit for a service whose catalog unit is a legacy name', async () => {
    listServiceTariffs.mockResolvedValue([summary('v1')]);
    getServiceTariff.mockResolvedValue(detail('v1'));
    listFinanceServices.mockResolvedValue([{ id: 's-2', code: 'RAMP-CARGO', name: 'Carga y descarga',
      defaultBillingUnit: 'operación', isActive: true }]);
    listBillingUnits.mockResolvedValue([{ code: 'hour', name: 'Hora', isActive: true },
      { code: 'operation', name: 'Operación', isActive: true }]);
    saveServiceTariffDraft.mockResolvedValue({ id: 'tv-2' });
    renderPage();
    await screen.findByLabelText('Precio de BAGGAGE');
    // N36: the list of services to add starts with «Selecciona…».
    expect(within(await screen.findByLabelText('Añadir servicio')).getByRole('option', { name: 'Selecciona…' })).toBeInTheDocument();
    await userEvent.selectOptions(await screen.findByLabelText('Añadir servicio'), 's-2');
    expect(screen.getByLabelText('Unidad de RAMP-CARGO')).toHaveValue('operation');
    expect(within(screen.getByLabelText('Unidad de RAMP-CARGO')).queryByRole('option', { name: /no activa/ })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(saveServiceTariffDraft).toHaveBeenCalledWith('tv-2', expect.objectContaining({
      rates: expect.arrayContaining([expect.objectContaining({ serviceId: 's-2', billingUnit: 'operation' })]) }),
      expect.any(String));
  });

  it.each([
    ['billing_unit_unknown', 400, /La unidad de cobro no existe o está inactiva/],
    ['tariff_start_not_after_current', 409, /debe empezar después de la versión vigente\. Cambia «Vigente desde» y guarda\./],
  ])('explains %s in Spanish instead of the server title', async (code, status, text) => {
    listServiceTariffs.mockResolvedValue([summary('v1')]);
    getServiceTariff.mockResolvedValue(detail('v1'));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    saveServiceTariffDraft.mockRejectedValue(Object.assign(new Error('Invalid finance data.'), { status, code }));
    renderPage();
    await screen.findByLabelText('Precio de BAGGAGE');
    await userEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(await screen.findByText(text)).toBeInTheDocument();
    expect(screen.queryByText(/Invalid finance data/)).not.toBeInTheDocument();
  });

  it('shows a recoverable error instead of an empty tariff when the list does not load', async () => {
    listServiceTariffs.mockRejectedValueOnce(new TypeError('offline')).mockResolvedValue([summary('v1')]);
    getServiceTariff.mockResolvedValue(detail('v1'));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No se pudieron cargar las tarifas. Revisa la conexión e intenta de nuevo.')).toBeInTheDocument();
    expect(screen.queryByText('Sin tarifa base')).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(await screen.findByLabelText('Precio de BAGGAGE')).toBeInTheDocument();
  });

  it('says as tú that the account cannot read the base tariff, without «Reintentar» (N36)', async () => {
    listServiceTariffs.mockRejectedValueOnce(Object.assign(new Error('Forbidden'), { status: 403 }));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([]);
    renderPage();
    expect(await screen.findByText('No tienes permiso para consultar la tarifa base.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reintentar' })).not.toBeInTheDocument();
  });
});

describe('ServiceTariffsPage dates (N36)', () => {
  it('lists its versions dd/mm/aaaa and writes the start in full inside its sentences', async () => {
    const published = { ...summary('v0'), id: 'tv-1', status: 'Published', validFrom: '2026-11-01', validTo: '2026-12-31',
      publishedBy: 'Finanzas', publishedAt: '2026-10-01T12:00:00Z' };
    listServiceTariffs.mockResolvedValue([summary('v1'), published]);
    getServiceTariff.mockResolvedValue(detail('v1'));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('finance', DepartmentPermissionCodes.finance)}>
      <ServiceTariffsPage /></DepartmentAccessProvider>);
    await screen.findByLabelText('Precio de BAGGAGE');
    expect(screen.getByText('USD · desde 08/10/2026')).toBeInTheDocument();
    expect(screen.getByText('USD · desde 01/11/2026')).toBeInTheDocument();
    expect(screen.getByText(/ · hasta 31\/12\/2026 · Finanzas$/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Publicar' }));
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveTextContent('La versión pasará a ser la vigente en USD desde el 8 de octubre de 2026; la anterior '
      + 'quedará como histórica. Guarda antes los cambios pendientes.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Publicar' }));
    expect(await screen.findByText('La vigencia debe empezar después del 1 de noviembre de 2026, inicio de la última versión '
      + 'publicada. Cambia «Vigente desde» y guarda.')).toBeInTheDocument();
    expect(publishServiceTariff).not.toHaveBeenCalled();
    expect(screen.queryByText(/2026-10-08|2026-11-01|2026-12-31/)).not.toBeInTheDocument();
  });
});

describe('ServiceTariffsPage names and read-only versions (N34)', () => {
  const renderPage = (codes = DepartmentPermissionCodes.finance) => render(<DepartmentAccessProvider observe={false}
    initialAccess={administratorAccess('finance', codes)}><ServiceTariffsPage /></DepartmentAccessProvider>);
  const facts = () => Object.fromEntries(screen.getAllByRole('term')
    .map(term => [term.textContent, term.nextElementSibling.textContent]));
  const published = { ...summary('v0'), id: 'tv-1', status: 'Published', validFrom: '2026-11-01', validTo: '2026-12-31',
    note: 'Temporada alta', publishedBy: 'Finanzas', publishedAt: '2026-10-01T12:00:00Z' };
  const named = (version, tariff) => ({ ...detail(version), ...tariff,
    rates: [{ ...detail(version).rates[0], serviceName: 'Manejo de equipaje' }] });

  it('shows a published version as text, not as fields that look editable, and names each service first', async () => {
    listServiceTariffs.mockResolvedValue([published]);
    getServiceTariff.mockResolvedValue(named('v0', { summary: published }));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    renderPage();
    const service = (await screen.findByText('Manejo de equipaje', { selector: 'strong' })).closest('td');
    expect(service).toHaveTextContent(/^Manejo de equipaje\s*BAGGAGE$/);
    expect(within(service.closest('tr')).getAllByRole('cell').slice(1).map(cell => cell.textContent))
      .toEqual(['Todas', 'Por operación', 'USD 130.00', '1']);
    expect(facts()).toEqual({ 'Vigente desde': '01/11/2026', Hasta: '31/12/2026', Nota: 'Temporada alta' });
    for (const field of ['Vigente desde', 'Hasta (opcional)', 'Nota'])
      expect(screen.queryByLabelText(field)).not.toBeInTheDocument();
  });

  it('shows a draft as text to an account that cannot edit it, and as fields to one that can', async () => {
    listServiceTariffs.mockResolvedValue([summary('v1')]);
    getServiceTariff.mockResolvedValue(named('v1'));
    listFinanceServices.mockResolvedValue([]);
    listBillingUnits.mockResolvedValue([{ code: 'operation', name: 'Operación', isActive: true }]);
    const { unmount } = renderPage(['finance.tariffs.read']);
    await screen.findByText('Manejo de equipaje', { selector: 'strong' });
    expect(facts()).toEqual({ 'Vigente desde': '08/10/2026', Hasta: 'Sin fecha de fin', Nota: 'Sin nota' });
    expect(screen.queryByLabelText('Vigente desde')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Precio de BAGGAGE')).not.toBeInTheDocument();
    unmount();
    renderPage();
    expect(await screen.findByLabelText('Vigente desde')).toHaveValue('2026-10-08');
    expect(screen.getByLabelText('Hasta (opcional)')).toHaveValue('');
    expect(screen.getByLabelText('Nota')).toHaveValue('');
    expect(screen.queryByRole('term')).not.toBeInTheDocument();
    expect(screen.getByText('Manejo de equipaje', { selector: 'strong' }).closest('td'))
      .toHaveTextContent(/^Manejo de equipaje\s*BAGGAGE$/);
  });
});

describe('latestPublishedStart', () => {
  it('ignores drafts and returns the latest published or superseded start', async () => {
    const { latestPublishedStart } = await import('./ServiceTariffsPage');
    expect(latestPublishedStart([{ status: 'Draft', validFrom: '2026-12-01' }, { status: 'Superseded', validFrom: '2026-01-01' },
      { status: 'Published', validFrom: '2026-10-09' }])).toBe('2026-10-09');
    expect(latestPublishedStart([{ status: 'Draft', validFrom: '2026-12-01' }])).toBeNull();
  });
});
