import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListPanel from './FlightListPanel';

const FLIGHTS = [
  { id: 1, flightNumber: 'DM161', airline: 'Arajet', status: 'approaching', origin: 'MIA', destination: 'PUJ', eta: '2026-08-06T14:20:00-04:00', stand: 'A5', supervisor: 'Juan Pérez' },
  { id: 2, flightNumber: 'AA904', airline: 'American', status: 'delayed', origin: 'PUJ', destination: 'MIA', eta: '2026-08-06T08:20:00-04:00', stand: 'B21', supervisor: 'K. Objío' },
];

describe('FlightListPanel', () => {
  it('renders the search box, chips, and every flight', () => {
    render(
      <FlightListPanel
        flights={FLIGHTS}
        emptyReason={null}
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={() => {}}
      />
    );
    expect(screen.getByPlaceholderText('Número, aerolínea, matrícula o supervisor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Todos' })).toBeInTheDocument();
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('AA904')).toBeInTheDocument();
  });

  it('renders the empty state instead of the list when emptyReason is set', () => {
    render(
      <FlightListPanel
        flights={[]}
        emptyReason="no-results"
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={() => {}}
      />
    );
    expect(screen.getByText('Sin resultados')).toBeInTheDocument();
    expect(screen.queryByText('DM161')).not.toBeInTheDocument();
  });

  it('forwards selection to the clicked flight item', async () => {
    const onSelectFlight = vi.fn();
    render(
      <FlightListPanel
        flights={FLIGHTS}
        emptyReason={null}
        search=""
        onSearchChange={() => {}}
        activeChip="all"
        onChipChange={() => {}}
        selectedFlightId={null}
        onSelectFlight={onSelectFlight}
      />
    );
    await userEvent.click(screen.getByText('DM161'));
    expect(onSelectFlight).toHaveBeenCalledWith(1);
  });
});
