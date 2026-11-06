import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialCatalogPage from './CommercialCatalogPage';
import { getManagedServices, saveManagedService, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedServices: vi.fn(), saveManagedService: vi.fn(), uploadCommercialMedia: vi.fn(),
  commercialMediaUrl: path => path,
  deleteManagedService: vi.fn(),
}));
vi.mock('../../../services/financeBookService', () => ({
  listBillingUnits: vi.fn().mockResolvedValue([
    { id: 'u1', code: 'operation', name: 'Operación', quantityScale: 0, isActive: true, version: 'v1' },
    { id: 'u2', code: 'hour', name: 'Hora', quantityScale: 2, isActive: true, version: 'v2' },
    { id: 'u3', code: 'ton', name: 'Tonelada', quantityScale: 3, isActive: true, version: 'v3' },
    { id: 'u4', code: 'old', name: 'Antigua', quantityScale: 0, isActive: false, version: 'v4' },
  ]),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });

const makeService = number => ({
  id: `service-${number}`, code: `SERVICE-${number}`, name: `Servicio ${number}`,
  description: `Descripción ${number}`, billingUnit: 'operación', imageUrl: null,
  videoUrl: null, displayOrder: number, isPublic: true, isActive: true,
  version: `version-${number}`,
});

const cardNames = () => screen.getAllByRole('article').map(card => card.querySelector('strong').textContent);
const orderBadges = () => screen.getAllByTitle('Número de orden asignado por el sistema').map(badge => badge.textContent);

async function openCreateForm(user) {
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));
  return screen.getByRole('dialog', { name: 'Nuevo servicio' });
}

async function fill(user, field, text) {
  await user.click(field);
  await user.paste(text);
}

async function pick(user, comboboxName, optionName) {
  await user.click(screen.getByRole('combobox', { name: comboboxName }));
  await user.click(screen.getByRole('option', { name: optionName }));
}

it('shows twelve services per page with the visible range and bounded navigation', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 27 }, (_, index) => makeService(index + 1));
  services[1].isPublic = false;
  getManagedServices.mockResolvedValue(services);

  render(<CommercialCatalogPage />);
  expect(await screen.findByText('Servicio 1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(12);
  expect(screen.getByText('Mostrando 1–12 de 27 servicios')).toBeInTheDocument();
  expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.getByText('Servicio 12')).toBeInTheDocument();
  expect(screen.queryByText('Servicio 13')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Mostrando 13–24 de 27 servicios')).toBeInTheDocument();
  expect(cardNames()[0]).toBe('Servicio 13');
  expect(orderBadges()[0]).toBe('Número de orden N.º 13');
  expect(screen.queryByText('Servicio 1')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(3);
  expect(screen.getByText('Mostrando 25–27 de 27 servicios')).toBeInTheDocument();
  expect(screen.getByText('Página 3 de 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('shows an empty catalog and keeps a single page for exactly twelve services', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 12 }, (_, index) => makeService(index + 1));
  getManagedServices.mockResolvedValueOnce([]).mockResolvedValue(services);

  render(<CommercialCatalogPage />);
  expect(await screen.findByText('No hay servicios en el catálogo.')).toBeInTheDocument();
  expect(screen.getByText('Mostrando 0–0 de 0 servicios')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Actualizar' }));

  expect(await screen.findByText('Servicio 12')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(12);
  expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('returns to the last available page when a refresh reduces the catalog', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 27 }, (_, index) => makeService(index + 1));
  getManagedServices.mockResolvedValueOnce(services).mockResolvedValue(services.slice(0, 8));

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 1');
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  await user.click(screen.getByRole('button', { name: 'Actualizar' }));

  expect(await screen.findByText('Servicio 1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(8);
  expect(screen.getByText('Mostrando 1–8 de 8 servicios')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('lists services by display order with a sequential order number', async () => {
  getManagedServices.mockResolvedValue([
    { ...makeService(1), name: 'Remolque de aeronaves', displayOrder: 7 },
    { ...makeService(2), name: 'Aire acondicionado', displayOrder: 3 },
    { ...makeService(3), name: 'Carga y descarga', displayOrder: 0 },
    { ...makeService(4), name: 'Baggage handling', displayOrder: 0 },
  ]);

  render(<CommercialCatalogPage />);
  await screen.findAllByRole('article');
  expect(cardNames()).toEqual(['Baggage handling', 'Carga y descarga', 'Aire acondicionado', 'Remolque de aeronaves']);
  expect(orderBadges()).toEqual(['Número de orden N.º 1', 'Número de orden N.º 2', 'Número de orden N.º 3', 'Número de orden N.º 4']);
});

it('creates a catalog service with its own code at the end of the order', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 12 }, (_, index) => makeService(index + 1));
  services[4].displayOrder = 40;
  const created = { ...makeService(13), name: 'Carga y descarga', code: 'RAMP-CARGO', displayOrder: 41 };
  getManagedServices.mockResolvedValueOnce(services).mockResolvedValueOnce([...services, created]);
  saveManagedService.mockResolvedValue({ id: created.id });

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 1');
  const dialog = await openCreateForm(user);
  expect(within(dialog).queryByRole('spinbutton')).not.toBeInTheDocument();
  expect(within(dialog).getByText('N.º 13')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Código/)).toHaveAttribute('readonly');

  await pick(user, /Nombre del servicio/, /Carga y descarga/);
  expect(screen.getByLabelText(/^Código/)).toHaveValue('RAMP-CARGO');
  await pick(user, /Unidad de cobro/, /Por tonelada/);
  await fill(user, screen.getByLabelText(/Descripción/), '  Atención de carga  ');
  await user.click(screen.getByRole('checkbox', { name: 'Visible al público' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  await waitFor(() => expect(saveManagedService).toHaveBeenCalledWith(null, expect.objectContaining({
    code: 'RAMP-CARGO', name: 'Carga y descarga', description: 'Atención de carga',
    // 1-E: the catalog stores the unit code of «Unidades de cobro», not its name.
    billingUnit: 'ton', displayOrder: 41, isPublic: false,
  })));
  expect(await screen.findByText(/Servicio guardado como oculto/)).toBeInTheDocument();
  expect(screen.getByText('Página 2 de 2')).toBeInTheDocument();
  expect(cardNames()).toEqual(['Carga y descarga']);
  expect(orderBadges()).toEqual(['Número de orden N.º 13']);
});

it('creates a new service with «Otro» as its name and a unit maintained by Finance', async () => {
  const user = userEvent.setup();
  getManagedServices.mockResolvedValue([makeService(1)]);
  saveManagedService.mockResolvedValue({ id: 'service-2' });

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 1');
  await openCreateForm(user);
  expect(screen.queryByLabelText(/Nombre personalizado/)).not.toBeInTheDocument();
  await pick(user, /Nombre del servicio/, /^Otro/);
  await fill(user, screen.getByLabelText(/Nombre personalizado/), '  Asistencia   especial ');
  await fill(user, screen.getByLabelText(/Código del nuevo servicio/), 'sa');
  await pick(user, /Unidad de cobro/, /Por hora/);
  await fill(user, screen.getByLabelText(/Descripción/), 'Acompañamiento');
  await user.click(screen.getByRole('checkbox', { name: 'Visible al público' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  await waitFor(() => expect(saveManagedService).toHaveBeenCalledWith(null, expect.objectContaining({
    code: 'SA', name: 'Asistencia especial', billingUnit: 'hour', displayOrder: 2,
  })));
});

it('offers services created earlier with their own code and billing unit', async () => {
  const user = userEvent.setup();
  const created = { ...makeService(2), name: 'Asistencia especial', code: 'SA', billingUnit: 'turno', displayOrder: 2 };
  getManagedServices.mockResolvedValue([makeService(1), created]);

  render(<CommercialCatalogPage />);
  await screen.findAllByRole('article');
  await openCreateForm(user);
  await pick(user, /Nombre del servicio/, /Asistencia especial/);
  expect(screen.getByLabelText(/^Código/)).toHaveValue('SA');
  expect(within(screen.getByRole('dialog', { name: 'Nuevo servicio' })).getByRole('status'))
    .toHaveTextContent('Asistencia especial ya está en el catálogo con el número de orden 2');
  await user.click(screen.getByRole('combobox', { name: /Unidad de cobro/ }));
  expect(screen.getByRole('option', { name: /Por hora/ })).toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /turno/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /antigua/ })).not.toBeInTheDocument();
  expect(screen.queryByRole('option', { name: /^Otro/ })).not.toBeInTheDocument();
});

it('blocks duplicates and opens the existing service for editing instead', async () => {
  const user = userEvent.setup();
  const existing = { ...makeService(1), code: 'RAMP-TOW', name: 'Remolque de aeronaves' };
  getManagedServices.mockResolvedValue([existing]);

  render(<CommercialCatalogPage />);
  await screen.findAllByRole('article');
  await openCreateForm(user);
  await pick(user, /Nombre del servicio/, /Remolque de aeronaves/);
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(screen.getByText('Ya existe un servicio con ese nombre y código.')).toBeInTheDocument();
  expect(saveManagedService).not.toHaveBeenCalled();

  await user.click(screen.getByRole('button', { name: 'Editar este servicio' }));
  expect(screen.getByRole('dialog', { name: 'Editar servicio' })).toBeInTheDocument();
  expect(screen.getByLabelText(/Nombre del servicio/)).toHaveValue('Remolque de aeronaves');
});

it('explains missing and invalid fields without calling the API', async () => {
  const user = userEvent.setup();
  getManagedServices.mockResolvedValue([{ ...makeService(1), code: 'RAMP-TOW', name: 'Remolque de aeronaves' }]);

  render(<CommercialCatalogPage />);
  await screen.findAllByRole('article');
  await openCreateForm(user);
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  expect(screen.getByText('Selecciona un servicio.')).toBeInTheDocument();
  expect(screen.getByText('Selecciona cómo se cobra el servicio.')).toBeInTheDocument();
  expect(screen.getByText('Escribe una descripción breve del servicio.')).toBeInTheDocument();
  expect(screen.getByRole('combobox', { name: /Nombre del servicio/ })).toHaveFocus();
  expect(screen.getByRole('combobox', { name: /Nombre del servicio/ })).toHaveAttribute('aria-invalid', 'true');

  await pick(user, /Nombre del servicio/, /^Otro/);
  await pick(user, /Unidad de cobro/, /Por hora/);
  await fill(user, screen.getByLabelText(/Código del nuevo servicio/), 'ramp tow');
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(screen.getByText('Escribe el nombre del servicio personalizado.')).toBeInTheDocument();
  expect(screen.getByText(/Usa solo letras de la A a la Z/)).toBeInTheDocument();
  expect(screen.getByText(/Para publicarlo agregue una foto real del servicio/)).toBeInTheDocument();

  await fill(user, screen.getByLabelText(/Nombre personalizado/), 'Remolque');
  await user.clear(screen.getByLabelText(/Código del nuevo servicio/));
  await fill(user, screen.getByLabelText(/Código del nuevo servicio/), 'ramp-tow');
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(screen.getByText('El código RAMP-TOW ya pertenece a «Remolque de aeronaves».')).toBeInTheDocument();
  expect(saveManagedService).not.toHaveBeenCalled();
});

it('shows a clear message when the API rejects a duplicate code', async () => {
  const user = userEvent.setup();
  getManagedServices.mockResolvedValue([]);
  saveManagedService.mockRejectedValue(Object.assign(new Error('Service changed; reload and retry.'), { status: 409 }));

  render(<CommercialCatalogPage />);
  await screen.findByText('No hay servicios en el catálogo.');
  await openCreateForm(user);
  await pick(user, /Nombre del servicio/, /Escaleras móviles/);
  await pick(user, /Unidad de cobro/, /Por operación/);
  await fill(user, screen.getByLabelText(/Descripción/), 'Escaleras');
  await user.click(screen.getByRole('checkbox', { name: 'Visible al público' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  expect(await screen.findByText(/ya existe un servicio con ese código o el catálogo cambió/)).toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Nuevo servicio' })).toBeInTheDocument();
});

it('edits name and billing unit while keeping code and order', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 3 }, (_, index) => makeService(index + 1));
  services[1] = { ...services[1], billingUnit: 'turno', imageUrl: '/assets/services/aircraft-towing.webp',
    description: 'Remolque de aeronaves entre posiciones y hangar' };
  getManagedServices.mockResolvedValueOnce(services).mockResolvedValueOnce([
    services[0], { ...services[1], name: 'Remolque' }, services[2],
  ]);
  saveManagedService.mockResolvedValue({ id: 'service-2' });

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 2');
  await user.click(screen.getAllByRole('button', { name: 'Editar' })[1]);
  const dialog = screen.getByRole('dialog', { name: 'Editar servicio' });
  expect(within(dialog).getByText('N.º 2')).toBeInTheDocument();
  expect(screen.getByLabelText(/^Código/)).toHaveAttribute('readonly');
  expect(screen.getByRole('combobox', { name: /Unidad de cobro/ })).toHaveValue('Por turno');
  await user.clear(screen.getByLabelText(/Nombre del servicio/));
  await fill(user, screen.getByLabelText(/Nombre del servicio/), 'Remolque');
  await pick(user, /Unidad de cobro/, /Por hora/);
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  await waitFor(() => expect(saveManagedService).toHaveBeenCalledWith('service-2', expect.objectContaining({
    code: 'SERVICE-2', name: 'Remolque', billingUnit: 'hour', displayOrder: 2, version: 'version-2',
  })));
  await screen.findByText('Servicio actualizado. El catálogo público se refrescará.');
  expect(cardNames()).toEqual(['Servicio 1', 'Remolque', 'Servicio 3']);
});

it('edits a service in a right drawer and uploads its selected image before saving', async () => {
  const user = userEvent.setup();
  const service = { id: 'service-1', code: 'RAMP-CARGO', name: 'Carga y descarga',
    description: 'Atención de carga y descarga de aeronaves', billingUnit: 'operación',
    imageUrl: '/assets/services/cargo-loading.webp', videoUrl: null,
    displayOrder: 1, isPublic: true, isActive: true, version: 'one' };
  getManagedServices.mockResolvedValue([service]);
  uploadCommercialMedia.mockResolvedValue({ url: '/api/v1/media/00000000-0000-0000-0000-000000000001' });
  saveManagedService.mockResolvedValue({});
  vi.stubGlobal('URL', { ...URL, createObjectURL: vi.fn(() => 'blob:preview'), revokeObjectURL: vi.fn() });

  render(<CommercialCatalogPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  const dialog = screen.getByRole('dialog', { name: 'Editar servicio' });
  expect(dialog).toHaveClass('right-0');
  expect(screen.getByRole('combobox', { name: /Unidad de cobro/ })).toHaveValue('Por operación');
  expect(screen.getByRole('button', { name: 'Volver atrás' })).toBeInTheDocument();
  const image = new File(['image'], 'cargo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Foto del servicio'), { target: { files: [image] } });
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  await waitFor(() => expect(uploadCommercialMedia).toHaveBeenCalledWith('service-image', image));
  // A legacy unit name opens as the unit it names and is saved by its code.
  expect(saveManagedService).toHaveBeenCalledWith('service-1', expect.objectContaining({
    code: 'RAMP-CARGO', name: 'Carga y descarga', billingUnit: 'operation', displayOrder: 1,
    imageUrl: '/api/v1/media/00000000-0000-0000-0000-000000000001',
  }));
});

it('keeps closure decisions out of a custom catalog-only workspace', async () => {
  getManagedServices.mockResolvedValue([]);
  render(<CommercialCatalogPage canSeeClosures={false} />);
  await waitFor(() => expect(getManagedServices).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Solicitudes de clausura' })).not.toBeInTheDocument();
});

it('shows an illustration for services without a photo and maps server publication rules', async () => {
  const user = userEvent.setup();
  getManagedServices.mockResolvedValue([{ ...makeService(1), code: 'RAMP-CATERING', name: 'Servicio de catering',
    description: 'Comidas y bebidas a bordo para la tripulación y pasajeros', isPublic: false }]);
  saveManagedService.mockRejectedValue(Object.assign(new Error('Invalid service data.'), { status: 400, code: 'placeholder_name' }));

  render(<CommercialCatalogPage />);
  const card = await screen.findByRole('article');
  expect(within(card).getByText('Sin foto · ilustración')).toBeInTheDocument();
  expect(card.querySelector('img')).toHaveAttribute('src', '/assets/services/illustrations/catering.svg');

  await user.click(screen.getByRole('button', { name: 'Editar' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(await screen.findByText('Un servicio con nombre o código de prueba no puede publicarse.')).toBeInTheDocument();
});
