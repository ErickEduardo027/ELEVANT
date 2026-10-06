import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightListItem from './FlightListItem';

const FLIGHT = {
  id: 2,
  flightNumber: 'AA904',
  airline: 'American',
  status: 'delayed',
  origin: 'PUJ',
  destination: 'MIA',
  eta: '2026-08-06T08:20:00-04:00',
  stand: 'B21',
  supervisor: 'K. Objío',
};

describe('FlightListItem', () => {
  it('renders identity, status, route, stand, and supervisor', () => {
    render(<FlightListItem flight={FLIGHT} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('AA904')).toBeInTheDocument();
    expect(screen.getByText('American')).toBeInTheDocument();
    expect(screen.getByText('Retrasado')).toBeInTheDocument();
    expect(screen.getByText('PUJ → MIA')).toBeInTheDocument();
    expect(screen.getByText('B21')).toBeInTheDocument();
    expect(screen.getByText('K. Objío')).toBeInTheDocument();
  });

  it('shows a fallback when there is no stand', () => {
    render(<FlightListItem flight={{ ...FLIGHT, stand: null }} selected={false} onSelect={() => {}} />);
    expect(screen.getByText('Sin stand')).toBeInTheDocument();
  });

  it('applies the selected ring style when selected', () => {
    render(<FlightListItem flight={FLIGHT} selected onSelect={() => {}} />);
    expect(screen.getByTestId('flight-list-item')).toHaveClass('border-signal-500');
  });

  it('calls onSelect with the flight id when clicked', async () => {
    const onSelect = vi.fn();
    render(<FlightListItem flight={FLIGHT} selected={false} onSelect={onSelect} />);
    await userEvent.click(screen.getByTestId('flight-list-item'));
    expect(onSelect).toHaveBeenCalledWith(2);
  });
});