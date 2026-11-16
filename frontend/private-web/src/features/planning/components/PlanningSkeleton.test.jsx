import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import PlanningSkeleton from './PlanningSkeleton';

describe('PlanningSkeleton', () => {
  it('renders six shimmering placeholder rows', () => {
    render(<PlanningSkeleton />);
    expect(screen.getByTestId('planning-skeleton')).toBeInTheDocument();
    expect(screen.getAllByTestId('planning-skeleton-row')).toHaveLength(6);
  });
});