import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsShell from './ContractsShell';

vi.mock('../../../services/contractsHomeService', () => ({
  getContractsHomeSnapshot: vi.fn().mockResolvedValue({
    kpis: { pendingRequests: 1, approvedRequests: 0, pendingDrafts: 1, publishedServices: 2 },
    recentRequests: [{ id: 'one', reference: 'SOL-1', airline: 'Sky High', status: 'Pending', submittedAt: '2026-09-27T10:00:00Z' }],
    pendingDrafts: [{ id: 'two', contractCode: 'DRAFT-2', airline: 'Arajet', comments: [] }],
  }),
}));

vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

describe('ContractsShell', () => {
  it('opens the contracts home and preserves the existing shell design', async () => {
    render(<ContractsShell />);
    expect(await screen.findByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(await screen.findByText('Sky High')).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Inicio').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Contratos')).toBeInTheDocument();
    expect(within(nav).getByText('Solicitudes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('opens the draft module from the live home action', async () => {
    render(<ContractsShell />);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Borradores por activar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /ver borradores/i }));
    expect(await screen.findByRole('heading', { name: 'Borradores' })).toBeInTheDocument();
  });
});
