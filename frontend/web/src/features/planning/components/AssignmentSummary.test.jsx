import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import AssignmentSummary from './AssignmentSummary';

describe('AssignmentSummary', () => {
  it('renders position, supervisor, agent count, and team count when all are present', () => {
    render(
      <AssignmentSummary position="A5" supervisor="J. Ramírez" agents={['M. Castillo', 'R. Peña']} teams={['Rampa 2']} />
    );
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('J. Ramírez')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
    expect(screen.getByText('1 equipo')).toBeInTheDocument();
  });

  it('pluralizes the team count', () => {
    render(<AssignmentSummary position="A5" supervisor="J. Ramírez" agents={[]} teams={['Rampa 1', 'Rampa 2']} />);
    expect(screen.getByText('2 equipos')).toBeInTheDocument();
  });

  it('shows a fallback message when nothing is assigned', () => {
    render(<AssignmentSummary position={null} supervisor={null} agents={[]} teams={[]} />);
    expect(screen.getByText('Sin asignar')).toBeInTheDocument();
  });
});
