import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewSkeleton from './ReviewSkeleton';

describe('ReviewSkeleton', () => {
  it('renders a set of placeholder rows', () => {
    render(<ReviewSkeleton />);
    expect(screen.getByTestId('review-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('review-skeleton-row')).toHaveLength(6);
  });
});
