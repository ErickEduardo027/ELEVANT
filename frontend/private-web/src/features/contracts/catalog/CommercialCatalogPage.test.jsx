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
