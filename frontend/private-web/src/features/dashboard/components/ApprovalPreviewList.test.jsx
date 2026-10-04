import { describe, expect, it, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import ApprovalPreviewList from './ApprovalPreviewList';

const APPROVALS = Array.from({ length: 7 }, (_, i) => ({
  id: `appr-${i}`,
  flightNumber: `DM1${i}`,
  airlineIata: 'DM',
  station: 'PUJ',
  agent: 'J. Ramírez',
  requestedAt: '2026-08-01T13:50:00-04:00',
  status: 'pendingReview',
}));

describe('ApprovalPreviewList', () => {
  it('renders at most 5 approvals even if more are passed', () => {
    render(<ApprovalPreviewList approvals={APPROVALS} onViewAll={() => {}} />);
    expect(screen.getAllByTestId('flight-strip')).toHaveLength(5);
  });

  it('calls onViewAll when the "Ver todas" button is clicked', async () => {
    const onViewAll = vi.fn();
    render(<ApprovalPreviewList approvals={APPROVALS} onViewAll={onViewAll} />);
    await userEvent.click(screen.getByRole('button', { name: /ver todas/i }));
    expect(onViewAll).toHaveBeenCalledTimes(1);
  });

  it('renders an elegant empty state when there are no approvals', () => {
    render(<ApprovalPreviewList approvals={[]} onViewAll={() => {}} />);
    expect(screen.getByText(/no hay operaciones pendientes de revisión/i)).toBeInTheDocument();
    expect(screen.queryByTestId('flight-strip')).not.toBeInTheDocument();
  });

  it('renders a skeleton list when loading', () => {
    render(<ApprovalPreviewList approvals={[]} onViewAll={() => {}} loading />);
    expect(within(screen.getByTestId('approvals-skeleton')).getAllByTestId('strip-skeleton-row')).toHaveLength(5);
  });
});