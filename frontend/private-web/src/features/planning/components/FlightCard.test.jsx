import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightCard from './FlightCard';

const FLIGHT = {
  id: 'flt-2',
  flightNumber: 'AA904',
  airlineIata: 'AA',
  airlineName: 'AMERICAN',
  status: 'delayed',
  scheduledTime: '2026-08-05T08:20:00-04:00',
  estimatedTime: '2026-08-05T08:50:00-04:00',
  origin: 'PUJ',
  destination: 'MIA',
  aircraftType: 'B737-800',
  position: 'B21',
  supervisor: 'K. Objío',
  agents: [],
  teams: [],
  conflict: { reason: 'Posición B21 con doble asignación' },
};

describe('FlightCard', () => {
  it('renders flight identity, status, route, aircraft, position, and countdown', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={() => {}} />);
    expect(screen.getByText('AA904 · AMERICAN')).toBeInTheDocument();
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
    expect(screen.getByText('PUJ → MIA')).toBeInTheDocument();
    expect(screen.getByText('B737-800')).toBeInTheDocument();
    expect(screen.getAllByText('B21').length).toBeGreaterThan(0);
    expect(screen.getByText('En 45 min')).toBeInTheDocument();
  });

  it('renders the conflict indicator when the flight has a conflict', () => {
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={() => {}} />);
    expect(screen.getByText('Conflicto')).toBeInTheDocument();
  });

  it('calls onSelect with the flight id when the card body is clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('flight-card'));
    expect(onSelect).toHaveBeenCalledWith('flt-2');
  });

  it('calls onSelect exactly once when a quick action button is clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightCard flight={FLIGHT} now="2026-08-05T07:35:00-04:00" onSelect={onSelect} />);
    await userEvent.click(screen.getByRole('button', { name: 'Ver detalle' }));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('flt-2');
  });
});
