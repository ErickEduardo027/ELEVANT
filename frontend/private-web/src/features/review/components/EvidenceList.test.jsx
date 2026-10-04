import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import EvidenceList from './EvidenceList';

describe('EvidenceList', () => {
  it('shows the empty copy when there is no evidence', () => {
    render(<EvidenceList evidence={[]} />);
    expect(screen.getByText('Sin evidencias adjuntas.')).toBeInTheDocument();
  });

  it('renders each evidence item with its type label, user, and availability', () => {
    render(
      <EvidenceList
        evidence={[
          { id: 'EV-1', name: 'Checklist de salida', type: 'checklist', user: 'Carlos Medina', date: '2026-08-05T15:40:00-04:00', status: 'available' },
        ]}
      />
    );
    expect(screen.getByText('Checklist de salida')).toBeInTheDocument();
    expect(screen.getByText(/Carlos Medina/)).toBeInTheDocument();
    expect(screen.getByText('Disponible')).toBeInTheDocument();
  });
});