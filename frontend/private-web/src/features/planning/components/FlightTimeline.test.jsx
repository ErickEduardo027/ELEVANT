import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import FlightTimeline from './FlightTimeline';
import { createPlanningFlight } from '../testing/planningFixtures';

const FLIGHTS = [
  createPlanningFlight({ id: 'flight-a', turnaroundId: 'flight-a', operationCode: 'TAT-A' }),
  createPlanningFlight({
    id: 'flight-b',
    turnaroundId: 'flight-b',
    operationCode: 'TAT-B',
    timelineTime: '2026-08-19T13:10:00-04:00',
    scheduledTime: '2026-08-19T13:10:00-04:00',
  }),
  createPlanningFlight({
    id: 'flight-c',
    turnaroundId: 'flight-c',
    operationCode: 'TAT-C',
    timelineTime: null,
    scheduledTime: null,
  }),
];

describe('FlightTimeline', () => {
  it('groups canonical turnarounds chronologically and preserves missing-time rows', () => {
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-19T11:00:00-04:00" timeZone="America/Santo_Domingo" onSelectFlight={() => {}} />);

    expect(screen.getByText('12:00')).toBeInTheDocument();
    expect(screen.getByText('13:00')).toBeInTheDocument();
    expect(screen.getAllByText('Sin hora')).toHaveLength(2);
    expect(screen.getAllByTestId('flight-card')).toHaveLength(3);
  });

  it('returns the selected turnaround id', async () => {
    const onSelectFlight = vi.fn();
    render(<FlightTimeline flights={FLIGHTS} now="2026-08-19T11:00:00-04:00" timeZone="America/Santo_Domingo" onSelectFlight={onSelectFlight} />);

    await userEvent.click(screen.getByText('TAT-A'));
    expect(onSelectFlight).toHaveBeenCalledWith('flight-a');
  });
});
