import { afterEach, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ServiceClosurePanel from './ServiceClosurePanel';
import { decideServiceClosure, getPublishedCommercialServices, getServiceClosures,
  reopenService, requestServiceClosure } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  decideServiceClosure: vi.fn(), getPublishedCommercialServices: vi.fn(),
  getServiceClosures: vi.fn(), reopenService: vi.fn(), requestServiceClosure: vi.fn(),
  commercialMediaUrl: path => path,
}));
vi.mock('../../../hooks/usePrivateMediaUrl', () => ({ usePrivateMediaUrl: url => url }));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));
vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

const service = { id: '11111111-1111-4111-8111-111111111111', name: 'Aire acondicionado',
  description: 'Aire en tierra', imageUrl: null, videoUrl: null };
const request = { id: '22222222-2222-4222-8222-222222222222', serviceId: service.id,
  serviceName: service.name, status: 'Pending', reason: 'El equipo no funciona.',
  requestedAt: '2026-10-05T10:00:00Z', version: 'AAAA', serviceVersion: 'BBBB',
  isCurrentlyPublic: true, reopenedAt: null };

afterEach(() => { vi.clearAllMocks(); });

it('lets OCC submit a motivated request while showing the published service', async () => {
  getPublishedCommercialServices.mockResolvedValue({ services: [service] });
  getServiceClosures.mockResolvedValue({ items: [], pendingCount: 0, hasMore: false });
  requestServiceClosure.mockResolvedValue(request);
  render(<ServiceClosurePanel mode="occ" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Notificar clausura' }));
  expect(screen.getByRole('dialog')).toBeInTheDocument();
  fireEvent.change(screen.getByLabelText('Motivo (obligatorio)'), { target: { value: 'El equipo no funciona.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(requestServiceClosure).toHaveBeenCalledWith(
    expect.stringMatching(/^[0-9a-f-]{36}$/i), service.id, 'El equipo no funciona.'));
  expect(decideServiceClosure).not.toHaveBeenCalled();
});

it('lets Contracts approve and reopen with the row versions', async () => {
  getServiceClosures.mockResolvedValueOnce({ items: [request], pendingCount: 1, hasMore: false })
    .mockResolvedValue({ items: [{ ...request, status: 'Approved',
      isCurrentlyPublic: false }], pendingCount: 0, hasMore: false });
  decideServiceClosure.mockResolvedValue({ ...request, status: 'Approved' });
  reopenService.mockResolvedValue({ ...request, status: 'Approved', isCurrentlyPublic: true });
  render(<ServiceClosurePanel mode="contracts" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar clausura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(decideServiceClosure).toHaveBeenCalledWith(
    request.id, true, null, request.version));
  fireEvent.click(await screen.findByRole('button', { name: 'Republicar' }));
  fireEvent.change(screen.getByLabelText('Motivo (obligatorio)'), { target: { value: 'Equipo reparado y disponible.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(reopenService).toHaveBeenCalledWith(
    service.id, 'Equipo reparado y disponible.', request.serviceVersion));
});

it('shows request and decision capabilities together for a custom role', async () => {
  getPublishedCommercialServices.mockResolvedValue({ services: [service] });
  getServiceClosures.mockResolvedValue({ items: [request], pendingCount: 1,
    pendingServiceIds: [], hasMore: false });
  render(<ServiceClosurePanel mode="contracts" canRequest canDecide canReopen />);
  expect(await screen.findByRole('button', { name: 'Notificar clausura' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aprobar clausura' })).toBeInTheDocument();
});
