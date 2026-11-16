import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import ModulePlaceholder from './ModulePlaceholder';
import { CalendarIcon } from './icons';

describe('ModulePlaceholder', () => {
  it('renders the module label and description', () => {
    render(
      <ModulePlaceholder
        icon={CalendarIcon}
        label="Planificación operativa"
        description="Consulta de itinerarios y asignación de agentes y posiciones."
      />
    );
    expect(screen.getByText('Planificación operativa')).toBeInTheDocument();
    expect(screen.getByText(/consulta de itinerarios/i)).toBeInTheDocument();
    expect(screen.getByText(/en construcción/i)).toBeInTheDocument();
  });
});