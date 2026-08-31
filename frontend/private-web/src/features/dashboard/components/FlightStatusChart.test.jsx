import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightStatusChart from './FlightStatusChart';

const DISTRIBUTION = [
  { status: 'scheduled', count: 14 },
  { status: 'enRoute', count: 9 },
  { status: 'landed', count: 11 },
  { status: 'delayed', count: 5 },
  { status: 'diverted', count: 1 },
  { status: 'cancelled', count: 2 },
];

describe('FlightStatusChart', () => {
  it('renders one legend row per status with its label and count', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getByText('Programado')).toBeInTheDocument();
    expect(screen.getByText('14')).toBeInTheDocument();
    expect(screen.getByText('Cancelado')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('renders one donut segment per distribution entry', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getAllByTestId('donut-segment')).toHaveLength(DISTRIBUTION.length);
  });

  it('renders the total flight count in the center of the donut', () => {
    render(<FlightStatusChart distribution={DISTRIBUTION} />);
    expect(screen.getByText('42')).toBeInTheDocument();
  });
});
