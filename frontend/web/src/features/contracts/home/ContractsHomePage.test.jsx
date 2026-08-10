import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsHomePage from './ContractsHomePage';

const DATA = {
  kpis: { activeContracts: 18, expiringSoon: 3, pendingRequests: 5, agreedServices: 42 },
  recentContracts: [{ id: 'CTR-1', airline: 'Arajet', validUntil: '2027-02-28', status: 'active', servicesCount: 6 }],
  pendingRequests: [{ id: 'SOL-1', airline: 'Sky High', kind: 'Servicio adicional', receivedAt: '2026-08-09T09:35:00-04:00' }],
};

describe('ContractsHomePage', () => {
  it('shows the contractual KPIs and summaries', () => {
    render(<ContractsHomePage status="success" data={DATA} onRetry={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(screen.getByText('Contratos activos')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText('Sky High')).toBeInTheDocument();
  });

  it('navigates to the contracts and requests modules', async () => {
    const onNavigate = vi.fn();
    render(<ContractsHomePage status="success" data={DATA} onRetry={() => {}} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: /ver contratos/i }));
    await userEvent.click(screen.getByRole('button', { name: /ver solicitudes/i }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'contracts-list');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'contracts-requests');
  });

  it('renders loading and recoverable error states', async () => {
    const { rerender } = render(<ContractsHomePage status="loading" data={null} onRetry={() => {}} onNavigate={() => {}} />);
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
    const onRetry = vi.fn();
    rerender(<ContractsHomePage status="error" error={new Error('sin conexión')} onRetry={onRetry} onNavigate={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('sin conexión');
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
