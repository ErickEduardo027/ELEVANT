import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ReviewTabs from './ReviewTabs';

const COUNTS = { pending: 12, inReview: 3, approved: 27, returned: 2, resubmitted: 1 };

describe('ReviewTabs', () => {
  it('renders every tab with its count', () => {
    render(<ReviewTabs active="pending" onChange={() => {}} counts={COUNTS} />);
    expect(screen.getByRole('tab', { name: 'Pendientes (12)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'En revisión (3)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Aprobadas (27)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Devueltas (2)' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Reenviadas (1)' })).toBeInTheDocument();
  });

  it('marks the active tab as selected', () => {
    render(<ReviewTabs active="returned" onChange={() => {}} counts={COUNTS} />);
    expect(screen.getByRole('tab', { name: 'Devueltas (2)' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByRole('tab', { name: 'Pendientes (12)' })).toHaveAttribute('aria-selected', 'false');
  });

  it('calls onChange with the tab id when clicked', async () => {
    const onChange = vi.fn();
    render(<ReviewTabs active="pending" onChange={onChange} counts={COUNTS} />);
    await userEvent.click(screen.getByRole('tab', { name: 'En revisión (3)' }));
    expect(onChange).toHaveBeenCalledWith('inReview');
  });
});