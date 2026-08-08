import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import NotificationSkeleton from './NotificationSkeleton';

describe('NotificationSkeleton', () => {
  it('renders a set of pulse rows', () => {
    render(<NotificationSkeleton />);
    expect(screen.getByTestId('notification-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('notification-skeleton-row')).toHaveLength(6);
  });
});
