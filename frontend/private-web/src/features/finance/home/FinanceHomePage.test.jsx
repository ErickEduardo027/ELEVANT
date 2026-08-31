import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import FinanceHomePage from './FinanceHomePage';

const DATA = {
  kpis: { approvedServices: 4, pendingReview: 2, draftPreinvoices: 1, reconciliationDifferences: 1 },
  approvedServices: [
    { id: 'SRV-001', airline: 'Arajet', flight: 'DM 100', service: 'GPU', approvedAt: '2026-08-10T08:42:00-04:00', amount: 250, currency: 'USD' },
  ],
  pendingActions: [
    { id: 'PRE-001', kind: 'Pre-factura', airline: 'Arajet', detail: 'Pendiente de revisión', moduleId: 'finance-preinvoices' },
  ],
};

describe('FinanceHomePage', () => {
  it('shows financial indicators and recent approved services', () => {
    render(<FinanceHomePage status="success" data={DATA} onNavigate={() => {}} />);

    expect(screen.getByRole('heading', { name: 'Resumen financiero' })).toBeInTheDocument();
    expect(screen.getByText('Servicios aprobados recientes')).toBeInTheDocument();
    expect(screen.getByText('DM 100')).toBeInTheDocument();
    expect(screen.getByText('US$250.00')).toBeInTheDocument();
  });

  it('navigates to the selected pending action', () => {
    const onNavigate = vi.fn();
    render(<FinanceHomePage status="success" data={DATA} onNavigate={onNavigate} />);

    fireEvent.click(screen.getByRole('button', { name: /Arajet/i }));
    expect(onNavigate).toHaveBeenCalledWith('finance-preinvoices');
  });

  it('offers a retry action when loading fails', () => {
    const onRetry = vi.fn();
    render(<FinanceHomePage status="error" error={new Error('Sin conexión')} onRetry={onRetry} onNavigate={() => {}} />);

    fireEvent.click(screen.getByRole('button', { name: 'Reintentar' }));
    expect(onRetry).toHaveBeenCalledOnce();
  });
});
