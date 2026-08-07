import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightDetailPopover from './FlightDetailPopover';

const FLIGHT = {
  id: 1,
  flightNumber: 'DM161',
  airline: 'Arajet',
  origin: 'MIA',
  destination: 'PUJ',
  registration: 'HI1024',
  aircraft: 'B737 MAX 8',
  status: 'approaching',
  eta: '2026-08-06T14:20:00-04:00',
  etd: '2026-08-06T15:05:00-04:00',
  altitude: 8000,
  speed: 250,
  heading: 310,
  stand: 'A5',
  supervisor: 'Juan Pérez',
  agents: 5,
  services: ['GPU', 'Baggage', 'Cleaning'],
};

describe('FlightDetailPopover', () => {
  it('renders nothing when there is no flight', () => {
    const { container } = render(<FlightDetailPopover flight={null} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(container).toBeEmptyDOMElement();
  });

  it('renders identity, route, aircraft, and operational figures', () => {
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(screen.getByText('DM161 · Arajet')).toBeInTheDocument();
    expect(screen.getByText('Aproximando')).toBeInTheDocument();
    expect(screen.getByText('MIA → PUJ · B737 MAX 8 · HI1024')).toBeInTheDocument();
    expect(screen.getByText('8,000 ft')).toBeInTheDocument();
    expect(screen.getByText('250 kt')).toBeInTheDocument();
    expect(screen.getByText('310°')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
    expect(screen.getByText('Juan Pérez')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('En 20 min')).toBeInTheDocument();
    expect(screen.getByText('Servicios: GPU, Baggage, Cleaning')).toBeInTheDocument();
  });

  it('renders the two disabled cross-module buttons', () => {
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={() => {}} />);
    expect(screen.getByRole('button', { name: 'Ver planificación' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Ver mapa de posiciones' })).toBeDisabled();
  });

  it('calls onClose when the close button is clicked', async () => {
    const onClose = vi.fn();
    render(<FlightDetailPopover flight={FLIGHT} now="2026-08-06T14:00:00-04:00" style={{}} onClose={onClose} />);
    await userEvent.click(screen.getByLabelText('Cerrar detalle'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
