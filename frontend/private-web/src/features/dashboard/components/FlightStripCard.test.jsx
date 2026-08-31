import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightStripCard from './FlightStripCard';

describe('FlightStripCard', () => {
  it('renders primary, secondary, and meta text', () => {
    render(
      <FlightStripCard
        accentColor="#D9A441"
        primary="DM161 · DM"
        secondary="PUJ · J. Ramírez"
        meta="13:50"
      />
    );
    expect(screen.getByText('DM161 · DM')).toBeInTheDocument();
    expect(screen.getByText('PUJ · J. Ramírez')).toBeInTheDocument();
    expect(screen.getByText('13:50')).toBeInTheDocument();
  });

  it('applies the accent color to the left border', () => {
    render(<FlightStripCard accentColor="#C4453C" primary="Alerta" />);
    expect(screen.getByTestId('flight-strip')).toHaveStyle({ borderLeftColor: '#C4453C' });
  });

  it('renders an optional badge node', () => {
    render(
      <FlightStripCard accentColor="#145DC4" primary="DM161" badge={<span>Pendiente</span>} />
    );
    expect(screen.getByText('Pendiente')).toBeInTheDocument();
  });
});
