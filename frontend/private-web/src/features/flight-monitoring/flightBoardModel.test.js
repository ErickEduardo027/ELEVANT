import { cleanup, render } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import OccFlightStrip from '../occ-ui/OccFlightStrip';
import {
  buildFlightBoard, DEFAULT_FLIGHT_BOARD_SORT, DEPARTED_AIRBORNE_MS, FLIGHT_BOARD_FILTERS, FLIGHT_BOARD_SORT_KEYS,
  FLIGHT_BOARD_STATUS_KEYS, FLIGHT_PLACES, filterBoard, findBoardFlight, flightDirection, legPlace, nextBoardSort,
  sortBoard, stripStatus,
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
    // M8: every leg here shares one visit, whose landed arrival keeps its departures on the ground with it.
    expect(result.counts).toEqual({ arrivals: 5, departures: 2, inFlight: 0, onGround: 3, all: 7 });
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
    expect(FLIGHT_BOARD_FILTERS).toEqual(['arrivals', 'departures', 'inFlight', 'onGround', 'all']);
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

describe('En vuelo y En tierra (M8)', () => {
  it('legPlace says where the aircraft of a leg is from the leg, its actual time and its map phase', () => {
    expect(FLIGHT_PLACES).toEqual({ air: 'air', ground: 'ground' });
    // An arrival: on the ground once landed or in operation, in the air while its map flight flies.
    expect(legPlace({ direction: 'Arrival', statusKey: 'scheduled' })).toBeNull();
    expect(legPlace({ direction: 'Arrival', statusKey: 'scheduled', phase: 'Enroute' })).toBe('air');
    expect(legPlace({ direction: 'Arrival', statusKey: 'scheduled', phase: 'approaching' })).toBe('air');
    expect(legPlace({ direction: 'Arrival', statusKey: 'scheduled', phase: 'landed' })).toBe('ground');
    expect(legPlace({ direction: 'Arrival', statusKey: 'landed', actualAt: at(-5) })).toBe('ground');
    expect(legPlace({ direction: 'Arrival', statusKey: 'noStand', actualAt: at(-5) })).toBe('ground');
    expect(legPlace({ direction: 'Arrival', statusKey: 'inOperation' })).toBe('ground');
    // A departure: in the air once it left, on the ground while its visit is in operation.
    expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-5) })).toBe('air');
    expect(legPlace({ direction: 'Departure', statusKey: 'scheduled', phase: 'departed' })).toBe('air');
    expect(legPlace({ direction: 'Departure', statusKey: 'inOperation' })).toBe('ground');
    expect(legPlace({ direction: 'Departure', statusKey: 'scheduled' })).toBeNull();
    // A departure whose map flight landed at its destination is no longer in the air, whatever its actual time says.
    for (const phase of ['landed', 'Arrived']) {
      expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-50), phase, nowMs: NOW }), phase)
        .toBeNull();
    }
    // Without a map phase, «En vuelo» keeps a departure that left for DEPARTED_AIRBORNE_MS at most.
    const hours = h => h * 60;
    expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-hours(2)), nowMs: NOW })).toBe('air');
    expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-DEPARTED_AIRBORNE_MS / 60_000),
      nowMs: NOW })).toBe('air');
    expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-hours(10)), nowMs: NOW })).toBeNull();
    // ...unless the map says it still flies.
    expect(legPlace({ direction: 'Departure', statusKey: 'departed', actualAt: at(-hours(10)), phase: 'enroute',
      nowMs: NOW })).toBe('air');
    // A visit that is over or will not happen is neither.
    for (const statusKey of ['cancelled', 'diverted', 'completed']) {
      expect(legPlace({ direction: 'Arrival', statusKey, actualAt: at(-5), phase: 'landed' }), statusKey).toBeNull();
    }
    expect(legPlace()).toBeNull();
  });

  it('filters the strips in the air and on the ground, deciding per visit, with the map phases when the map has read', () => {
    const flights = [
      // Landed and waiting with its departure: both on the ground.
      leg({ id: 'a-landed', flightNumber: 'ZZ101', turnaroundId: 'tat-1', actualAt: at(-20), scheduledAt: at(-30) }),
      departure({ id: 'd-waiting', flightNumber: 'ZZ102', turnaroundId: 'tat-1', scheduledAt: at(40) }),
      // Its departure left: the arrival is no longer on the ground, the departure flies.
      leg({ id: 'a-gone', flightNumber: 'ZZ201', turnaroundId: 'tat-2', actualAt: at(-90), scheduledAt: at(-95) }),
      departure({ id: 'd-gone', flightNumber: 'ZZ202', turnaroundId: 'tat-2', actualAt: at(-10), scheduledAt: at(-15) }),
      // Still at its origin as far as the snapshot knows; the map flight says it flies.
      leg({ id: 'a-enroute', flightNumber: 'ZZ301', turnaroundId: 'tat-3', scheduledAt: at(50) }),
      // Cancelled: in no list but Todos.
      leg({ id: 'a-cancelled', flightNumber: 'ZZ401', turnaroundId: 'tat-4', turnaroundStatus: 'Cancelled',
        actualAt: at(-5) }),
    ];
    const snapshotOnly = board(flights);
    expect(snapshotOnly.inFlight.map(strip => strip.id)).toEqual(['d-gone']);
    expect(snapshotOnly.onGround.map(strip => strip.id)).toEqual(['a-landed', 'd-waiting']);
    expect(snapshotOnly.all.find(strip => strip.id === 'a-enroute').place).toBeNull();
    expect(snapshotOnly.all.find(strip => strip.id === 'a-gone').place).toBeNull();
    expect(snapshotOnly.all.find(strip => strip.id === 'a-cancelled').place).toBeNull();
    expect(Object.isFrozen(snapshotOnly.all[0])).toBe(true);
    expect('ownPlace' in snapshotOnly.all[0]).toBe(false);

    // The map flights the map has read (contracts 1.3), matched by their leg id: no read of the board's own.
    const mapFlights = [{ flightKey: 'l:a-enroute', legId: 'a-enroute', direction: 'Arrival', phase: 'enroute' }];
    const withMap = board(flights, { mapFlights });
    expect(withMap.inFlight.map(strip => strip.id)).toEqual(['d-gone', 'a-enroute']);
    expect(withMap.counts).toMatchObject({ inFlight: 2, onGround: 2, all: 6 });
    expect(filterBoard(withMap, 'inFlight', 'zz3').map(strip => strip.id)).toEqual(['a-enroute']);
    expect(filterBoard(withMap, 'onGround').map(strip => strip.id)).toEqual(['a-landed', 'd-waiting']);
    // Llegadas, Salidas and Todos keep their meaning.
    expect(filterBoard(withMap, 'arrivals').map(strip => strip.id))
      .toEqual(['a-gone', 'a-landed', 'a-cancelled', 'a-enroute']);
    expect(filterBoard(withMap, 'departures').map(strip => strip.id)).toEqual(['d-gone', 'd-waiting']);
  });

  it('takes a departure out of «En vuelo» once its map flight landed or it left hours ago', () => {
    const flights = [
      // PUJ→SDQ: left 40 minutes ago, the map says it landed at Santo Domingo.
      departure({ id: 'd-landed', flightNumber: 'ZZ501', turnaroundId: 'tat-5', actualAt: at(-40), scheduledAt: at(-45) }),
      // Left this morning, ten hours ago, and the map does not list it any more.
      departure({ id: 'd-morning', flightNumber: 'ZZ601', turnaroundId: 'tat-6', actualAt: at(-600),
        scheduledAt: at(-605) }),
      // Left an hour ago: still in the air.
      departure({ id: 'd-flying', flightNumber: 'ZZ701', turnaroundId: 'tat-7', actualAt: at(-60), scheduledAt: at(-65) }),
    ];
    const mapFlights = [{ flightKey: 'l:d-landed', legId: 'd-landed', direction: 'Departure', phase: 'landed' }];
    const result = board(flights, { mapFlights });
    expect(result.inFlight.map(strip => strip.id)).toEqual(['d-flying']);
    expect(result.all.find(strip => strip.id === 'd-landed').place).toBeNull();
    expect(result.all.find(strip => strip.id === 'd-morning').place).toBeNull();
    expect(result.departures.map(strip => strip.id)).toEqual(['d-morning', 'd-flying', 'd-landed']);
    expect(result.counts.inFlight).toBe(1);
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

describe('sortBoard (CN-32)', () => {
  const strips = board([
    leg({ id: 'a1', flightNumber: 'ZZ300', origin: 'MIA', stand: 'B21', scheduledAt: at(40) }),
    leg({ id: 'a2', flightNumber: 'ZZ101', origin: 'SDQ', stand: null, scheduledAt: at(10) }),
    departure({ id: 'd1', flightNumber: 'ZZ20', destination: 'BOG', stand: 'A5', scheduledAt: at(25) }),
    leg({ id: 'a3', flightNumber: 'ZZ9', origin: null, stand: 'A12', scheduledAt: null, eta: null }),
  ]).all;
  const ids = sort => sortBoard(strips, sort).map(strip => strip.id);

  it('opens by time and sorts by any column of the header, either way, with what lacks the value last', () => {
    expect(FLIGHT_BOARD_SORT_KEYS).toEqual(['time', 'flight', 'status', 'route', 'stand']);
    expect(DEFAULT_FLIGHT_BOARD_SORT).toEqual({ key: 'time', direction: 'ascending' });
    expect(ids()).toEqual(['a2', 'd1', 'a1', 'a3']);
    expect(ids({ key: 'time', direction: 'descending' })).toEqual(['a1', 'd1', 'a2', 'a3']);
    // Flight numbers in natural order: ZZ9 before ZZ20.
    expect(ids({ key: 'flight', direction: 'ascending' })).toEqual(['a3', 'd1', 'a2', 'a1']);
    expect(ids({ key: 'route', direction: 'ascending' })).toEqual(['d1', 'a1', 'a2', 'a3']);
    expect(ids({ key: 'stand', direction: 'descending' })).toEqual(['a1', 'a3', 'd1', 'a2']);
    // By status: what asks for attention first (the arrival without a stand due within the hour), then by the words.
    expect(ids({ key: 'status', direction: 'ascending' })[0]).toBe('a2');
    // A new array: the board keeps its own order.
    expect(strips.map(strip => strip.id)).toEqual(['a2', 'd1', 'a1', 'a3']);
    expect(() => sortBoard(strips, { key: 'airline', direction: 'ascending' })).toThrow(RangeError);
    expect(() => sortBoard(strips, { key: 'time', direction: 'up' })).toThrow(RangeError);
  });

  it('a click on a column sorts by it, and a second click turns the order', () => {
    expect(nextBoardSort(DEFAULT_FLIGHT_BOARD_SORT, 'flight')).toEqual({ key: 'flight', direction: 'ascending' });
    expect(nextBoardSort({ key: 'flight', direction: 'ascending' }, 'flight')).toEqual({ key: 'flight', direction: 'descending' });
    expect(nextBoardSort({ key: 'flight', direction: 'descending' }, 'flight')).toEqual({ key: 'flight', direction: 'ascending' });
  });

  it('each strip carries its delay: the minutes its best time runs past the scheduled one', () => {
    const late = board([leg({ id: 'late', scheduledAt: at(10), estimatedAt: at(28) }), leg({ id: 'on', scheduledAt: at(10) })]);
    expect(late.all.map(strip => [strip.id, strip.delayMinutes])).toEqual([['on', null], ['late', 18]]);
  });
});
