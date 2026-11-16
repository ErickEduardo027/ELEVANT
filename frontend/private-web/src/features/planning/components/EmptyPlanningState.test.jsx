import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EmptyPlanningState from './EmptyPlanningState';

describe('EmptyPlanningState', () => {
  it('shows the no-flights copy for that reason', () => {
    render(<EmptyPlanningState reason="no-flights" />);
    expect(screen.getByText('Sin vuelos programados')).toBeInTheDocument();
  });

  it('shows the no-results copy for that reason', () => {
    render(<EmptyPlanningState reason="no-results" />);
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
  });
});