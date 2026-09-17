import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightCard from './FlightCard';
import { createPlanningFlight } from '../testing/planningFixtures';

const FLIGHT = createPlanningFlight();

describe('FlightCard', () => {
  it('renders one canonical turnaround with arrival and departure legs', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-19T11:45:00-04:00" onSelect={() => {}} />);

    expect(screen.getByText('DEV-TAT-0002')).toBeInTheDocument();
    expect(screen.getByText('Confirmada')).toBeInTheDocument();
    expect(screen.getByText('ZZ · Demo Airlines')).toBeInTheDocument();
    expect(screen.getByText('ZZ102')).toBeInTheDocument();
    expect(screen.getByText('SDQ → PUJ')).toBeInTheDocument();
    expect(screen.getByText('ZZ103')).toBeInTheDocument();
    expect(screen.getByText('PUJ → JFK')).toBeInTheDocument();
    expect(screen.getAllByText('A02')).toHaveLength(2);
    expect(screen.getByText('En 30 min')).toBeInTheDocument();
  });

  it('shows truthful fallbacks for missing legs and assignments', () => {
    const flight = createPlanningFlight({
      arrival: null,
      departure: null,
      position: null,
      terminalCode: null,
      assignedAgents: [],
      assignedEquipment: [],
      assignedServices: [],
      hasAssignmentGap: true,
    });
    render(<FlightCard flight={flight} now="2026-08-19T11:45:00-04:00" onSelect={() => {}} />);

    expect(screen.getAllByText(/sin tramo registrado/i)).toHaveLength(2);
    expect(screen.getByText('Sin posición')).toBeInTheDocument();
    expect(screen.getByText('Recursos pendientes')).toBeInTheDocument();
    expect(screen.getByText('Requiere recursos')).toBeInTheDocument();
  });

  it('selects the turnaround from either the card or its read-only detail action', async () => {
    const onSelect = vi.fn();
    const { rerender } = render(<FlightCard flight={FLIGHT} now="2026-08-19T11:45:00-04:00" onSelect={onSelect} />);

    await userEvent.click(screen.getByTestId('flight-card'));
    expect(onSelect).toHaveBeenLastCalledWith(FLIGHT.id);

    onSelect.mockClear();
    rerender(<FlightCard flight={FLIGHT} now="2026-08-19T11:45:00-04:00" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(FLIGHT.id);
  });

  it('keeps all write quick actions disabled', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-19T11:45:00-04:00" onSelect={() => {}} />);

    for (const label of ['Editar', 'Asignar recursos', 'Crear Work Order']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Próximamente');
    }
    expect(screen.getByRole('button', { name: 'Ver detalle' })).toBeEnabled();
  });
});
