import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ObservationList from './ObservationList';

describe('ObservationList', () => {
  it('shows the empty copy when there are no observations', () => {
    render(<ObservationList observations={[]} />);
    expect(screen.getByText('Sin observaciones registradas.')).toBeInTheDocument();
  });

  it('renders each observation with its author and comment', () => {
    render(
      <ObservationList
        observations={[{ user: 'Carlos Medina', role: 'Agente', at: '2026-08-05T15:44:00-04:00', comment: 'Operación sin novedades.' }]}
      />
    );
    expect(screen.getByText('Operación sin novedades.')).toBeInTheDocument();
    expect(screen.getByText(/Carlos Medina/)).toBeInTheDocument();
    expect(screen.getByText(/Agente/)).toBeInTheDocument();
  });
});