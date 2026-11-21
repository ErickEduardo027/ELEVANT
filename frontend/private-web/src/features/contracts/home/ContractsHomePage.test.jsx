import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ContractsHomePage from './ContractsHomePage';

const DATA = {
  kpis: { pendingRequests: 1, approvedRequests: 1, pendingDrafts: 1, rejectedRequests: 2, totalRequests: 5 },
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

  it('puts every indicator against its whole, with the right plural (no «números fríos»)', () => {
    render(<ContractsHomePage status="success" data={DATA} onRetry={() => {}} onNavigate={() => {}} />);
    expect(screen.getAllByText('de 5 solicitudes · 20 %')).toHaveLength(2);
    expect(screen.getByText('de 5 solicitudes · 40 %')).toBeInTheDocument();
    expect(screen.getByText('1 versión en borrador · la más reciente de Arajet')).toBeInTheDocument();
  });

  it('says so when there is nothing to compare with', () => {
    render(<ContractsHomePage status="success" onRetry={() => {}} onNavigate={() => {}} data={{ ...DATA,
      kpis: { pendingRequests: 0, approvedRequests: 0, pendingDrafts: 0, rejectedRequests: 0, totalRequests: 0 },
      recentRequests: [], pendingDrafts: [] }} />);
    expect(screen.getAllByText('de 0 solicitudes')).toHaveLength(3);
    expect(screen.getByText('Ninguna versión espera activación')).toBeInTheDocument();
  });

  it('shortens a GUID reference and names a new contract «Borrador», each whole in its title (N35)', () => {
    const reference = '0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e';
    const code = 'DRAFT-1cc18541e2a94f3b8c7d6e5f4a3b2c1d';
    render(<ContractsHomePage status="success" onRetry={() => {}} onNavigate={() => {}} data={{ ...DATA,
      recentRequests: [...DATA.recentRequests, { id: 'three', reference, airline: 'Copa', status: 'InReview',
        submittedAt: '2026-11-05T12:00:00Z' }],
      pendingDrafts: [...DATA.pendingDrafts, { id: 'four', contractCode: code, airline: 'Copa', comments: [] }] }} />);
    expect(screen.getByText('0b1c2d3e…')).toHaveAttribute('title', reference);
    expect(screen.getByText('SOL-1')).not.toHaveAttribute('title');
    expect(screen.getByText('Borrador 1cc18541…')).toHaveAttribute('title', code);
    expect(screen.getByText('Borrador 2')).toHaveAttribute('title', 'DRAFT-2');
    expect(screen.queryByText(/DRAFT-|0b1c2d3e4f/)).not.toBeInTheDocument();
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
    expect(screen.getByRole('alert')).toHaveTextContent('Revisa la conexión e intenta nuevamente.');
    expect(screen.getByRole('alert')).not.toHaveTextContent('Internal failure');
    await userEvent.click(screen.getByRole('button', { name: /reintentar/i }));
    expect(onRetry).toHaveBeenCalledOnce();
    rerender(<ContractsHomePage status="error" error={{ status: 403 }} onRetry={onRetry} onNavigate={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('No tienes permiso para ver las solicitudes o los borradores.');
    rerender(<ContractsHomePage status="error" error={{ status: 401 }} onRetry={onRetry} onNavigate={() => {}} />);
    expect(screen.getByRole('alert')).toHaveTextContent('La sesión expiró. Vuelve a iniciar sesión.');
  });
});