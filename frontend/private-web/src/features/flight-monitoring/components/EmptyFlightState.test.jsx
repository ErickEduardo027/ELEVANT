import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyFlightState from './EmptyFlightState';

describe('EmptyFlightState', () => {
  it('shows the no-flights message by default', () => {
    render(<EmptyFlightState reason="no-flights" />);
    expect(screen.getByText('Sin vuelos para mostrar')).toBeInTheDocument();
  });

  it('shows the no-results message when filters produced nothing', () => {
    render(<EmptyFlightState reason="no-results" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });
});
