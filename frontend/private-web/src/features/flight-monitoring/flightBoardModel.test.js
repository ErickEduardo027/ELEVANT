import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import OccFlightStrip from '../occ-ui/OccFlightStrip';
import {
  buildFlightBoard, FLIGHT_BOARD_FILTERS, FLIGHT_BOARD_STATUS_KEYS, filterBoard, findBoardFlight, flightDirection,
  stripStatus,
} from './flightBoardModel';
import { flightMonitoringMessages } from './flightMonitoringMessages';

afterEach(cleanup);

const t = createTranslator(flightMonitoringMessages, 'es');
const ZONE = 'America/Santo_Domingo';
// 14:00 at Punta Cana (UTC−4).
const NOW = Date.parse('2026-11-14T18:00:00Z');
const at = minutes => new Date(NOW + minutes * 60_000).toISOString();

// A leg of the planning snapshot as flightMonitoringService.js maps it. Synthetic: invented numbers and registrations.
function leg(overrides = {}) {
  return {
    id: 'leg-1', turnaroundId: 'tat-1', direction: 'arrival', flightNumber: 'ZZ101', airline: 'Aerolínea de prueba',
    origin: 'MIA', destination: 'PUJ', registration: 'HI1001', aircraft: 'A320-200', status: 'scheduled',
    scheduledAt: at(30), estimatedAt: null, actualAt: null, isDemo: false, turnaroundStatus: 'Confirmed',
    operationStatus: 'Assigned', eta: at(30), etd: null, actualArrival: null, actualDeparture: null, stand: 'A5',
    supervisor: null, agents: 1, services: ['Equipaje'], ...overrides,
  };
}

const departure = overrides => leg({ direction: 'departure', origin: 'PUJ', destination: 'MIA', eta: null, ...overrides });
const board = (flights, options) => buildFlightBoard(flights, { nowMs: NOW, t, stationCode: 'PUJ', ...options });

describe('buildFlightBoard', () => {
  it('sorts arrivals and departures by best time, then number and id', () => {
    const flights = [
      leg({ id: 'a-late', flightNumber: 'ZZ300', scheduledAt: at(90) }),
      departure({ id: 'd-1', flightNumber: 'ZZ401', scheduledAt: at(20) }),
      // The best time is the actual one, then the estimate, then the schedule.
      leg({ id: 'a-landed', flightNumber: 'ZZ120', scheduledAt: at(40), actualAt: at(-5) }),
      leg({ id: 'a-b', flightNumber: 'ZZ200', scheduledAt: at(60), estimatedAt: at(10) }),
      leg({ id: 'a-a', flightNumber: 'ZZ200', scheduledAt: at(10) }),
      leg({ id: 'a-tie', flightNumber: 'ZZ199', scheduledAt: at(10) }),
      // A leg without any time goes last.
      departure({ id: 'd-none', flightNumber: 'ZZ001', scheduledAt: null }),
    ];
    const result = board(flights);
    expect(result.arrivals.map(strip => strip.id)).toEqual(['a-landed', 'a-tie', 'a-a', 'a-b', 'a-late']);
    expect(result.departures.map(strip => strip.id)).toEqual(['d-1', 'd-none']);
    expect(result.all.map(strip => strip.id)).toEqual(['a-landed', 'a-tie', 'a-a', 'a-b', 'd-1', 'a-late', 'd-none']);
    expect(result.counts).toEqual({ arrivals: 5, departures: 2, all: 7 });
    expect(Object.isFrozen(result) && Object.isFrozen(result.all) && Object.isFrozen(result.all[0])).toBe(true);
  });

  it('says real, est. or prog. next to each time', () => {
    const result = board([
      leg({ id: 'actual', flightNumber: 'ZZ101', actualAt: at(-10), estimatedAt: at(-12) }),
      leg({ id: 'estimated', flightNumber: 'ZZ102', estimatedAt: at(25) }),
      departure({ id: 'scheduled', flightNumber: 'ZZ103', scheduledAt: at(70) }),
    ]);
    expect(result.all.map(strip => [strip.id, strip.time.kind])).toEqual([
      ['actual', 'actual'], ['estimated', 'estimated'], ['scheduled', 'scheduled'],
    ]);
    // The strip writes the kind next to the clock, in the station's time.
    render(createElement('div', null, ...result.all.map(strip => createElement(OccFlightStrip, {
      key: strip.id, flight: strip, now: NOW, timeZone: ZONE,
    }))));
    const words = [...document.querySelectorAll('[data-part="time"]')].map(cell => cell.textContent);
    expect(words).toEqual(['13:50realreal', '14:25est.estimada', '15:10prog.programada']);
  });

  it('tags a demo flight and keeps estimated false without the map', () => {
    const result = board([leg({ id: 'demo', flightNumber: 'ZZ9001', isDemo: true }), leg({ id: 'plain' })]);
    expect(result.all.map(strip => [strip.id, strip.demo, strip.estimated])).toEqual([
      ['plain', false, false], ['demo', true, false],
    ]);
    // Only the server's mark: no flight number or airline makes a flight a demo one.
    expect(board([leg({ flightNumber: 'ZZ9001', isDemo: 'true' })]).all[0].demo).toBe(false);
  });

  it('an arrival without a stand due within 60 min asks for attention', () => {
    const result = board([
      leg({ id: 'soon', flightNumber: 'ZZ130', stand: null, scheduledAt: at(45) }),
      leg({ id: 'later', flightNumber: 'ZZ131', stand: null, scheduledAt: at(75) }),
      leg({ id: 'overdue', flightNumber: 'ZZ132', stand: null, scheduledAt: at(-20) }),
      leg({ id: 'with-stand', flightNumber: 'ZZ133', stand: 'A05', scheduledAt: at(45) }),
      // A departure without a stand is no arrival waiting for one.
      departure({ id: 'departure', flightNumber: 'ZZ134', stand: null, scheduledAt: at(45) }),
    ]);
    const byId = Object.fromEntries(result.all.map(strip => [strip.id, strip]));
    expect(byId.soon.status).toEqual({ key: 'noStand', label: 'Llegada sin posición asignada', signal: 'attention' });
    expect(byId.overdue.status.signal).toBe('attention');
    expect(byId.later.status).toEqual({ key: 'noStand', label: 'Llegada sin posición asignada', signal: null });
    // The stand code is normalized: A05 is A5.
    expect(byId['with-stand']).toMatchObject({ standCode: 'A5', status: { key: 'scheduled', signal: null } });
    expect(byId.departure).toMatchObject({ standCode: null, status: { key: 'scheduled', signal: null } });
  });

  it('reads the console\'s status words from the planning snapshot alone', () => {
    const cases = [
      [leg({ turnaroundStatus: 'Cancelled' }), 'cancelled', 'Cancelado', 'attention'],
      [leg({ turnaroundStatus: 'Diverted' }), 'diverted', 'Desviado', 'attention'],
      [leg({ turnaroundStatus: 'Completed' }), 'completed', 'Completada', null],
      [leg({ turnaroundStatus: 'InProgress', actualAt: at(-30) }), 'inOperation', 'En operación', null],
      [leg({ operationStatus: 'Returned' }), 'inOperation', 'En operación', null],
      [leg({ actualAt: at(-3) }), 'landed', 'Aterrizó', null],
      [departure({ actualAt: at(-3), turnaroundStatus: 'InProgress' }), 'departed', 'Salió', null],
      [leg({}), 'scheduled', 'Programado', null],
      [leg({ scheduledAt: null }), 'unknown', 'Sin estado', null],
    ];
    for (const [flight, key, label, signal] of cases) {
      expect(board([flight]).all[0].status, key).toEqual({ key, label, signal });
    }
    expect(FLIGHT_BOARD_STATUS_KEYS).toEqual(['noStand', 'scheduled', 'landed', 'departed', 'inOperation', 'cancelled',
      'diverted', 'completed', 'unknown']);
    for (const key of FLIGHT_BOARD_STATUS_KEYS) {
      expect(typeof flightMonitoringMessages.es.board.status[key], key).toBe('string');
      expect(typeof flightMonitoringMessages.en.board.status[key], key).toBe('string');
    }
    expect(stripStatus(null, {})).toEqual({ key: 'unknown', signal: null });
  });

  it('leaves out a flight that neither lands at the station nor leaves it, and reads older flights by their airports', () => {
    // A flight of the page as it was before the planning snapshot said its direction and its three times.
    const older = { id: 7, flightNumber: 'ZZ700', airline: 'Aerolínea de prueba', origin: 'MIA', destination: 'PUJ',
      status: 'approaching', eta: at(12), etd: null, stand: 'B21', agents: 0, services: [] };
    const unrelated = { ...older, id: 8, flightNumber: 'ZZ800', origin: 'MIA', destination: 'JFK' };
    const leaving = { ...older, id: 9, flightNumber: 'ZZ900', origin: 'PUJ', destination: 'YYZ', eta: null, etd: at(50) };
    const result = board([older, unrelated, leaving]);
    expect(result.all.map(strip => [strip.id, strip.direction, strip.counterpartIata, strip.time.kind])).toEqual([
      ['7', 'Arrival', 'MIA', 'estimated'], ['9', 'Departure', 'YYZ', 'estimated'],
    ]);
    expect(flightDirection(unrelated, 'PUJ')).toBeNull();
    expect(flightDirection(older, null)).toBeNull();
    expect(flightDirection({ direction: 'departure' })).toBe('Departure');
  });
});

describe('filterBoard', () => {
  const flights = [
    leg({ id: 'a1', flightNumber: 'ZZ101', airline: 'Zeta Air', registration: 'HI1001' }),
    leg({ id: 'a2', flightNumber: 'ZZ102', airline: 'Aerolínea Pérez', registration: 'HI1002', origin: 'SDQ', stand: 'B21' }),
    departure({ id: 'd1', flightNumber: 'ZZ201', airline: 'Zeta Air', registration: 'HI1001', supervisor: 'Marta Castillo' }),
  ];

  it('filters by direction and search without regard to case', () => {
    const result = board(flights);
    expect(FLIGHT_BOARD_FILTERS).toEqual(['arrivals', 'departures', 'all']);
    expect(filterBoard(result, 'arrivals').map(strip => strip.id)).toEqual(['a1', 'a2']);
    expect(filterBoard(result, 'departures').map(strip => strip.id)).toEqual(['d1']);
    expect(filterBoard(result, 'all', '  zz10 ').map(strip => strip.id)).toEqual(['a1', 'a2']);
    // The airline, the registration, the supervisor, the other airport and the stand are searched too, and accents
    // do not matter.
    expect(filterBoard(result, 'all', 'perez').map(strip => strip.id)).toEqual(['a2']);
    expect(filterBoard(result, 'arrivals', 'hi1001').map(strip => strip.id)).toEqual(['a1']);
    expect(filterBoard(result, 'all', 'MARTA').map(strip => strip.id)).toEqual(['d1']);
    expect(filterBoard(result, 'all', 'sdq').map(strip => strip.id)).toEqual(['a2']);
    expect(filterBoard(result, 'all', 'b21').map(strip => strip.id)).toEqual(['a2']);
    expect(filterBoard(result, 'departures', 'zz10')).toEqual([]);
    expect(filterBoard(null, 'all')).toEqual([]);
    expect(() => filterBoard(result, 'delayed')).toThrow(RangeError);
  });
});

describe('findBoardFlight', () => {
  it('names a flight of the page by its leg, its l: key or its turnaround, and nothing else', () => {
    const flights = [leg({ id: 'leg-a', turnaroundId: 'tat-9' }), departure({ id: 'leg-d', turnaroundId: 'tat-9' })];
    expect(findBoardFlight(flights, 'leg-d')?.id).toBe('leg-d');
    expect(findBoardFlight(flights, 'l:leg-d')?.id).toBe('leg-d');
    // A turnaround names the arrival of its visit.
    expect(findBoardFlight(flights, 'tat-9')?.id).toBe('leg-a');
    // The key of a flight only the map knows (a proposal still to import) names none of the page's.
    expect(findBoardFlight(flights, 'p:proposal-1')).toBeNull();
    expect(findBoardFlight(flights, '')).toBeNull();
    expect(findBoardFlight(null, 'leg-a')).toBeNull();
    // The page's numeric ids are read as text.
    expect(findBoardFlight([{ id: 7, direction: 'arrival' }], '7')?.id).toBe(7);
  });
});
