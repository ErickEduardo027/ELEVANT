import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightTimeline from './FlightTimeline';

function flight(overrides) {
  return {
    id: 'flt-x',
    flightNumber: 'DM161',
    airlineIata: 'DM',
    airlineName: 'ARAJET',
    status: 'scheduled',
    scheduledTime: '2026-08-05T08:05:00-04:00',
    origin: 'PUJ',
    destination: 'JFK',
    aircraftType: 'A320',
    position: 'A5',
    supervisor: 'J. Ramírez',
    agents: ['M. Castillo'],
    teams: [],
    conflict: null,
    ...overrides,
  };
}

const FLIGHTS = [
  flight({ id: 'a', flightNumber: 'DM161', scheduledTime: '2026-08-05T08:05:00-04:00' }),
  flight({ id: 'b', flightNumber: 'AA904', scheduledTime: '2026-08-05T08:45:00-04:00' }),
  flight({ id: 'c', flightNumber: 'B6289', scheduledTime: '2026-08-05T09:10:00-04:00' }),
];

describe('FlightTimeline', () => {
  it('groups flights under hour dividers in chronological order', () => {
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-05T07:00:00-04:00" onSelectFlight={() => {}} />);
    expect(screen.getByText('08:00')).toBeInTheDocument();
    expect(screen.getByText('09:00')).toBeInTheDocument();
    expect(screen.getAllByTestId('flight-card')).toHaveLength(3);
  });

  it('calls onSelectFlight with the clicked flight id', async () => {
    const onSelectFlight = vi.fn();
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-05T07:00:00-04:00" onSelectFlight={onSelectFlight} />);
    await userEvent.click(screen.getByText('DM161 · ARAJET'));
    expect(onSelectFlight).toHaveBeenCalledWith('a');
  });
});
