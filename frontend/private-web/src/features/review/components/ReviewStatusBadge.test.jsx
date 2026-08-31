import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ReviewStatusBadge from './ReviewStatusBadge';

describe('ReviewStatusBadge', () => {
  it('renders the Spanish label for a review status', () => {
    render(<ReviewStatusBadge status="PENDING_REVIEW" />);
    expect(screen.getByText('Pendiente de revisión')).toBeInTheDocument();
  });

  it('renders the label for RETURNED', () => {
    render(<ReviewStatusBadge status="RETURNED" />);
    expect(screen.getByText('Devuelto con correcciones')).toBeInTheDocument();
  });
});
