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

  it('«Agente» is who covers the visit (N26): the aircraft on the stand now, the one to come at its chocks', () => {
    const agentOf = position => {
      cleanup();
      render(<StandTurnaround position={position} />);
      return screen.getByTestId('stand-turnaround').querySelector('[data-fact="agent"] dd').textContent;
    };
    const live = (now, visit) => ({ live: true, now, visit, ended: [], upcoming: [], windows: [] });
    const marta = { name: 'Marta', isReinforcement: false };
    // Her coverage ended: nobody covers the aircraft on the stand, whatever the names of the day say.
    expect(agentOf({ ...occupied, display: { ...occupied.display, coverage: live([], []) } })).toBe('Sin agente');
    // The flight to come: who covers the stand when it gets there, not who covers it now.
    const coming = { ...occupied.display, state: 'planned', coverage: live([marta], [{ name: 'Luis Peña', isReinforcement: false }]) };
    expect(agentOf({ ...occupied, coveredBy: ['Marta', 'Luis Peña'], display: coming })).toBe('Luis Peña');
    // Another date, or no windows: the names of the day.
    expect(agentOf({ ...occupied, display: { ...occupied.display, coverage: { ...live([], null), live: false } } }))
      .toBe('Marta');
  });

  it('the arrival tells its landing from its stand: «Aterrizó» and «En posición», never «Real» (N23)', () => {
    // WN9001 on 16 November: due on the stand at 19:54, on the runway at 19:49, on the stand at 19:54:40 (UTC−4).
    const at = time => Date.parse(`2026-11-16T${time}Z`);
    const arrival = { scheduledAt: at('23:54:00'), estimatedAt: at('23:54:00'), landedAt: at('23:49:12'),
      onStandAt: at('23:54:40'), onStandRecorded: true, actualAt: at('23:54:40') };
    expect(legTimes(arrival, t, 'es-DO')).toBe('Prog. 19:54 · Est. 19:54 · Aterrizó 19:49 · En posición 19:54');
    expect(legTimes(arrival, createTranslator(mapMessages, 'en'), 'en-US'))
      .toBe('Sched. 19:54 · Est. 19:54 · Landed 19:49 · On stand 19:54');
    // Landed and still taxiing in; OCC's on-block, with no runway time known.
    expect(legTimes({ ...arrival, onStandAt: null, onStandRecorded: false, actualAt: at('23:49:12') }, t, 'es-DO'))
      .toBe('Prog. 19:54 · Est. 19:54 · Aterrizó 19:49');
    expect(legTimes({ scheduledAt: at('23:54:00'), estimatedAt: null, landedAt: null, onStandAt: at('23:55:00'),
      onStandRecorded: true, actualAt: at('23:55:00') }, t, 'es-DO')).toBe('Prog. 19:54 · En posición 19:55');
    // An actual time that tells no kind, the board's arrival time alone or a departure's, is still «Real».
    expect(legTimes({ scheduledAt: at('23:54:00'), estimatedAt: null, landedAt: null, onStandAt: null,
      onStandRecorded: false, actualAt: at('23:49:12') }, t, 'es-DO')).toBe('Prog. 19:54 · Real 19:49');

    render(<StandTurnaround position={{ ...occupied, display: { ...occupied.display,
      detail: { ...occupied.display.detail, arrival } } }} />);
    const row = screen.getByTestId('stand-turnaround').querySelector('[data-fact="arrival"]');
    expect(row).toHaveTextContent('Prog. 19:54 · Est. 19:54 · Aterrizó 19:49 · En posición 19:54');
    expect(row).not.toHaveTextContent(/Real/);
  });

  it('«Operación» says the state of the ground operation, not the turnaround state «Confirmada»', () => {
    const withStatus = (detail, visitStatus = 'Confirmed') => ({ ...occupied, display: { ...occupied.display,
      visit: { ...occupied.display.visit, status: visitStatus }, detail: { ...occupied.display.detail, ...detail } } });
    const operation = () => screen.getByTestId('stand-turnaround').querySelector('[data-fact="operation"]');
    // The tablet started it («En atención» on the tablet): OCC reads the operation in its own words.
    render(<StandTurnaround position={withStatus({ operationStatus: 'InProgress', turnaroundStatus: 'Confirmed' })} />);
    expect(operation()).toHaveTextContent('En curso');
    cleanup();
    render(<StandTurnaround position={withStatus({ operationStatus: 'Returned', turnaroundStatus: 'Confirmed' })} />);
    expect(operation()).toHaveTextContent('Devuelta');
    cleanup();
    render(<StandTurnaround position={withStatus({ operationStatus: 'Assigned', turnaroundStatus: 'Confirmed' })} />);
    expect(operation()).toHaveTextContent('Asignada');
    cleanup();
    // Without an operation yet, the turnaround's own state.
    render(<StandTurnaround position={withStatus({ operationStatus: null, turnaroundStatus: 'Confirmed' })} />);
    expect(operation()).toHaveTextContent('Confirmada');
  });

  it('draws nothing on a stand without a visit', () => {
    render(<StandTurnaround position={{ id: 'A1', status: 'available', display: { state: 'available', visit: null, next: null } }} />);
    expect(screen.queryByTestId('stand-turnaround')).toBeNull();
  });
});
