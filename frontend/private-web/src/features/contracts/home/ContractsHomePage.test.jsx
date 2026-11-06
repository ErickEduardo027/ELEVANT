import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsHomePage from './ContractsHomePage';

const DATA = {
  kpis: { pendingRequests: 1, approvedRequests: 1, pendingDrafts: 1, rejectedRequests: 2 },
  recentRequests: [{ id: 'one', reference: 'SOL-1', airline: 'Sky High', status: 'Pending', submittedAt: '2026-09-27T10:00:00Z' }],
  pendingDrafts: [{ id: 'two', contractCode: 'DRAFT-2', airline: 'Arajet', comments: [] }],
};

describe('ContractsHomePage', () => {
  it('shows the contractual KPIs and summaries', () => {
    render(<ContractsHomePage status="success" data={DATA} onRetry={() => {}} onNavigate={() => {}} />);
    expect(screen.getByRole('heading', { name: 'Resumen contractual' })).toBeInTheDocument();
    expect(screen.getByText('Solicitudes pendientes')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText('Sky High')).toBeInTheDocument();
    expect(screen.queryByText(/Datos sintéticos/)).not.toBeInTheDocument();
  });

  it('navigates to the real requests and draft modules', async () => {
    const onNavigate = vi.fn();
    render(<ContractsHomePage status="success" data={DATA} onRetry={() => {}} onNavigate={onNavigate} />);
    await userEvent.click(screen.getByRole('button', { name: /ver borradores/i }));
    await userEvent.click(screen.getByRole('button', { name: /ver solicitudes/i }));
    expect(onNavigate).toHaveBeenNthCalledWith(1, 'contracts-drafts');
    expect(onNavigate).toHaveBeenNthCalledWith(2, 'contracts-requests');
  });

  it('renders loading and recoverable error states', async () => {
    const { rerender } = render(<ContractsHomePage status="loading" data={null} onRetry={() => {}} onNavigate={() => {}} />);
    expect(screen.getAllByTestId('kpi-skeleton')).toHaveLength(4);
    const onRetry = vi.fn();
    // The server title or exception text never reaches the screen.
    rerender(<ContractsHomePage status="error" error={Object.assign(new Error('Internal failure'), { status: 503 })}
      onRetry={onRetry} onNavigate={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Revise la conexión e intente nuevamente.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal failure');
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ContractsHomePage status="error" error={{ status: 403 }} onRetry={onRetry} onNavigate={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No tiene permiso para ver las solicitudes o los borradores.');
  });
});