import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightInfoSection from './FlightInfoSection';

const OPERATION = {
  flight: { number: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX 8', registration: 'HI1024' },
  schedule: { sta: '2026-08-05T14:20:00-04:00', ata: '2026-08-05T14:27:00-04:00', std: null, atd: null },
  position: 'A5',
};

describe('FlightInfoSection', () => {
  it('renders every documented flight field', () => {
    render(<FlightInfoSection operation={OPERATION} />);
    expect(screen.getByText('DM161')).toBeInTheDocument();
    expect(screen.getByText('Arajet')).toBeInTheDocument();
    expect(screen.getByText('MIA')).toBeInTheDocument();
    expect(screen.getByText('PUJ')).toBeInTheDocument();
    expect(screen.getByText('B737 MAX 8')).toBeInTheDocument();
    expect(screen.getByText('HI1024')).toBeInTheDocument();
    expect(screen.getByText('A5')).toBeInTheDocument();
  });

  it('shows "Sin registro" for a missing schedule timestamp', () => {
    render(<FlightInfoSection operation={OPERATION} />);
    expect(screen.getAllByText('Sin registro').length).toBeGreaterThanOrEqual(2);
  });
});
