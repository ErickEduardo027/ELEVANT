import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialCatalogPage from './CommercialCatalogPage';
import { createManagedService, getManagedServices, retireManagedService, updateManagedService,
  uploadCommercialMedia } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedServices: vi.fn(), createManagedService: vi.fn(), updateManagedService: vi.fn(),
  retireManagedService: vi.fn(), uploadCommercialMedia: vi.fn(),
  commercialMediaUrl: path => path,
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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
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
  createManagedService.mockResolvedValue({ id: created.id });

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

  await waitFor(() => expect(createManagedService).toHaveBeenCalledWith(expect.objectContaining({
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
  createManagedService.mockResolvedValue({ id: 'service-2' });

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

  await waitFor(() => expect(createManagedService).toHaveBeenCalledWith(expect.objectContaining({
    code: 'SA', name: 'Asistencia especial', billingUnit: 'hour', displayOrder: 2, isActive: true,
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
  expect(createManagedService).not.toHaveBeenCalled();

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
  expect(createManagedService).not.toHaveBeenCalled();
});

it('shows a clear message when the API rejects a duplicate code', async () => {
  const user = userEvent.setup();
  getManagedServices.mockResolvedValue([]);
  createManagedService.mockRejectedValue(Object.assign(new Error('Service changed; reload and retry.'),
    { status: 409, code: 'service_code_exists' }));

  render(<CommercialCatalogPage />);
  await screen.findByText('No hay servicios en el catálogo.');
  await openCreateForm(user);
  await pick(user, /Nombre del servicio/, /Escaleras móviles/);
  await pick(user, /Unidad de cobro/, /Por operación/);
  await fill(user, screen.getByLabelText(/Descripción/), 'Escaleras');
  await user.click(screen.getByRole('checkbox', { name: 'Visible al público' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  expect(await screen.findByText('Ya existe un servicio con ese código. Actualice el catálogo y edite el existente.'))
    .toBeInTheDocument();
  // The server title is never shown.
  expect(screen.queryByText(/reload and retry/)).not.toBeInTheDocument();
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
  updateManagedService.mockResolvedValue({ id: 'service-2' });

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

  // The edit travels with its Idempotency-Key and the version on screen.
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith('service-2', expect.objectContaining({
    code: 'SERVICE-2', name: 'Remolque', billingUnit: 'hour', displayOrder: 2, version: 'version-2',
  }), expect.stringMatching(UUID)));
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
  updateManagedService.mockResolvedValue({});
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
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith('service-1', expect.objectContaining({
    code: 'RAMP-CARGO', name: 'Carga y descarga', billingUnit: 'operation', displayOrder: 1,
    imageUrl: '/api/v1/media/00000000-0000-0000-0000-000000000001',
  }), expect.stringMatching(UUID)));
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
  updateManagedService.mockRejectedValue(Object.assign(new Error('Invalid service data.'), { status: 400, code: 'placeholder_name' }));

  render(<CommercialCatalogPage />);
  const card = await screen.findByRole('article');
  expect(within(card).getByText('Sin foto · ilustración')).toBeInTheDocument();
  expect(card.querySelector('img')).toHaveAttribute('src', '/assets/services/illustrations/catering.svg');

  await user.click(screen.getByRole('button', { name: 'Editar' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(await screen.findByText('Un servicio con nombre o código de prueba no puede publicarse.')).toBeInTheDocument();
});

const problem = (status, code) => Object.assign(new Error('Service changed; reload and retry.'), { status, code });

it('hides a public service from the public catalog without retiring it', async () => {
  const user = userEvent.setup();
  const service = { ...makeService(1), code: 'RAMP-GPU', name: 'Unidad generadora de energía',
    description: 'Energía eléctrica en tierra para la aeronave.' };
  getManagedServices.mockResolvedValueOnce([service]).mockResolvedValue([{ ...service, isPublic: false, version: 'v2' }]);
  updateManagedService.mockResolvedValue({ ...service, isPublic: false });

  render(<CommercialCatalogPage />);
  const card = await screen.findByRole('article');
  expect(within(card).getByText('Público')).toBeInTheDocument();
  await user.click(within(card).getByRole('button', { name: 'Ocultar del catálogo' }));
  const dialog = screen.getByRole('dialog', { name: 'Ocultar del catálogo público' });
  expect(dialog).toHaveTextContent('Sigue activo: los contratos que lo incluyen y la operación de OCC no cambian.');
  await user.click(within(dialog).getByRole('button', { name: 'Ocultar' }));

  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith(service.id, {
    code: 'RAMP-GPU', name: 'Unidad generadora de energía', description: 'Energía eléctrica en tierra para la aeronave.',
    billingUnit: 'operación', imageUrl: null, videoUrl: null, displayOrder: 1, isPublic: false, isActive: true,
    version: 'version-1',
  }, expect.stringMatching(UUID)));
  expect(await screen.findByText(/ya no aparece en el catálogo público\. Sigue activo/)).toBeInTheDocument();
  expect(within(await screen.findByRole('article')).getByText('Oculto')).toBeInTheDocument();
  expect(retireManagedService).not.toHaveBeenCalled();
});

it('retires a service with a reason and offers to hide it when a contract still uses it', async () => {
  const user = userEvent.setup();
  const service = { ...makeService(1), name: 'Puente de abordaje' };
  getManagedServices.mockResolvedValue([service]);
  retireManagedService.mockRejectedValueOnce(problem(409, 'service_in_active_contract'));
  updateManagedService.mockResolvedValue({ ...service, isPublic: false });

  render(<CommercialCatalogPage />);
  await user.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Dar de baja' }));
  const dialog = screen.getByRole('alertdialog', { name: 'Dar de baja Puente de abordaje' });
  const confirm = within(dialog).getByRole('button', { name: 'Dar de baja' });
  expect(confirm).toBeDisabled();
  await fill(user, within(dialog).getByLabelText('Motivo de la baja'), '  AVIAM deja de operar el puente.  ');
  await user.click(confirm);

  await waitFor(() => expect(retireManagedService).toHaveBeenCalledWith(service.id,
    { expectedVersion: 'version-1', reason: 'AVIAM deja de operar el puente.' }, expect.stringMatching(UUID)));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent(
    'No se puede dar de baja: un contrato vigente o en aprobación incluye este servicio');
  expect(screen.queryByText(/reload and retry/)).not.toBeInTheDocument();
  // The way out is to hide it: contracts and the operation keep it.
  await user.click(within(dialog).getByRole('button', { name: 'Ocultar del catálogo' }));
  const hide = screen.getByRole('dialog', { name: 'Ocultar del catálogo público' });
  await user.click(within(hide).getByRole('button', { name: 'Ocultar' }));
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith(service.id,
    expect.objectContaining({ isPublic: false, isActive: true }), expect.stringMatching(UUID)));
});

it('retires a service that no contract uses', async () => {
  const user = userEvent.setup();
  const service = makeService(1);
  getManagedServices.mockResolvedValueOnce([service])
    .mockResolvedValue([{ ...service, isActive: false, isPublic: false, version: 'v2' }]);
  retireManagedService.mockResolvedValue({ ...service, isActive: false, isPublic: false });

  render(<CommercialCatalogPage />);
  await user.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Dar de baja' }));
  const dialog = screen.getByRole('alertdialog');
  await fill(user, within(dialog).getByLabelText('Motivo de la baja'), 'El servicio dejó de prestarse en AVIAM.');
  await user.click(within(dialog).getByRole('button', { name: 'Dar de baja' }));

  expect(await screen.findByText(/quedó dado de baja: ya no se ofrece en contratos nuevos ni en la operación/))
    .toBeInTheDocument();
  const card = await screen.findByRole('article');
  expect(within(card).getByText('Dado de baja')).toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Dar de baja' })).not.toBeInTheDocument();
  expect(within(card).queryByRole('button', { name: 'Ocultar del catálogo' })).not.toBeInTheDocument();
});

it('reactivates a retired service and keeps it hidden until it is published', async () => {
  const user = userEvent.setup();
  const retired = { ...makeService(1), isActive: false, isPublic: false };
  getManagedServices.mockResolvedValue([retired]);
  updateManagedService.mockResolvedValue({ ...retired, isActive: true });

  render(<CommercialCatalogPage />);
  const card = await screen.findByRole('article');
  expect(within(card).getByText('Dado de baja')).toBeInTheDocument();
  await user.click(within(card).getByRole('button', { name: 'Reactivar' }));
  const dialog = screen.getByRole('dialog', { name: 'Reactivar servicio' });
  expect(dialog).toHaveTextContent('Seguirá oculto del catálogo público hasta que lo publique desde «Editar».');
  await user.click(within(dialog).getByRole('button', { name: 'Reactivar' }));
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith(retired.id,
    expect.objectContaining({ isActive: true, isPublic: false, version: 'version-1' }), expect.stringMatching(UUID)));
});

it('keeps the key of an uncertain command and retries with it', async () => {
  const user = userEvent.setup();
  const service = makeService(1);
  getManagedServices.mockResolvedValue([service]);
  updateManagedService.mockRejectedValueOnce(new Error('No hay conexión con ELEVANT. Intente de nuevo.'))
    .mockResolvedValue({ ...service, isPublic: false });

  render(<CommercialCatalogPage />);
  await user.click(within(await screen.findByRole('article')).getByRole('button', { name: 'Ocultar del catálogo' }));
  const dialog = screen.getByRole('dialog', { name: 'Ocultar del catálogo público' });
  await user.click(within(dialog).getByRole('button', { name: 'Ocultar' }));
  expect(await within(dialog).findByRole('alert')).toHaveTextContent('Revise la conexión e intente de nuevo.');
  await user.click(within(dialog).getByRole('button', { name: 'Ocultar' }));
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledTimes(2));
  const [first, second] = updateManagedService.mock.calls;
  expect(second[2]).toBe(first[2]);
});

it('never offers to deactivate from the form and explains a closure that keeps the service hidden', async () => {
  const user = userEvent.setup();
  const hidden = { ...makeService(1), isPublic: false, imageUrl: '/assets/services/ground-power.webp',
    description: 'Energía eléctrica en tierra para la aeronave.' };
  getManagedServices.mockResolvedValue([hidden]);
  updateManagedService.mockRejectedValue(problem(409, 'closure_requires_reopen'));

  render(<CommercialCatalogPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  expect(screen.queryByRole('checkbox', { name: 'Activo' })).not.toBeInTheDocument();
  await user.click(screen.getByRole('checkbox', { name: 'Visible al público' }));
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  expect(await screen.findByText('Una clausura aprobada mantiene oculto este servicio. Republíquelo desde «Solicitudes de clausura» indicando el motivo.'))
    .toBeInTheDocument();
  expect(screen.getByRole('dialog', { name: 'Editar servicio' })).toBeInTheDocument();
});

it('does not publish a retired service from its form', async () => {
  const user = userEvent.setup();
  // A legacy row may still say «visible» while it is retired.
  const retired = { ...makeService(1), isActive: false, isPublic: true };
  getManagedServices.mockResolvedValue([retired]);
  updateManagedService.mockResolvedValue(retired);

  render(<CommercialCatalogPage />);
  await user.click(await screen.findByRole('button', { name: 'Editar' }));
  expect(screen.getByRole('note')).toHaveTextContent('Este servicio está dado de baja');
  const visible = screen.getByRole('checkbox', { name: 'Visible al público' });
  expect(visible).toBeDisabled();
  expect(visible).not.toBeChecked();
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  await waitFor(() => expect(updateManagedService).toHaveBeenCalledWith(retired.id,
    expect.objectContaining({ isActive: false, isPublic: false }), expect.stringMatching(UUID)));
});

it('shows the unauthorized and recoverable-error states of the catalog', async () => {
  const user = userEvent.setup();
  getManagedServices.mockRejectedValueOnce(problem(403)).mockRejectedValueOnce(problem(500))
    .mockResolvedValue([makeService(1)]);

  const { unmount } = render(<CommercialCatalogPage />);
  expect(await screen.findByText('No tiene permiso para ver el catálogo de servicios.')).toBeInTheDocument();
  expect(screen.queryByText('No hay servicios en el catálogo.')).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Crear servicio' })).not.toBeInTheDocument();
  unmount();

  render(<CommercialCatalogPage />);
  expect(await screen.findByText('No se pudo completar la acción. Revise la conexión e intente de nuevo.')).toBeInTheDocument();
  expect(screen.queryByText(/reload and retry/)).not.toBeInTheDocument();
  expect(screen.queryByText('No hay servicios en el catálogo.')).not.toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Servicio 1')).toBeInTheDocument();
});
