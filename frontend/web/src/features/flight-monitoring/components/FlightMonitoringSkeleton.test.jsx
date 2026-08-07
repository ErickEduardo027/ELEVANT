import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import FlightMonitoringSkeleton from './FlightMonitoringSkeleton';

describe('FlightMonitoringSkeleton', () => {
  it('renders a skeleton placeholder for the toolbar+list+map layout', () => {
    render(<FlightMonitoringSkeleton />);
    expect(screen.getByTestId('flight-monitoring-skeleton')).toBeInTheDocument();
  });
});
