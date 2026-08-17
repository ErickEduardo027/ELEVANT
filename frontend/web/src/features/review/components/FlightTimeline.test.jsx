import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightTimeline from './FlightTimeline';

describe('FlightTimeline', () => {
  it('renders every documented timeline step label', () => {
    render(<FlightTimeline timeline={{ blocksOn: '2026-08-05T14:20:00-04:00' }} />);
    expect(screen.getByText('Blocks On')).toBeInTheDocument();
    expect(screen.getByText('Blocks Off')).toBeInTheDocument();
    expect(screen.getByText('Apertura de puertas')).toBeInTheDocument();
    expect(screen.getByText('Primer pasajero')).toBeInTheDocument();
    expect(screen.getByText('Último equipaje')).toBeInTheDocument();
  });

  it('marks steps without a recorded time as "Sin registro"', () => {
    render(<FlightTimeline timeline={{ blocksOn: '2026-08-05T14:20:00-04:00' }} />);
    expect(screen.getAllByText('Sin registro').length).toBeGreaterThan(0);
  });

  it('formats a recorded step time as HH:MM', () => {
    render(<FlightTimeline timeline={{ blocksOn: '2026-08-05T14:20:00-04:00' }} />);
    expect(screen.getByText(/^\d{1,2}:\d{2}$/)).toBeInTheDocument();
  });
});
