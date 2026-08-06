import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PlanningDrawer from './PlanningDrawer';

const FLIGHT = {
  id: 'flt-1',
  flightNumber: 'DM161',
  airlineName: 'ARAJET',
  status: 'scheduled',
  scheduledTime: '2026-08-05T08:05:00-04:00',
  estimatedTime: '2026-08-05T08:05:00-04:00',
  origin: 'PUJ',
  destination: 'JFK',
  aircraftType: 'A320',
  position: 'A5',
  supervisor: 'J. Ramírez',
  agents: ['M. Castillo', 'R. Peña'],
  teams: ['Rampa 2'],
  services: ['Combustible'],
  observations: 'Sin novedades.',
  history: [{ at: '2026-08-05T07:00:00-04:00', note: 'Planificación creada' }],
};

describe('PlanningDrawer', () => {
  it('renders nothing when there is no selected flight', () => {
    const { container } = render(<PlanningDrawer flight={null} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders every detail section for the selected flight', () => {
    render(<PlanningDrawer flight={FLIGHT} onClose={() => {}} />);
    expect(screen.getByText('DM161 · ARAJET')).toBeInTheDocument();
    expect(screen.getByText('PUJ → JFK')).toBeInTheDocument();
    expect(screen.getByText('A320')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('M. Castillo, R. Peña')).toBeInTheDocument();
    expect(screen.getByText('Rampa 2')).toBeInTheDocument();
    expect(screen.getByText('Combustible')).toBeInTheDocument();
    expect(screen.getByText('Sin novedades.')).toBeInTheDocument();
    expect(screen.getByText('Planificación creada')).toBeInTheDocument();
  });

  it('shows a fallback message in the history section when there are no events', () => {
    render(<PlanningDrawer flight={{ ...FLIGHT, history: [] }} onClose={() => {}} />);
    expect(screen.getByText('Sin eventos registrados')).toBeInTheDocument();
  });

  it('disables the three action buttons with a "Próximamente" tooltip', () => {
    render(<PlanningDrawer flight={FLIGHT} onClose={() => {}} />);
    for (const label of ['Editar planificación', 'Asignar recursos', 'Crear Work Order']) {
      const button = screen.getByRole('button', { name: label });
      expect(button).toBeDisabled();
      expect(button).toHaveAttribute('title', 'Próximamente');
    }
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<PlanningDrawer flight={FLIGHT} onClose={onClose} />);
    await userEvent.click(screen.getByRole('button', { name: 'Cerrar detalle' }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
