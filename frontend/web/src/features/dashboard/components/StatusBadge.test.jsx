import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import StatusBadge from './StatusBadge';

describe('StatusBadge', () => {
  it('renders the Spanish label for a known status', () => {
    render(<StatusBadge domain="flight" status="delayed" />);
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
  });

  it('colors the indicator dot using the status color hex', () => {
    render(<StatusBadge domain="flight" status="cancelled" />);
    const dot = screen.getByTestId('status-dot');
    expect(dot).toHaveStyle({ backgroundColor: '#C4453C' });
  });
});
