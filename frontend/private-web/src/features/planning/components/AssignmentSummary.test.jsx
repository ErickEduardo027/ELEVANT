import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssignmentSummary from './AssignmentSummary';

describe('AssignmentSummary', () => {
  it('summarizes the stand and every assigned resource category', () => {
    render(
      <AssignmentSummary
        position="A02"
        agents={[{ id: 'agent-1' }]}
        equipment={[{ id: 'equipment-1' }, { id: 'equipment-2' }]}
        services={[{ id: 'service-1' }]}
      />
    );

    expect(screen.getByText('A02')).toBeInTheDocument();
    expect(screen.getByText('1 agente')).toBeInTheDocument();
    expect(screen.getByText('2 equipos')).toBeInTheDocument();
    expect(screen.getByText('1 servicio')).toBeInTheDocument();
  });

  it('keeps zero counts truthful when only a stand is assigned', () => {
    render(<AssignmentSummary position="A02" />);

    expect(screen.getByText('0 agentes')).toBeInTheDocument();
    expect(screen.getByText('0 equipos')).toBeInTheDocument();
    expect(screen.getByText('0 servicios')).toBeInTheDocument();
  });

  it('shows a pending-resources message when nothing is assigned', () => {
    render(<AssignmentSummary position={null} agents={[]} equipment={[]} services={[]} />);

    expect(screen.getByText('Recursos pendientes')).toBeInTheDocument();
  });
});
