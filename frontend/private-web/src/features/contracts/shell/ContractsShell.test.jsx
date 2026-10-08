import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsShell from './ContractsShell';
import { administratorAccess, DepartmentAccessProvider } from '../../access/DepartmentAccessContext';
import { DepartmentPermissionCodes } from '../../access/testAccess';
import { getManagedContracts } from '../../../services/commercialGovernanceApi';

vi.mock('../../../services/commercialGovernanceApi', () => ({
  getManagedContracts: vi.fn().mockResolvedValue({ page: 1, limit: 20,
    hasMore: false, contracts: [] }),
}));
vi.mock('../../../hooks/useCommercialRevalidation', () => ({ useCommercialRevalidation: vi.fn() }));

vi.mock('../../../services/contractsHomeService', () => ({
  getContractsHomeSnapshot: vi.fn().mockResolvedValue({
    kpis: { pendingRequests: 1, approvedRequests: 0, pendingDrafts: 1, rejectedRequests: 0 },
    recentRequests: [{ id: 'one', reference: 'SOL-1', airline: 'Sky High', status: 'Pending', submittedAt: '2026-09-27T10:00:00Z' }],
    pendingDrafts: [{ id: 'two', contractCode: 'DRAFT-2', airline: 'Arajet', comments: [] }],
  }),
}));

vi.mock('../../../services/accountChangeObserver', () => ({
  createPrivateWebAccountChangeObserver: () => ({ start: vi.fn(), stop: vi.fn() }),
}));

describe('ContractsShell', () => {
  it('opens the contracts home and preserves the existing shell design', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}><ContractsShell /></DepartmentAccessProvider>);
    expect(await screen.findByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(await screen.findByText('Sky High')).toBeInTheDocument();
    const nav = screen.getByRole('navigation');
    expect(within(nav).getByText('Inicio').closest('button')).toHaveAttribute('aria-current', 'page');
    expect(within(nav).getByText('Contratos')).toBeInTheDocument();
    expect(within(nav).getByText('Solicitudes')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Notificaciones' })).not.toBeInTheDocument();
  });

  it('opens the draft module from the live home action', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}><ContractsShell /></DepartmentAccessProvider>);
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Borradores por activar' })).toBeInTheDocument());
    await userEvent.click(screen.getByRole('button', { name: /ver borradores/i }));
    expect(await screen.findByRole('heading', { name: 'Borradores' })).toBeInTheDocument();
  });

  it('does not expose deferred prototype departmental chat', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}><ContractsShell /></DepartmentAccessProvider>);
    expect(await screen.findByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(within(screen.getByRole('navigation')).queryByText('Comunicaciones')).not.toBeInTheDocument();
  });

  it('uses the canonical agreement read for every published contract module', async () => {
    render(<DepartmentAccessProvider observe={false} initialAccess={administratorAccess('contracts', DepartmentPermissionCodes.contracts)}><ContractsShell /></DepartmentAccessProvider>);
    const navigation = screen.getByRole('navigation');
    for (const label of ['Contratos', 'Servicios pactados', 'Reportes']) {
      await userEvent.click(within(navigation).getByText(label).closest('button'));
      expect(await screen.findByRole('heading', { name: label === 'Reportes'
        ? 'Reportes contractuales' : label })).toBeInTheDocument();
    }
    expect(getManagedContracts).toHaveBeenCalledTimes(3);
  });
});