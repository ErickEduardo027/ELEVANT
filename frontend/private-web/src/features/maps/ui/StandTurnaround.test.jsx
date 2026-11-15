import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../mapMessages';
import StandTurnaround, { countdownOf, legTimes } from './StandTurnaround';

afterEach(cleanup);
const t = createTranslator(mapMessages, 'es');
const NOON = Date.parse('2026-11-13T16:00:00Z');

const occupied = {
  id: 'A2', coveredBy: ['Marta'],
  display: {
    state: 'occupied', minutesToArrival: -30, minutesToDeparture: 40, flightNumber: 'ZZ301', aircraftType: 'B738',
    visit: { arrivalFlightNumber: 'ZZ300', departureFlightNumber: 'ZZ301', airlineName: 'Aerolínea', status: 'InProgress' },
    detail: { airline: 'Aerolínea', registration: 'HI0300', origin: 'MIA', destination: 'SDQ', operationStatus: 'InProgress',
      arrival: { scheduledAt: NOON - 30 * 60_000, estimatedAt: null, actualAt: NOON - 25 * 60_000 },
      departure: { scheduledAt: NOON + 40 * 60_000, estimatedAt: NOON + 45 * 60_000, actualAt: null }, legs: [] },
    next: { flightNumber: 'ZZ500', arrivalAt: NOON + 120 * 60_000, minutesToArrival: 120 },
  },
};

describe('StandTurnaround (owner request of 2026-11-15)', () => {
  it('the times of a leg and the countdown of what comes next', () => {
    expect(legTimes(occupied.display.detail.departure, t, 'es-DO')).toMatch(/^Prog\. \d\d:\d\d · Est\. \d\d:\d\d$/);
    expect(legTimes({}, t, 'es-DO')).toBeNull();
    expect(countdownOf(occupied.display, t)).toBe('Sale en 40 min');
    expect(countdownOf({ state: 'planned', minutesToArrival: 12, minutesToDeparture: 70 }, t)).toBe('Llega en 12 min');
    expect(countdownOf({ ...occupied.display, minutesToDeparture: -5 }, t)).toBe('Debía salir hace 5 min');
  });

  it('draws the turnaround on the stand and the next one', () => {
    render(<StandTurnaround position={occupied} />);
    const section = screen.getByTestId('stand-turnaround');
    const fact = name => section.querySelector(`[data-fact="${name}"]`);
    expect(fact('flight')).toHaveTextContent('ZZ300 / ZZ301');
    expect(fact('aircraft')).toHaveTextContent('B738 · HI0300');
    expect(fact('route')).toHaveTextContent('MIA – SDQ');
    expect(fact('agent')).toHaveTextContent('Marta');
    expect(fact('operation')).toHaveTextContent('En curso');
    expect(fact('arrival')).toHaveTextContent(/Real \d\d:\d\d/);
    expect(fact('next')).toHaveTextContent(/ZZ500 · llega \d\d:\d\d · en 120 min/);
  });

  it('draws nothing on a stand without a visit', () => {
    render(<StandTurnaround position={{ id: 'A1', status: 'available', display: { state: 'available', visit: null, next: null } }} />);
    expect(screen.queryByTestId('stand-turnaround')).toBeNull();
  });
});
