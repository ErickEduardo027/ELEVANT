import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewKPIs from './ReviewKPIs';

const KPIS = { pending: 6, inReview: 3, approvedToday: 4, returned: 2 };

describe('ReviewKPIs', () => {
  it('renders all four KPI cards with their values', () => {
    render(<ReviewKPIs kpis={KPIS} activeTab="pending" onSelectTab={() => {}} />);
    expect(screen.getByText('Pendientes de revisión')).toBeInTheDocument();
    expect(screen.getByText('En revisión')).toBeInTheDocument();
    expect(screen.getByText('Aprobadas hoy')).toBeInTheDocument();
    expect(screen.getByText('Devueltas')).toBeInTheDocument();
  });

  it('marks the KPI matching the active tab as pressed', () => {
    render(<ReviewKPIs kpis={KPIS} activeTab="returned" onSelectTab={() => {}} />);
    const buttons = screen.getAllByRole('button');
    const returnedButton = buttons.find(button => button.textContent.includes('Devueltas'));
    expect(returnedButton).toHaveAttribute('aria-pressed', 'true');
  });

  it('calls onSelectTab with the corresponding tab id when a KPI is clicked', async () => {
    const onSelectTab = vi.fn();
    render(<ReviewKPIs kpis={KPIS} activeTab="pending" onSelectTab={onSelectTab} />);
    const buttons = screen.getAllByRole('button');
    const inReviewButton = buttons.find(button => button.textContent.includes('En revisión'));
    await userEvent.click(inReviewButton);
    expect(onSelectTab).toHaveBeenCalledWith('inReview');
  });
});