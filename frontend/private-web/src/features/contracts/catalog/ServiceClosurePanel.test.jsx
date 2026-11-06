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

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const service = { id: '11111111-1111-4111-8111-111111111111', name: 'Aire acondicionado',
  description: 'Aire en tierra', imageUrl: null, videoUrl: null };
const request = { id: '22222222-2222-4222-8222-222222222222', serviceId: service.id,
  serviceName: service.name, status: 'Pending', reason: 'El equipo no funciona.',
  requestedAt: '2026-10-05T10:00:00Z', version: 'AAAA', serviceVersion: 'BBBB',
  isCurrentlyPublic: true, isServiceActive: true, reopenedAt: null };
const approved = { ...request, status: 'Approved', isCurrentlyPublic: false };
const problem = (status, code) => Object.assign(new Error('Service or request changed; reload and retry.'),
  { status, code });

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

it('lets Contracts approve and reopen with the row versions and an Idempotency-Key', async () => {
  getServiceClosures.mockResolvedValueOnce({ items: [request], pendingCount: 1, hasMore: false })
    .mockResolvedValue({ items: [approved], pendingCount: 0, hasMore: false });
  decideServiceClosure.mockResolvedValue(approved);
  reopenService.mockResolvedValue({ ...approved, isCurrentlyPublic: true });
  render(<ServiceClosurePanel mode="contracts" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar clausura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(decideServiceClosure).toHaveBeenCalledWith(
    request.id, { approve: true, reason: null, version: request.version }, expect.stringMatching(UUID)));
  fireEvent.click(await screen.findByRole('button', { name: 'Republicar' }));
  fireEvent.change(screen.getByLabelText('Motivo (obligatorio)'), { target: { value: 'Equipo reparado y disponible.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(reopenService).toHaveBeenCalledWith(
    service.id, { reason: 'Equipo reparado y disponible.', serviceVersion: request.serviceVersion },
    expect.stringMatching(UUID)));
});

it('asks to reactivate a retired service instead of offering «Republicar»', async () => {
  getServiceClosures.mockResolvedValue({ items: [{ ...approved, isServiceActive: false }], pendingCount: 0,
    hasMore: false });
  render(<ServiceClosurePanel mode="contracts" />);
  expect(await screen.findByText('Servicio dado de baja: reactívelo en el catálogo para poder republicarlo.'))
    .toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Republicar' })).not.toBeInTheDocument();
});

it('approves a pending closure of a service that is already hidden', async () => {
  getServiceClosures.mockResolvedValue({ items: [{ ...request, isCurrentlyPublic: false }], pendingCount: 1,
    hasMore: false });
  decideServiceClosure.mockResolvedValue(approved);
  render(<ServiceClosurePanel mode="contracts" />);
  expect(await screen.findByText(/ya no está en el catálogo público; aprobar la clausura la deja registrada/))
    .toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Aprobar clausura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  await waitFor(() => expect(decideServiceClosure).toHaveBeenCalled());
  expect(await screen.findByText(/Clausura aprobada/)).toBeInTheDocument();
});

it('explains a coded conflict in Spanish and re-reads the history', async () => {
  getServiceClosures.mockResolvedValue({ items: [approved], pendingCount: 0, hasMore: false });
  reopenService.mockRejectedValue(problem(409, 'service_retired'));
  render(<ServiceClosurePanel mode="contracts" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Republicar' }));
  fireEvent.change(screen.getByLabelText('Motivo (obligatorio)'), { target: { value: 'Equipo reparado y disponible.' } });
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText('El servicio está dado de baja. Reactívelo en el catálogo antes de republicarlo.'))
    .toBeInTheDocument();
  expect(screen.queryByText(/reload and retry/)).not.toBeInTheDocument();
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  await waitFor(() => expect(getServiceClosures).toHaveBeenCalledTimes(2));
});

it('explains the four-eyes refusal inside the dialog', async () => {
  getServiceClosures.mockResolvedValue({ items: [request], pendingCount: 1, hasMore: false });
  decideServiceClosure.mockRejectedValue(problem(403, 'closure_self_decision'));
  render(<ServiceClosurePanel mode="contracts" />);
  fireEvent.click(await screen.findByRole('button', { name: 'Aprobar clausura' }));
  fireEvent.click(screen.getByRole('button', { name: 'Confirmar' }));
  expect(await screen.findByText('No puede decidir una clausura que usted mismo notificó.')).toBeInTheDocument();
  expect(screen.getByRole('dialog')).toBeInTheDocument();
});

it('shows the unauthorized and recoverable-error states of the history', async () => {
  getServiceClosures.mockRejectedValueOnce(problem(403)).mockRejectedValueOnce(problem(503))
    .mockResolvedValue({ items: [], pendingCount: 0, hasMore: false });
  const { unmount } = render(<ServiceClosurePanel mode="contracts" />);
  expect(await screen.findByText('No tiene permiso para ver las solicitudes de clausura.')).toBeInTheDocument();
  expect(screen.queryByText('Todavía no hay solicitudes de clausura.')).not.toBeInTheDocument();
  unmount();
  render(<ServiceClosurePanel mode="contracts" />);
  expect(await screen.findByText('No se pudo completar la acción. Revise la conexión e intente de nuevo.')).toBeInTheDocument();
  expect(screen.queryByText('Todavía no hay solicitudes de clausura.')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
  expect(await screen.findByText('Todavía no hay solicitudes de clausura.')).toBeInTheDocument();
});

it('shows request and decision capabilities together for a custom role', async () => {
  getPublishedCommercialServices.mockResolvedValue({ services: [service] });
  getServiceClosures.mockResolvedValue({ items: [request], pendingCount: 1,
    pendingServiceIds: [], hasMore: false });
  render(<ServiceClosurePanel mode="contracts" canRequest canDecide canReopen />);
  expect(await screen.findByRole('button', { name: 'Notificar clausura' })).toBeInTheDocument();
  expect(screen.getByRole('button', { name: 'Aprobar clausura' })).toBeInTheDocument();
});
