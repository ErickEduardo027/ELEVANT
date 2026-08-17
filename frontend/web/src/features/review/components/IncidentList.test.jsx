import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import IncidentList from './IncidentList';

describe('IncidentList', () => {
  it('shows "Sin incidencias reportadas." when there are none', () => {
    render(<IncidentList incidents={[]} />);
    expect(screen.getByText('Sin incidencias reportadas.')).toBeInTheDocument();
  });

  it('renders each incident with its description and severity, and a count badge', () => {
    render(
      <IncidentList
        incidents={[
          { id: 'INC-1', description: 'Retraso en carga de equipaje', severity: 'medium', reportedBy: 'Carlos Medina', occurredAt: '2026-08-05T14:52:00-04:00' },
        ]}
      />
    );
    expect(screen.getByText('Retraso en carga de equipaje')).toBeInTheDocument();
    expect(screen.getByText('Media')).toBeInTheDocument();
    expect(screen.getByText(/Carlos Medina/)).toBeInTheDocument();
    expect(screen.getByText('1')).toBeInTheDocument();
  });
});
