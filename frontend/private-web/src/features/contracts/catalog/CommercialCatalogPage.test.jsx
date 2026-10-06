import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CommercialCatalogPage from './CommercialCatalogPage';
import { getManagedServices, saveManagedService, uploadCommercialMedia } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedServices: vi.fn(), saveManagedService: vi.fn(), uploadCommercialMedia: vi.fn(),
  commercialMediaUrl: path => path,
  deleteManagedService: vi.fn(),
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

it('shows ten services per page with the visible range and bounded navigation', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 23 }, (_, index) => makeService(index + 1));
  services[1].isPublic = false;
  getManagedServices.mockResolvedValue(services);

  render(<CommercialCatalogPage />);
  expect(await screen.findByText('Servicio 1')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(10);
  expect(screen.getByText('Mostrando 1–10 de 23 servicios')).toBeInTheDocument();
  expect(screen.getByText('Página 1 de 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.queryByText('Servicio 11')).not.toBeInTheDocument();
  expect(screen.getByText('Servicio 2')).toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getByText('Mostrando 11–20 de 23 servicios')).toBeInTheDocument();
  expect(screen.getByText('Servicio 11')).toBeInTheDocument();
  expect(screen.queryByText('Servicio 1')).not.toBeInTheDocument();

  await user.click(screen.getByRole('button', { name: 'Siguiente' }));
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(3);
  expect(screen.getByText('Mostrando 21–23 de 23 servicios')).toBeInTheDocument();
  expect(screen.getByText('Página 3 de 3')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('shows an empty catalog and keeps a single page for exactly ten services', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 10 }, (_, index) => makeService(index + 1));
  getManagedServices.mockResolvedValueOnce([]).mockResolvedValue(services);

  render(<CommercialCatalogPage />);
  expect(await screen.findByText('No hay servicios en el catálogo.')).toBeInTheDocument();
  expect(screen.getByText('Mostrando 0–0 de 0 servicios')).toBeInTheDocument();
  await user.click(screen.getByRole('button', { name: 'Actualizar' }));

  expect(await screen.findByText('Servicio 10')).toBeInTheDocument();
  expect(screen.getAllByRole('button', { name: 'Editar' })).toHaveLength(10);
  expect(screen.getByText('Página 1 de 1')).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Anterior' })).toBeDisabled();
  expect(screen.getByRole('button', { name: 'Siguiente' })).toBeDisabled();
});

it('returns to the last available page when a refresh reduces the catalog', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 23 }, (_, index) => makeService(index + 1));
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

it('shows a newly created service on its catalog page', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 10 }, (_, index) => makeService(index + 1));
  getManagedServices.mockResolvedValueOnce(services).mockResolvedValueOnce([...services, makeService(11)]);
  saveManagedService.mockResolvedValue({ id: 'service-11' });

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 1');
  await user.click(screen.getByRole('button', { name: 'Crear servicio' }));
  await user.type(screen.getByLabelText('Código'), 'SERVICE-11');
  await user.type(screen.getByLabelText('Nombre'), 'Servicio 11');
  await user.type(screen.getByLabelText('Descripción'), 'Descripción 11');
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
  expect(screen.getByText('Servicio 11')).toBeInTheDocument();
  expect(screen.getByText('Mostrando 11–11 de 11 servicios')).toBeInTheDocument();
});

it('follows an edited service when its display order moves it to another page', async () => {
  const user = userEvent.setup();
  const services = Array.from({ length: 11 }, (_, index) => makeService(index + 1));
  getManagedServices.mockResolvedValueOnce(services).mockResolvedValueOnce([
    ...services.slice(1), { ...services[0], displayOrder: 20 },
  ]);
  saveManagedService.mockResolvedValue({ id: 'service-1' });

  render(<CommercialCatalogPage />);
  await screen.findByText('Servicio 1');
  await user.click(screen.getAllByRole('button', { name: 'Editar' })[0]);
  await user.clear(screen.getByLabelText('Orden'));
  await user.type(screen.getByLabelText('Orden'), '20');
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));

  expect(await screen.findByText('Página 2 de 2')).toBeInTheDocument();
  expect(screen.getByText('Servicio 1')).toBeInTheDocument();
  expect(screen.queryByText('Servicio 2')).not.toBeInTheDocument();
});

it('edits a service in a right drawer and uploads its selected image before saving', async () => {
  const user = userEvent.setup();
  const service = { id: 'service-1', code: 'RAMP-CARGO', name: 'Carga y descarga',
    description: 'Atención de carga', billingUnit: 'operación',
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
  expect(screen.getByRole('button', { name: 'Volver atrás' })).toBeInTheDocument();
  const image = new File(['image'], 'cargo.png', { type: 'image/png' });
  fireEvent.change(screen.getByLabelText('Foto del servicio'), { target: { files: [image] } });
  await user.click(screen.getByRole('button', { name: 'Guardar servicio' }));
  await waitFor(() => expect(uploadCommercialMedia).toHaveBeenCalledWith('service-image', image));
  expect(saveManagedService).toHaveBeenCalledWith('service-1', expect.objectContaining({
    imageUrl: '/api/v1/media/00000000-0000-0000-0000-000000000001',
  }));
});

it('keeps closure decisions out of a custom catalog-only workspace', async () => {
  getManagedServices.mockResolvedValue([]);
  render(<CommercialCatalogPage canSeeClosures={false} />);
  await waitFor(() => expect(getManagedServices).toHaveBeenCalled());
  expect(screen.queryByRole('button', { name: 'Solicitudes de clausura' })).not.toBeInTheDocument();
});
