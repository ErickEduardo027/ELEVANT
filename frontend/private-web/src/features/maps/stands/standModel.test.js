import { readFileSync } from 'node:fs';
import { FLIGHT_REPORT_MILESTONES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions, mapTurnaroundsToRampPositions } from '../../positions-map/positionsMapMappers';
import { AIRCRAFT_TYPES, CATEGORY_FALLBACKS } from '../aircraft/types';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { layoutStandReferences } from '../airport/layoutIndex';
import { SCENARIO_AGENTS, boardStand, boardVisit, createQaLayout, createRampScenario } from '../testing/mapFixtures';
import {
  createAirPicture, createDemoBlock, createDemoFlights, createMapFlights, TRAFFIC_FLIGHT_KEY, TRAFFIC_HEX, TRAFFIC_NOON,
} from '../testing/trafficFixtures';
import { buildSituation, toFlightsModel, toPictureModel } from '../traffic/situationModel';
import { standInputsOf } from '../traffic/standInputs';
import {
  ARRIVING_WINDOW_MS, COVERAGE_WINDOW_MS, MILESTONES_TOTAL, RELEASING_WINDOW_MS, STILL_BELOW_MS, attachStandGeometry,
  coverageInitials, deriveDisplayStatus, displayFromStatus, floorToMinute, minutesUntil, sameAgentCodes, standCoverageNames,
  standDrawState, standStateOf, unlocatedStands, visitCoverageNames, withStandDisplay,
} from './standModel';

// 14:07 in Punta Cana (UTC−4). Every time of the fixtures is relative to it.
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MINUTE = 60 * 1000;
const iso = ms => new Date(ms).toISOString();
const REFERENCES = layoutStandReferences(MDPC_LAYOUT);
const { marta, luis, ana } = SCENARIO_AGENTS;

// The stands of the positions map for a board, with their geometry, as the screens will build them.
const positionsOf = board => attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, board, iso(NOW)), MDPC_LAYOUT);
const positionOf = (code, stand) => positionsOf({ positions: [stand] }).find(position => position.id === code);
const statusAt = (stand, options = {}) => deriveDisplayStatus(positionOf('A5', stand), { nowMs: NOW, ...options });
const onA5 = (turnarounds, extra = {}) => boardStand('A05', { coveredBy: [marta], turnarounds, ...extra });
const visit = options => boardVisit({ nowMs: NOW, ...options });

describe('deriveDisplayStatus', () => {
  it('a free stand is available and a map stand with no database row is unverified', () => {
    expect(statusAt(onA5([]))).toMatchObject({ state: 'available', signals: [], visit: null, arrivalAt: null });
    const unlisted = positionsOf({ positions: [] }).find(position => position.id === 'A5');
    expect(unlisted).toMatchObject({ standId: null, status: 'unverified' });
    expect(deriveDisplayStatus(unlisted, { nowMs: NOW })).toMatchObject({ state: 'unverified', signals: [], visit: null });
    expect([ARRIVING_WINDOW_MS, RELEASING_WINDOW_MS, COVERAGE_WINDOW_MS]).toEqual([15 * MINUTE, 15 * MINUTE, 60 * MINUTE]);
  });

  it('an assigned visit more than 15 minutes out is planned, and within 15 minutes it is arriving', () => {
    const at = arrivalInMin => statusAt(onA5([visit({ arrivalInMin })]));
    expect(at(16)).toMatchObject({
      state: 'planned', arrivalAt: NOW + 16 * MINUTE, minutesToArrival: 16, flightNumber: 'DM161', isDemo: false,
    });
    expect(at(16).visit).toMatchObject({ turnaroundId: 'turn-DM161', arrivalFlightNumber: 'DM161' });
    expect(at(15)).toMatchObject({ state: 'arriving', minutesToArrival: 15 });
    expect(at(1)).toMatchObject({ state: 'arriving', minutesToArrival: 1 });
    // Late and not landed yet: still on its way.
    expect(at(-3)).toMatchObject({ state: 'arriving', minutesToArrival: -3 });
    // The board itself only says `planned` for all of them.
    expect(positionOf('A5', onA5([visit({ arrivalInMin: 15 })])).status).toBe('planned');
  });

  it('a landed flight stays arriving until the aircraft is parked: demo before onBlockAt; no BLOCK_ON with the aircraft outside the box', () => {
    // The demo flight landed 2 minutes ago: the board already says `occupied`, the server parks it at onBlockAt.
    const { board, flightsByTurnaround } = createRampScenario(NOW);
    const demo = positionsOf(board).find(position => position.id === 'A6');
    expect(demo.status).toBe('occupied');
    expect(deriveDisplayStatus(demo, { nowMs: NOW, flightsByTurnaround })).toMatchObject({
      state: 'arriving', minutesToArrival: 3, flightNumber: 'ZZ9001', aircraftType: 'B38M', isDemo: true, signals: [],
    });
    expect(deriveDisplayStatus(demo, { nowMs: NOW + 2 * MINUTE, flightsByTurnaround }).state).toBe('arriving');
    expect(deriveDisplayStatus(demo, { nowMs: NOW + 3 * MINUTE, flightsByTurnaround })).toMatchObject({
      state: 'occupied', flightNumber: 'ZZ9002', minutesToDeparture: 60,
    });

    // Any other flight that landed 4 minutes ago: arriving while no BLOCK_ON is recorded and the aircraft (live or
    // estimated) is outside the stand box; parked once it is inside, or once the tablet records BLOCK_ON.
    const position = positionOf('A5', onA5([visit({ flight: 'DM301', arrivalInMin: -4, departureInMin: 80, arrived: true })]));
    const legs = milestones => ({
      'turn-DM301': [
        { direction: 'Arrival', flightNumber: 'DM301', phase: 'landed', actualAt: iso(NOW - 4 * MINUTE), milestones },
        { direction: 'Departure', flightNumber: 'DM302', phase: 'scheduled', milestones },
      ],
    });
    const { center, headingTrue } = position.geometry;
    const outside = destinationPoint(center, headingTrue + 180, 300);
    const inside = { latitude: center[1], longitude: center[0] };
    const blockOn = { code: 'BLOCK_ON', actualAt: iso(NOW - MINUTE) };
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: legs([]), aircraftByTurnaround: { 'turn-DM301': outside },
    })).toMatchObject({ state: 'arriving', flightNumber: 'DM301' });
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: legs([]), aircraftByTurnaround: { 'turn-DM301': inside },
    }).state).toBe('occupied');
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: legs([blockOn]), aircraftByTurnaround: new Map([['turn-DM301', outside]]),
    }).state).toBe('occupied');
    // The aircraft position alone (PR M5 brings it before the map flights are joined) decides as well.
    expect(deriveDisplayStatus(position, { nowMs: NOW, aircraftByTurnaround: { 'turn-DM301': { position: outside } } })
      .state).toBe('arriving');
  });

  it('without milestones or an aircraft position, an on-block time puts the aircraft on the stand, a runway time does not', () => {
    // Today's reads: the board alone, whose arrival time decides.
    const position = positionOf('A5', onA5([visit({ arrivalInMin: -4, departureInMin: 80, arrived: true })]));
    expect(deriveDisplayStatus(position, { nowMs: NOW })).toMatchObject({
      state: 'occupied', departureAt: NOW + 80 * MINUTE, minutesToDeparture: 80, flightNumber: 'DM162', signals: [],
    });
    // With the arrival leg (PR A3), its actual time counts only when it is the on-block (`actualKind`, contracts 1.3:
    // OCC's «Registrar llegada»). The feed and the demo worker write the runway time, which the board shows as its
    // arrival time too: that aircraft landed and is arriving until a BLOCK_ON or its position puts it on the stand.
    const arrivalLeg = extra => ({
      'turn-DM161': [{
        direction: 'Arrival', flightNumber: 'DM161', scheduledAt: iso(NOW - 4 * MINUTE), milestones: [], ...extra,
      }],
    });
    const landedAt = iso(NOW - 4 * MINUTE);
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: arrivalLeg({ phase: 'landed', actualAt: landedAt, actualKind: 'Runway' }),
    })).toMatchObject({ state: 'arriving', flightNumber: 'DM161', minutesToArrival: -4, signals: [] });
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: arrivalLeg({ phase: 'arrived', actualAt: landedAt, actualKind: 'OnBlock' }),
    })).toMatchObject({ state: 'occupied', flightNumber: 'DM162', minutesToDeparture: 80, signals: [] });
    // An arrival leg without an actual time, or of an unknown kind, does not put it there either.
    expect(deriveDisplayStatus(position, { nowMs: NOW, flightsByTurnaround: arrivalLeg({ phase: 'landed' }) }).state)
      .toBe('arriving');
    expect(deriveDisplayStatus(position, {
      nowMs: NOW, flightsByTurnaround: arrivalLeg({ phase: 'landed', actualAt: landedAt, actualKind: null }),
    }).state).toBe('arriving');
    // The departure leg alone says nothing about the arrival: the board's arrival time decides.
    const departureOnly = {
      'turn-DM161': { direction: 'Departure', flightNumber: 'DM162', phase: 'scheduled', milestones: [] },
    };
    expect(deriveDisplayStatus(position, { nowMs: NOW, flightsByTurnaround: departureOnly }).state).toBe('occupied');
    // A position without a geometry cannot place the aircraft either.
    const outside = destinationPoint(position.geometry.center, 0, 500);
    expect(deriveDisplayStatus({ ...position, geometry: null }, {
      nowMs: NOW, aircraftByTurnaround: { 'turn-DM161': outside },
    }).state).toBe('occupied');
  });

  it('an aircraft on the stand is occupied, and releasing when the departure is within 15 minutes', () => {
    const at = departureInMin => statusAt(onA5([visit({ arrivalInMin: -40, departureInMin, arrived: true })]));
    expect(at(16)).toMatchObject({ state: 'occupied', minutesToDeparture: 16, signals: [] });
    expect(at(15)).toMatchObject({ state: 'releasing', minutesToDeparture: 15, signals: [] });
    expect(at(0)).toMatchObject({ state: 'releasing', minutesToDeparture: 0, signals: [] });
    // Without a departure time it stays occupied.
    expect(statusAt(onA5([visit({ arrivalInMin: -40, arrived: true, departureScheduledAt: null })]))).toMatchObject({
      state: 'occupied', departureAt: null, minutesToDeparture: null,
    });
  });

  it('a visit whose PUSHBACK is recorded no longer counts: the stand falls to the next planned flight or to available', () => {
    const left = visit({ flight: 'DM401', arrivalInMin: -60, departureInMin: -2, arrived: true });
    const next = visit({ flight: 'DM403', arrivalInMin: 50 });
    const pushedBack = [{ code: 'BLOCK_ON', actualAt: iso(NOW - 58 * MINUTE) }, { code: 'PUSHBACK', actualAt: iso(NOW - MINUTE) }];
    const flights = {
      'turn-DM401': [
        { direction: 'Arrival', phase: 'arrived', milestones: pushedBack },
        { direction: 'Departure', phase: 'scheduled', milestones: pushedBack },
      ],
    };
    // Before the board drops it (contracts 1.2), the visit still holds the stand on the board's word alone.
    const both = positionOf('A5', onA5([left, next]));
    expect(deriveDisplayStatus(both, { nowMs: NOW })).toMatchObject({
      state: 'releasing', flightNumber: 'DM402', signals: [{ kind: 'attention', reason: 'overdue' }],
    });
    expect(deriveDisplayStatus(both, { nowMs: NOW, flightsByTurnaround: flights })).toMatchObject({
      state: 'planned', flightNumber: 'DM403', minutesToArrival: 50, signals: [],
    });
    const alone = positionOf('A5', onA5([left]));
    expect(deriveDisplayStatus(alone, { nowMs: NOW, flightsByTurnaround: flights })).toMatchObject({
      state: 'available', visit: null, signals: [],
    });
    // The same once a leg departed, and once the demo timeline took the aircraft off the stand.
    expect(deriveDisplayStatus(alone, {
      nowMs: NOW, flightsByTurnaround: { 'turn-DM401': { direction: 'Departure', phase: 'departed' } },
    }).state).toBe('available');
    expect(deriveDisplayStatus(alone, {
      nowMs: NOW,
      flightsByTurnaround: { 'turn-DM401': [{ direction: 'Arrival', phase: 'landed', demo: { phase: 'TaxiOut', onBlockAt: iso(NOW - 58 * MINUTE) } }] },
    }).state).toBe('available');
    // A cancelled departure alone leaves the aircraft where it is.
    expect(deriveDisplayStatus(alone, {
      nowMs: NOW, flightsByTurnaround: { 'turn-DM401': { direction: 'Departure', phase: 'cancelled' } },
    }).state).toBe('releasing');
  });

  it('an arrival that took off from its origin is on its way: its visit still counts, planned and then arriving', () => {
    // The provider's «Departed» reads `departed` on an arrival too (contracts 1.3): that aircraft is flying in.
    const inbound = arrivalInMin => ({
      'turn-DM301': [
        {
          direction: 'Arrival', flightNumber: 'DM301', phase: 'departed', scheduledAt: iso(NOW + arrivalInMin * MINUTE),
          actualAt: null, actualKind: null, milestones: [],
        },
        {
          direction: 'Departure', flightNumber: 'DM302', phase: 'scheduled',
          scheduledAt: iso(NOW + (arrivalInMin + 60) * MINUTE), milestones: [],
        },
      ],
    });
    const due = arrivalInMin => visit({ flight: 'DM301', arrivalInMin });
    const at = (turnarounds, arrivalInMin) => statusAt(onA5(turnarounds), { flightsByTurnaround: inbound(arrivalInMin) });
    expect(at([due(40)], 40)).toMatchObject({ state: 'planned', flightNumber: 'DM301', minutesToArrival: 40, signals: [] });
    expect(at([due(10)], 10)).toMatchObject({ state: 'arriving', flightNumber: 'DM301', minutesToArrival: 10, signals: [] });
    // It still comes onto a stand with an aircraft on it.
    const parked = visit({ flight: 'DM205', arrivalInMin: -30, departureInMin: 60, arrived: true });
    expect(at([parked, due(10)], 10)).toMatchObject({
      state: 'occupied', flightNumber: 'DM206', signals: [{ kind: 'urgent', reason: 'conflict' }],
    });
  });

  it('a free stand cancelled by a combined stand is disabled and names the stand that cancels it', () => {
    const positions = positionsOf(createRampScenario(NOW).board);
    const a10 = positions.find(position => position.id === 'A10');
    expect(a10).toMatchObject({ status: 'disabled', cancelledBy: 'A09' });
    expect(deriveDisplayStatus(a10, { nowMs: NOW })).toMatchObject({
      state: 'disabled', cancelledBy: 'A9', signals: [], visit: null,
    });
    expect(deriveDisplayStatus(positions.find(position => position.id === 'A9'), { nowMs: NOW }))
      .toMatchObject({ state: 'occupied', cancelledBy: null });
  });

  it('raises «Sin agente que la cubra» only with an empty coverage list and a flight due within 60 minutes', () => {
    const uncovered = [{ kind: 'attention', reason: 'uncovered' }];
    const at = (turnarounds, coveredBy = []) => statusAt(onA5(turnarounds, { coveredBy }));
    expect(at([visit({ arrivalInMin: 60 })]).signals).toEqual(uncovered);
    expect(at([visit({ arrivalInMin: 61 })]).signals).toEqual([]);
    expect(at([]).signals).toEqual([]);
    expect(at([visit({ arrivalInMin: 30 })], [marta]).signals).toEqual([]);
    // An aircraft on the stand counts whatever its departure time.
    expect(at([visit({ arrivalInMin: -10, departureInMin: 240, arrived: true })]).signals).toEqual(uncovered);
    // A list that is absent is unknown, never empty: no warning without coverage data.
    const position = positionOf('A5', onA5([visit({ arrivalInMin: 30 })], { coveredBy: [] }));
    expect(deriveDisplayStatus(position, { nowMs: NOW }).signals).toEqual(uncovered);
    for (const coveredBy of [undefined, null]) {
      expect(deriveDisplayStatus({ ...position, coveredBy }, { nowMs: NOW }).signals, String(coveredBy)).toEqual([]);
    }
  });

  it('raises «Pasó su hora de salida» after the scheduled departure while the aircraft stays', () => {
    const at = departureInMin => statusAt(onA5([visit({ arrivalInMin: -90, departureInMin, arrived: true })]));
    expect(at(0).signals).toEqual([]);
    expect(at(-1)).toMatchObject({
      state: 'releasing', minutesToDeparture: -1, signals: [{ kind: 'attention', reason: 'overdue' }],
    });
    // A flight that has not reached the stand is never past its departure.
    expect(statusAt(onA5([visit({ arrivalInMin: -20, departureInMin: -5 })])).signals).toEqual([]);
  });

  it('raises «Otra aeronave llega a esta posición» when another visit comes onto the stand before its aircraft leaves', () => {
    const conflict = { kind: 'urgent', reason: 'conflict' };
    const a4 = positionsOf(createRampScenario(NOW).board).find(position => position.id === 'A4');
    expect(deriveDisplayStatus(a4, { nowMs: NOW })).toMatchObject({ state: 'occupied', flightNumber: 'DM206', signals: [conflict] });
    const parked = visit({ flight: 'DM205', arrivalInMin: -30, departureInMin: 60, arrived: true });
    const at = (second, coveredBy = [luis]) => statusAt(onA5([parked, second], { coveredBy }));
    // Still 16 minutes out: no conflict yet.
    expect(at(visit({ flight: 'DM207', arrivalInMin: 16, departureInMin: 120 })).signals).toEqual([]);
    expect(at(visit({ flight: 'DM207', arrivalInMin: 15, departureInMin: 120 })).signals).toEqual([conflict]);
    // Two aircraft on the stand.
    expect(at(visit({ flight: 'DM207', arrivalInMin: -5, departureInMin: 120, arrived: true }))).toMatchObject({
      state: 'occupied', flightNumber: 'DM206', signals: [conflict],
    });
    // The urgent signal comes first.
    expect(at(visit({ flight: 'DM207', arrivalInMin: 5, departureInMin: 120 }), []).signals)
      .toEqual([conflict, { kind: 'attention', reason: 'uncovered' }]);

    // A turnover is no conflict: the next aircraft is due once the one on the stand has left (it leaves in 5 minutes,
    // the next is due in 14), or as it leaves.
    const leaving = (departureInMin, extra = {}) => visit({
      flight: 'DM205', arrivalInMin: -30, departureInMin, arrived: true, ...extra,
    });
    const turnover = (first, second) => statusAt(onA5([first, second], { coveredBy: [luis] }));
    const next = arrivalInMin => visit({ flight: 'DM207', arrivalInMin });
    expect(turnover(leaving(5), next(14))).toMatchObject({
      state: 'releasing', flightNumber: 'DM206', minutesToDeparture: 5, signals: [],
    });
    expect(turnover(leaving(5), next(5)).signals).toEqual([]);
    // Due before it leaves.
    expect(turnover(leaving(10), next(5)).signals).toEqual([conflict]);
    // Nobody knows when it leaves: the aircraft is still there after its departure time, or it has no departure time.
    expect(turnover(leaving(-5), next(5))).toMatchObject({
      state: 'releasing', signals: [conflict, { kind: 'attention', reason: 'overdue' }],
    });
    expect(turnover(leaving(0, { departureScheduledAt: null }), next(14)))
      .toMatchObject({ state: 'occupied', signals: [conflict] });
    // An aircraft that landed already comes onto the stand within minutes, whatever its time: with the map flights
    // (PR A3), a runway time without BLOCK_ON, due on the stand in 6 minutes while the one on it leaves in 5; on the
    // board alone, whose arrival time is that runway time, a second aircraft on the stand.
    const landedNext = visit({ flight: 'DM207', arrivalInMin: 6, arrivedAt: iso(NOW - MINUTE) });
    const touchdown = {
      'turn-DM207': [{
        direction: 'Arrival', flightNumber: 'DM207', phase: 'landed', scheduledAt: iso(NOW + 6 * MINUTE),
        actualAt: iso(NOW - MINUTE), actualKind: 'Runway', milestones: [],
      }],
    };
    const withLanded = onA5([leaving(5), landedNext], { coveredBy: [luis] });
    expect(statusAt(withLanded, { flightsByTurnaround: touchdown })).toMatchObject({
      state: 'releasing', flightNumber: 'DM206', signals: [conflict],
    });
    expect(statusAt(withLanded).signals).toEqual([conflict]);
  });

  it('positions without board visits keep their own state', () => {
    // The console's apron and the planning view give stands without the board's visits.
    const apron = mapTurnaroundsToRampPositions(RAMP_POSITIONS, [
      { id: 't-1', operationCode: 'OP-1', stand: { code: 'A5' }, arrival: { flightNumber: 'DM161' } },
    ]);
    expect(deriveDisplayStatus(apron.find(position => position.id === 'A5'), { nowMs: NOW })).toMatchObject({
      state: 'planned', signals: [], visit: null, flightNumber: 'DM161', minutesToArrival: null,
    });
    expect(deriveDisplayStatus(apron.find(position => position.id === 'A1'), { nowMs: NOW }).state).toBe('unverified');
    for (const state of STAND_STATE_KEYS) expect(deriveDisplayStatus({ id: 'A1', status: state }).state).toBe(state);
    for (const status of [undefined, 'blocked', 'Occupied']) {
      expect(deriveDisplayStatus({ id: 'A1', status }).state).toBe('available');
      expect(standDrawState(status)).toBe('available');
    }
    expect(deriveDisplayStatus(null).state).toBe('available');
    expect(deriveDisplayStatus({ id: 'A10', status: 'disabled', linkedPositionId: 'A9' }).cancelledBy).toBe('A9');
  });

  it('withStandDisplay copies each position with how it reads; a map draws the display status, else the board status', () => {
    const { board, flightsByTurnaround } = createRampScenario(NOW);
    const positions = positionsOf(board);
    const shown = withStandDisplay([...positions, null, 'A1'], { nowMs: NOW + 30 * 1000, flightsByTurnaround });
    // Anything that is not a position is left out; the positions themselves are copies, never changed.
    expect(shown).toHaveLength(positions.length);
    expect(positions.every(position => !Object.hasOwn(position, 'displayStatus'))).toBe(true);
    const a6 = shown.find(position => position.id === 'A6');
    expect(a6).toMatchObject({ status: 'occupied', displayStatus: 'arriving', signals: [] });
    expect(a6.display).toEqual(deriveDisplayStatus(a6, { nowMs: NOW, flightsByTurnaround }));
    expect(a6.geometry).toBe(positions.find(position => position.id === 'A6').geometry);
    // The drawn state: the display status the screen derived, else the board status (anything else reads free).
    expect(standStateOf(a6)).toBe('arriving');
    expect(standStateOf(positions.find(position => position.id === 'A6'))).toBe('occupied');
    expect(standStateOf({ status: 'disabled' })).toBe('disabled');
    expect(standStateOf({ status: 'disabled', displayStatus: 'parked' })).toBe('disabled');
    expect(standStateOf({ status: 'mystery' })).toBe('available');
    expect(standStateOf(null)).toBe('available');
    // Without the board's visits a stand reads from its own fields.
    expect(displayFromStatus({ id: 'A5', status: 'occupied', flightNumber: 'DM161', isDemo: true, linkedPositionId: 'A9' }))
      .toMatchObject({ state: 'occupied', visit: null, signals: [], flightNumber: 'DM161', isDemo: true, cancelledBy: 'A9' });
    // Whole minutes to go, rounded up; nothing without a time.
    expect([minutesUntil(NOW + 40.5 * MINUTE, NOW), minutesUntil(NOW - 0.5 * MINUTE, NOW), minutesUntil(null, NOW)]).toEqual([41, 0, null]);
  });

  it('the state changes only at minute boundaries', () => {
    const position = positionOf('A5', onA5([visit({ arrivalInMin: 15.5 })]));
    const at = ms => deriveDisplayStatus(position, { nowMs: ms });
    expect(at(NOW)).toMatchObject({ state: 'planned', minutesToArrival: 16 });
    // Half a minute later the flight is 15 minutes out, but the minute has not turned.
    for (const offset of [1, 30 * 1000, MINUTE - 1]) expect(at(NOW + offset)).toEqual(at(NOW));
    expect(at(NOW + MINUTE)).toMatchObject({ state: 'arriving', minutesToArrival: 15 });
    expect(floorToMinute(NOW + MINUTE - 1)).toBe(NOW);
  });
});

// The stands read with what the OCC frame gives them (PR M6): the map situation of the lab's noon through
// traffic/standInputs.js, as Mapa de posiciones and Planificación read it. Synthetic: the fixtures' flights with the times
// each case needs, a board whose visits carry the same turnaround ids and times, and the picture's ZZ161 fix moved where
// each case puts it.
describe('deriveDisplayStatus with the map situation (PR M6)', () => {
  const NOON = Date.parse(TRAFFIC_NOON);
  const KNOT = 1852 / 3600;
  const at = minutes => iso(NOON + minutes * MINUTE);
  const rows = () => createMapFlights().flights;
  const rowOf = key => rows().find(row => row.flightKey === key);
  const ARRIVAL = rowOf(TRAFFIC_FLIGHT_KEY.arrival);
  const PARKED = rowOf(TRAFFIC_FLIGHT_KEY.parkedArrival);
  const DEPARTED = rowOf(TRAFFIC_FLIGHT_KEY.departed);
  const noonVisit = options => boardVisit({ nowMs: NOON, ...options });
  const standAt = (code, stand) => attachStandGeometry(mapOccupancyToRampPositions(REFERENCES, { positions: [stand] },
    TRAFFIC_NOON), MDPC_LAYOUT).find(position => position.id === code);
  const notice = { kind: 'notice', reason: 'arrivalNotRecorded' };

  // The legs of a visit of the fixtures at the times of the board: its arrival due `arrivalInMin` from noon (down on the
  // runway then, as the feed writes it, when `landed`), its departure `departureInMin`, and `extra` on both legs.
  function visitRows(turnaroundId, { arrivalInMin, departureInMin, landed = false, extra = {}, base = rows() }) {
    return base.map(row => {
      if (row.turnaroundId !== turnaroundId) return row;
      const times = row.direction === 'Arrival'
        ? { scheduledAt: at(arrivalInMin), estimatedAt: at(arrivalInMin),
          ...(landed ? { phase: 'landed', actualAt: at(arrivalInMin), actualKind: 'Runway' } : {}) }
        : { scheduledAt: at(departureInMin) };
      return { ...row, ...times, ...extra };
    });
  }
  // ZZ161 landed 2 minutes ago and leaves in 75, as the board of A5 says.
  const zz161 = (options = {}) => visitRows(ARRIVAL.turnaroundId, { arrivalInMin: -2, departureInMin: 75, landed: true, ...options });
  const a5Of = ({ arrivalInMin = -2, departureInMin = 75, arrived = true, coveredBy = [marta] } = {}) => standAt('A5',
    boardStand('A05', { coveredBy, turnarounds: [noonVisit({
      flight: 'ZZ161', turnaroundId: ARRIVAL.turnaroundId, arrivalInMin, departureInMin, arrived,
    })] }));
  const a5 = a5Of();
  const { center, headingTrue } = a5.geometry;
  const blockOn = minutesAgo => ({ milestones: [{ code: 'BLOCK_ON', actualAt: at(-minutesAgo) }] });

  // The stand inputs with the ZZ161 fix at `point` (none without one), on the ground or not, at `knots`, the flights
  // `flightRows` and the positions a caller estimated.
  function inputsWith({ point = null, onGround = true, knots = 0, flightRows = zz161(), estimates = [] } = {}) {
    const picture = createAirPicture();
    picture.aircraft = picture.aircraft.flatMap(item => {
      if (item.hex !== TRAFFIC_HEX.arrival) return [item];
      if (point === null) return [];
      return [{ ...item, longitude: point[0], latitude: point[1], onGround, altitudeFeet: onGround ? null : 900,
        groundSpeedKnots: knots, verticalRateFeetPerMinute: onGround ? null : -700, trail: [] }];
    });
    const flights = { ...createMapFlights(), flights: flightRows };
    return standInputsOf(buildSituation({ picture: toPictureModel(picture), flights: toFlightsModel(flights), nowMs: NOON,
      estimates }));
  }
  const read = (stand, options) => deriveDisplayStatus(stand, { nowMs: NOON, ...inputsWith(options) });

  it('Llegando until the aircraft is on its stand', () => {
    // Taxiing in, 200 m behind the stand: «Llegando», whatever the board says.
    expect(a5.status).toBe('occupied');
    const behind = destinationPoint(center, headingTrue + 180, 200);
    expect(read(a5, { point: behind, knots: 14 })).toMatchObject({ state: 'arriving', flightNumber: 'ZZ161', signals: [] });
    // Over the stand in the air (a low pass, or a fix of the approach): still on its way.
    expect(read(a5, { point: center, onGround: false, knots: 140 }).state).toBe('arriving');
    // On the stand: «Ocupada», from then on with the departure's flight and time.
    expect(read(a5, { point: center })).toMatchObject({ state: 'occupied', flightNumber: 'ZZ162', minutesToDeparture: 75 });
    // A recorded BLOCK_ON puts it there whatever its fix says.
    expect(read(a5, { point: behind, knots: 5, flightRows: zz161({ extra: blockOn(1) }) }).state).toBe('occupied');
    // Without a fix the runway time alone keeps it arriving; OCC's on-block time puts it on the stand.
    expect(read(a5).state).toBe('arriving');
    const onBlock = zz161().map(row => (row.flightKey === ARRIVAL.flightKey ? { ...row, phase: 'arrived', actualKind: 'OnBlock' } : row));
    expect(read(a5, { flightRows: onBlock }).state).toBe('occupied');
  });

  it('free at PUSHBACK', () => {
    // ZZ700 pushed back from A3 14 minutes ago and took off; the board still lists it there.
    const a3 = standAt('A3', boardStand('A03', { turnarounds: [noonVisit({
      flight: 'ZZ700', turnaroundId: DEPARTED.turnaroundId, arrivalInMin: -70, departureInMin: -15, arrived: true,
    })] }));
    expect(deriveDisplayStatus(a3, { nowMs: NOON })).toMatchObject({ state: 'releasing' });
    expect(read(a3)).toMatchObject({ state: 'available', visit: null, signals: [] });
    // Before the take-off as well: the PUSHBACK alone frees the stand.
    const onTheGround = rows().map(row => (row.flightKey === DEPARTED.flightKey
      ? { ...row, phase: 'scheduled', actualAt: null, actualKind: null } : row));
    expect(read(a3, { flightRows: onTheGround }).state).toBe('available');

    // A demo aircraft leaves its stand at the server's off-block, even before a read brings the timeline's next phase.
    const block = { ...createDemoBlock({ minutes: 8, imported: true, offBlockAfterMin: 20, appearAt: NOON - 40 * MINUTE }),
      phase: 'Parked' };
    const demoRows = demo => createDemoFlights(demo, { imported: true, standCode: 'A06' }).flights;
    const demoTurnaround = demoRows(block).find(row => row.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival).turnaroundId;
    const a6 = standAt('A6', boardStand('A06', { coveredBy: [marta], turnarounds: [noonVisit({
      flight: 'ZZ9001', turnaroundId: demoTurnaround, arrivalInMin: -32, departureInMin: -12, arrived: true, isDemo: true,
    })] }));
    expect(read(a6, { flightRows: demoRows(block) })).toMatchObject({ state: 'available', visit: null });
    const later = { ...block, offBlockAt: at(5) };
    expect(read(a6, { flightRows: demoRows(later) })).toMatchObject({ state: 'releasing', minutesToDeparture: 5, isDemo: true });
  });

  it('the planned aircraft footprint is dashed', () => {
    // ZZ161 due in 40 minutes, then in 10: the B38M it flies, drawn dashed on the stand to see whether it fits.
    const due = minutes => [a5Of({ arrivalInMin: minutes, departureInMin: minutes + 60, arrived: false }),
      { flightRows: zz161({ arrivalInMin: minutes, departureInMin: minutes + 60, landed: false }) }];
    expect(read(...due(40))).toMatchObject({ state: 'planned', footprint: 'planned', typeSpec: AIRCRAFT_TYPES.B38M, aircraftType: 'B38M' });
    expect(read(...due(10))).toMatchObject({ state: 'arriving', footprint: 'planned' });
    // On the stand it is solid, for «Ocupada» and «Por liberar» alike.
    expect(read(a5, { point: center })).toMatchObject({ state: 'occupied', footprint: 'solid' });
    const leaving = a5Of({ arrivalInMin: -50, departureInMin: 10 });
    expect(read(leaving, { flightRows: zz161({ arrivalInMin: -50, departureInMin: 10, extra: blockOn(45) }) }))
      .toMatchObject({ state: 'releasing', footprint: 'solid' });
    // Only the size class known: the generic airframe of that class. Nothing known, or no map flights: no footprint.
    const [planned] = due(40);
    const withAircraft = aircraft => ({ flightRows: zz161({ arrivalInMin: 40, departureInMin: 100, landed: false,
      extra: { aircraft } }) });
    expect(read(planned, withAircraft({ registration: null, typeIcaoCode: null, model: null, sizeCategory: 'Narrowbody' })))
      .toMatchObject({ state: 'planned', footprint: 'planned', typeSpec: CATEGORY_FALLBACKS.narrow });
    expect(read(planned, withAircraft({ registration: 'ZZ-TST1', typeIcaoCode: null, model: null, sizeCategory: null })))
      .toMatchObject({ footprint: null, typeSpec: null });
    expect(read(planned, withAircraft(null))).toMatchObject({ footprint: null, typeSpec: null });
    expect(deriveDisplayStatus(planned, { nowMs: NOON })).toMatchObject({ state: 'planned', footprint: null, typeSpec: null });
    // A free stand draws none; nor does a stand read from its own fields.
    expect(deriveDisplayStatus(standAt('A5', boardStand('A05')), { nowMs: NOON })).toMatchObject({ footprint: null });
    expect(displayFromStatus({ id: 'A5', status: 'occupied', aircraftType: 'A320' })).toMatchObject({ footprint: null, typeSpec: null });
  });

  it('progress counts recorded milestones out of 25 without a late colour', () => {
    const done = ['BLOCK_ON', 'WALKAROUND_START', 'WALKAROUND_END', 'STAIRS_JETBRIDGE', 'UNLOADING_EQUIPMENT',
      'FIRST_CUSTOMS', 'UNLOAD_SHEET', 'LAVATORY_SERVICE', 'POTABLE_WATER'].map((code, index) => ({ code, actualAt: at(index - 22) }));
    // ZZ300 on A2 since 30 minutes ago, leaving in 40, or a minute ago; both legs carry the operation's milestones, so
    // each code counts once.
    const a2Of = departureInMin => standAt('A2', boardStand('A02', { coveredBy: [marta], turnarounds: [noonVisit({
      flight: 'ZZ300', turnaroundId: PARKED.turnaroundId, arrivalInMin: -30, departureInMin, arrived: true,
    })] }));
    const zz300 = (milestones, departureInMin = 40) => ({
      flightRows: visitRows(PARKED.turnaroundId, { arrivalInMin: -30, departureInMin, extra: { milestones } }),
    });
    expect(MILESTONES_TOTAL).toBe(FLIGHT_REPORT_MILESTONES.length);
    expect(MILESTONES_TOTAL).toBe(25);
    expect(read(a2Of(40), zz300(done))).toMatchObject({ state: 'occupied', milestonesDone: 9, milestonesTotal: 25, signals: [] });
    // A code outside the flight report, or one without its time, counts for nothing.
    expect(read(a2Of(40), zz300([...done, { code: 'COFFEE_BREAK', actualAt: at(-1) }, { code: 'BOARDING', actualAt: null }]))
      .milestonesDone).toBe(9);
    expect(read(a2Of(40), zz300(done.slice(0, 1))).milestonesDone).toBe(1);
    // Without its map flights nobody knows how far it has gone.
    expect(deriveDisplayStatus(a2Of(40), { nowMs: NOON }).milestonesDone).toBeNull();
    // Past its departure time the progress reads the same: no target time exists per milestone (contracts 1.3), so
    // there is no «late» colour and no signal of it, only the stand's own «Pasó su hora de salida».
    const shown = read(a2Of(-1), zz300(done, -1));
    expect(shown).toMatchObject({ state: 'releasing', milestonesDone: 9, signals: [{ kind: 'attention', reason: 'overdue' }] });
    expect(Object.keys(shown).sort()).toEqual([
      'aircraftType', 'arrivalAt', 'cancelledBy', 'coverage', 'departureAt', 'detail', 'flightNumber', 'footprint',
      'isDemo', 'milestonesDone', 'milestonesTotal', 'minutesToArrival', 'minutesToDeparture', 'next', 'signals', 'state',
      'typeSpec', 'visit',
    ]);
    // Without the board's coverage windows (an older API) the display says nothing of them (N26).
    expect(shown.coverage).toBeNull();
    // The detail of the visit (owner request of 2026-11-15): its airline, its times and its legs, from what was read.
    expect(shown.detail).toMatchObject({ arrival: expect.any(Object), departure: expect.any(Object) });
    expect(Array.isArray(shown.detail.legs)).toBe(true);
    expect(shown.next).toBeNull();
  });

  it('the detail of a stand: the visit on it with its airline and times, and the next visit onto it', () => {
    const stand = standAt('A2', boardStand('A02', { coveredBy: ['Marta'], turnarounds: [
      noonVisit({ flight: 'ZZ300', arrivalInMin: -30, departureInMin: 40, arrived: true }),
      noonVisit({ flight: 'ZZ500', arrivalInMin: 120, departureInMin: 180 }),
    ] }));
    const shown = deriveDisplayStatus(stand, { nowMs: NOON });
    expect(shown.state).toBe('occupied');
    expect(shown.detail).toMatchObject({ airline: 'Aerolínea de prueba', registration: 'HI0300', operationStatus: null, turnaroundStatus: 'InProgress',
      arrival: { scheduledAt: NOON - 30 * 60_000, actualAt: NOON - 30 * 60_000 },
      departure: { scheduledAt: NOON + 40 * 60_000, actualAt: null } });
    expect(shown.next).toMatchObject({ flightNumber: 'ZZ500', arrivalAt: NOON + 120 * 60_000, minutesToArrival: 120,
      airline: 'Aerolínea de prueba' });
  });

  it('the detail never shows an actual time still to come: a demo arrival is «Real» only from its touchdown', () => {
    // ZZ9001 at A6: the server plans its touchdown and on-block; the board has no arrival yet.
    const { board, flightsByTurnaround } = createRampScenario(NOW);
    const ahead = minutes => iso(NOW + minutes * MINUTE);
    const unlanded = { ...board, positions: board.positions.map(stand => (stand.code !== 'A06' ? stand : {
      ...stand, status: 'planned', turnarounds: stand.turnarounds.map(item => ({ ...item, arrivedAt: null })) })) };
    const legs = Object.fromEntries(Object.entries(flightsByTurnaround).map(([id, rows]) => [id, (Array.isArray(rows) ? rows : [rows])
      .map(leg => ({ ...leg, actualAt: null, phase: leg.direction === 'Arrival' ? 'scheduled' : leg.phase,
        demo: leg.demo ? { ...leg.demo, touchdownAt: ahead(1), onBlockAt: ahead(5), offBlockAt: null } : leg.demo }))]));
    const demo = positionsOf(unlanded).find(position => position.id === 'A6');
    const at = minutes => deriveDisplayStatus(demo, { nowMs: NOW + minutes * MINUTE, flightsByTurnaround: legs });
    // Before its touchdown nothing is real: no «aterrizó», no «Real».
    expect(at(0)).toMatchObject({ state: 'arriving', detail: { arrival: { actualAt: null }, departure: { actualAt: null } } });
    // Landed: its touchdown is real, while it still taxis in.
    expect(at(2)).toMatchObject({ state: 'arriving', detail: { arrival: { actualAt: NOW + MINUTE } } });
    // Parked: the on-block time.
    expect(at(6)).toMatchObject({ state: 'occupied', detail: { arrival: { actualAt: NOW + 5 * MINUTE } } });
  });

  it('the operation of a visit comes from its map flights, apart from the turnaround state', () => {
    const stand = standAt('A2', boardStand('A02', { coveredBy: ['Marta'], turnarounds: [
      noonVisit({ flight: 'ZZ300', arrivalInMin: -30, departureInMin: 40, arrived: true }),
    ] }));
    const turnaroundId = stand.turnarounds[0].turnaroundId;
    const read = operationStatus => deriveDisplayStatus(stand, { nowMs: NOON, flightsByTurnaround: { [turnaroundId]: [
      { direction: 'Arrival', flightNumber: 'ZZ300', phase: 'arrived', milestones: [],
        turnaround: { id: turnaroundId, operationCode: 'OP-1', status: 'Confirmed', operationId: 'op-1', operationStatus } },
    ] } }).detail;
    expect(read('InProgress')).toMatchObject({ operationStatus: 'InProgress' });
    expect(read(null).operationStatus).toBeNull();
    expect(read(null).turnaroundStatus).toEqual(expect.any(String));
  });

  it('an aircraft standing in a stand without an arrival recorded asks to record it', () => {
    // Its fix stands still inside A5 and nothing records it there: the plain notice.
    expect(read(a5, { point: center })).toMatchObject({ state: 'occupied', signals: [notice] });
    expect(read(a5, { point: center, knots: 1.5 }).signals).toEqual([notice]);
    expect(STILL_BELOW_MS).toBeCloseTo(2 * KNOT, 9);
    // Still rolling into the box (a fix at 6 kt): it has not stopped yet.
    expect(read(a5, { point: center, knots: 6 }).signals).toEqual([]);
    // BLOCK_ON or OCC's on-block time records it: no notice.
    expect(read(a5, { point: center, flightRows: zz161({ extra: blockOn(1) }) }).signals).toEqual([]);
    const onBlock = zz161().map(row => (row.flightKey === ARRIVAL.flightKey ? { ...row, phase: 'arrived', actualKind: 'OnBlock' } : row));
    expect(read(a5, { point: center, flightRows: onBlock }).signals).toEqual([]);
    // An estimated position counts as well (contracts 2.4: live or estimated).
    expect(read(a5, { estimates: [{ flightKey: ARRIVAL.flightKey, lon: center[0], lat: center[1], gsMs: 0, onGround: true }] }))
      .toMatchObject({ state: 'occupied', signals: [notice] });
    // With the stand's own signals, after them: nobody covers A5.
    expect(read(a5Of({ coveredBy: [] }), { point: center }).signals).toEqual([{ kind: 'attention', reason: 'uncovered' }, notice]);
  });

  it('a demo aircraft never asks (its time is recorded)', () => {
    // The demo flight imported onto A6, parked there since the server's on-block, its estimated aircraft standing in the
    // box: the server recorded its time, so the stand asks nothing.
    const block = createDemoBlock({ minutes: 8, imported: true, appearAt: NOON - 20 * MINUTE });
    const demoRows = createDemoFlights(block, { imported: true, standCode: 'A06' }).flights;
    const arrival = demoRows.find(row => row.flightKey === TRAFFIC_FLIGHT_KEY.demoArrival);
    const a6 = standAt('A6', boardStand('A06', { coveredBy: [marta], turnarounds: [noonVisit({
      flight: 'ZZ9001', turnaroundId: arrival.turnaroundId, arrivalInMin: -12, departureInMin: 48, arrived: true, isDemo: true,
    })] }));
    const [lon, lat] = a6.geometry.center;
    const options = { flightRows: demoRows, estimates: [{ flightKey: arrival.flightKey, lon, lat, gsMs: 0, onGround: true }] };
    expect(inputsWith(options).aircraftByTurnaround.get(arrival.turnaroundId)).toMatchObject({ quality: 'estimated', onGround: true });
    expect(read(a6, options)).toMatchObject({
      state: 'occupied', isDemo: true, footprint: 'solid', typeSpec: AIRCRAFT_TYPES.A320, signals: [],
    });
  });
});

// N23, the run of 16 November: the detail of a visit kept one actual time, the board's first, which for a feed or demo
// leg is its runway time, so at 19:57 the map said «Ocupada por WN9001 desde las 19:49 (llegada registrada)» of an
// aircraft that landed at 19:49 and parked at 19:54. Synthetic, as the demo worker leaves the scene: the runway time on
// the arrival leg (`actualKind: 'Runway'`) and as the board's arrival time, the server's on-block on the whole minute
// (N28) and the tablet's BLOCK_ON a little later.
describe('the detail of a visit tells the landing from the stand (N23)', () => {
  const utc = time => Date.parse(`2026-11-16T${time}Z`);
  const T1950 = utc('23:50:00');
  const TOUCHDOWN = utc('23:49:12');
  const ON_BLOCK = utc('23:54:00');
  const BLOCK_ON = utc('23:54:40');
  const demo = {
    demoFlightId: 'demo-wn9001', state: 'Active', phase: 'TaxiIn', appearAt: iso(TOUCHDOWN - 6 * MINUTE),
    touchdownAt: iso(TOUCHDOWN), onBlockAt: iso(ON_BLOCK), scheduledOffBlockAt: iso(ON_BLOCK + 60 * MINUTE),
    offBlockAt: null, takeoffAt: null, vanishAt: null,
  };
  const a11 = positionOf('A11', boardStand('A11', { coveredBy: [marta], turnarounds: [boardVisit({
    nowMs: T1950, flight: 'WN9001', arrivalInMin: 4, departureInMin: 64, arrivedAt: iso(TOUCHDOWN), isDemo: true,
  })] }));
  const demoLegs = milestones => ({ 'turn-WN9001': [
    { direction: 'Arrival', flightNumber: 'WN9001', phase: 'landed', scheduledAt: iso(ON_BLOCK), estimatedAt: iso(ON_BLOCK),
      actualAt: iso(TOUCHDOWN), actualKind: 'Runway', isDemo: true, demo, milestones },
    { direction: 'Departure', flightNumber: 'WN9002', phase: 'scheduled', scheduledAt: iso(ON_BLOCK + 60 * MINUTE),
      actualAt: null, actualKind: null, isDemo: true, demo, milestones },
  ] });
  const readA11 = (nowMs, milestones = []) => deriveDisplayStatus(a11, { nowMs, flightsByTurnaround: demoLegs(milestones) });

  it('the run of 16 November: landed at 19:49 and arriving at 19:50, on the stand since 19:54 at 19:57', () => {
    expect(a11.status).toBe('occupied');
    // 19:50: it landed and taxis in; nothing puts it on the stand yet.
    const taxiing = readA11(T1950);
    expect(taxiing).toMatchObject({ state: 'arriving', minutesToArrival: 4,
      detail: { arrival: { landedAt: TOUCHDOWN, onStandAt: null, onStandRecorded: false } } });
    // 19:57: parked at the server's on-block, and the tablet recorded BLOCK_ON at 19:54:40, which is said first.
    const parked = readA11(T1950 + 7 * MINUTE, [{ code: 'BLOCK_ON', actualAt: iso(BLOCK_ON) }]);
    expect(parked).toMatchObject({ state: 'occupied',
      detail: { arrival: { landedAt: TOUCHDOWN, onStandAt: BLOCK_ON, onStandRecorded: true } } });
    // Without BLOCK_ON, the demo chocks: the time the server planned, which nobody recorded.
    expect(readA11(T1950 + 7 * MINUTE).detail.arrival)
      .toMatchObject({ landedAt: TOUCHDOWN, onStandAt: ON_BLOCK, onStandRecorded: false });
    // The one actual time of before stays, for what reads it: the stand's time, else the runway's.
    expect([taxiing.detail.arrival.actualAt, parked.detail.arrival.actualAt]).toEqual([TOUCHDOWN, BLOCK_ON]);
  });

  it('a real flight: OCC\'s on-block, the earliest BLOCK_ON, an aircraft seen in the box and the board alone', () => {
    const position = positionOf('A5', onA5([visit({ flight: 'DM301', arrivalInMin: -12, departureInMin: 60, arrived: true })]));
    const legs = (arrival, arrivalMilestones = [], departureMilestones = arrivalMilestones) => ({ 'turn-DM301': [
      { direction: 'Arrival', flightNumber: 'DM301', phase: 'landed', scheduledAt: iso(NOW - 15 * MINUTE),
        milestones: arrivalMilestones, ...arrival },
      { direction: 'Departure', flightNumber: 'DM302', phase: 'scheduled', scheduledAt: iso(NOW + 60 * MINUTE),
        milestones: departureMilestones },
    ] });
    const arrivalOf = (flightsByTurnaround, options = {}) => deriveDisplayStatus(position, { nowMs: NOW,
      flightsByTurnaround, ...options });
    const blockOn = minutes => ({ code: 'BLOCK_ON', actualAt: iso(NOW + minutes * MINUTE) });
    const runway = { actualAt: iso(NOW - 12 * MINUTE), actualKind: 'Runway' };

    // OCC's «Registrar llegada» writes the on-block time: on the stand since then, recorded; no runway time is known.
    expect(arrivalOf(legs({ phase: 'arrived', actualAt: iso(NOW - 9 * MINUTE), actualKind: 'OnBlock' })))
      .toMatchObject({ state: 'occupied', detail: { arrival: {
        landedAt: null, onStandAt: NOW - 9 * MINUTE, onStandRecorded: true, actualAt: NOW - 9 * MINUTE } } });
    // The feed's runway time and the tablet's BLOCK_ON, without demo chocks: the earliest BLOCK_ON of its legs.
    expect(arrivalOf(legs(runway, [blockOn(-6)], [blockOn(-7)]))).toMatchObject({ state: 'occupied', detail: { arrival: {
      landedAt: NOW - 12 * MINUTE, onStandAt: NOW - 7 * MINUTE, onStandRecorded: true } } });
    // A BLOCK_ON ahead of the stand's clock is never said.
    expect(arrivalOf(legs(runway, [blockOn(2)])).detail.arrival).toMatchObject({ onStandAt: null, onStandRecorded: false });
    // Its aircraft stands in the box with only its runway time: it is there, and nobody knows since when.
    const [lng, lat] = position.geometry.center;
    expect(arrivalOf(legs(runway), { aircraftByTurnaround: { 'turn-DM301': { latitude: lat, longitude: lng } } }))
      .toMatchObject({ state: 'occupied', signals: [{ kind: 'notice', reason: 'arrivalNotRecorded' }], detail: { arrival: {
        landedAt: NOW - 12 * MINUTE, onStandAt: null, onStandRecorded: false } } });
    // The board alone, or without the arrival leg: its arrival time tells no kind (a runway or an on-block time), so
    // it stays only as the actual time of before.
    const boardOnly = { landedAt: null, onStandAt: null, onStandRecorded: false, actualAt: NOW - 12 * MINUTE };
    expect(deriveDisplayStatus(position, { nowMs: NOW })).toMatchObject({ state: 'occupied', detail: { arrival: boardOnly } });
    expect(arrivalOf({ 'turn-DM301': [legs(runway)['turn-DM301'][1]] })).toMatchObject({ state: 'occupied',
      detail: { arrival: boardOnly } });
  });
});

// N26, the run of 16 November: at 19:50 A5 and A6 still read «CM», though that agent's coverage ended at 17:00, and
// «Sin agente que la cubra» never rose: the board brought the names of the day, which the map read as «now». With the
// board's coverage windows (`includeCoverage`) a stand reads who covers it at the minute of the stand clock: the aircraft
// on the stand now, the one to come at its time on the stand (D-N26). Synthetic: the agents and flights are invented.
describe('who covers a stand, from the coverage windows of its date (N26)', () => {
  const DAY = '2026-11-16';
  const T1950 = Date.parse('2026-11-16T23:50:00Z');
  const elena = 'Elena Soto';
  // An instant of Punta Cana (UTC−4) on the 16th, or `dayOffset` days after it.
  const local = (hour, minute = 0, dayOffset = 0) => Date.UTC(2026, 10, 16 + dayOffset, hour + 4, minute);
  const cover = (agentName, from, to, isReinforcement = false) => ({
    agentName, startsAt: iso(from), endsAt: iso(to), isReinforcement,
  });
  // A5 of the board of `operationDate` with its windows (the names of the day are theirs, as the API gives them).
  const a5With = (coverage, turnarounds, operationDate = DAY) => positionsOf({ operationDate, positions: [boardStand('A05', {
    coveredBy: [...new Set(coverage.map(window => window.agentName))], coverage, turnarounds,
  })] }).find(position => position.id === 'A5');
  // On the stand since 30 minutes before `nowMs`, leaving 40 minutes after it; or due `arrivalInMin` after it.
  const parkedAt = nowMs => boardVisit({ nowMs, flight: 'WN301', arrivalInMin: -30, departureInMin: 40, arrived: true });
  const dueAt = (nowMs, arrivalInMin) => boardVisit({ nowMs, flight: 'WN303', arrivalInMin, departureInMin: arrivalInMin + 60 });
  const uncovered = { kind: 'attention', reason: 'uncovered' };
  const signalsAt = (position, nowMs) => deriveDisplayStatus(position, { nowMs }).signals;
  const shownAt = (position, nowMs) => withStandDisplay([position], { nowMs })[0];

  it('a coverage that ended: nobody covers the aircraft on the stand, and the stand says until when she did', () => {
    const a5 = a5With([cover(elena, local(5), local(17))], [parkedAt(T1950)]);
    // The names of the day still list her; her window ended at 17:00.
    expect(a5.coveredBy).toEqual([elena]);
    const shown = deriveDisplayStatus(a5, { nowMs: T1950 });
    expect(shown).toMatchObject({ state: 'occupied', signals: [uncovered] });
    expect(shown.coverage).toEqual({
      live: true, now: [], visit: [], ended: [{ name: elena, endsAt: local(17), isReinforcement: false }], upcoming: [],
      windows: [{ name: elena, startsAt: local(5), endsAt: local(17), isReinforcement: false }],
    });
    expect(standCoverageNames(shownAt(a5, T1950))).toEqual([]);
    expect(visitCoverageNames(shownAt(a5, T1950))).toEqual([]);
    // At 16:59 she still covered it.
    const before = a5With([cover(elena, local(5), local(17))], [parkedAt(local(16, 59))]);
    expect(signalsAt(before, local(16, 59))).toEqual([]);
    expect(standCoverageNames(shownAt(before, local(16, 59)))).toEqual([elena]);
    // Without the windows (an API that does not send them) the names of the day still read as before.
    const older = { ...a5, coverage: null };
    expect(signalsAt(older, T1950)).toEqual([]);
    expect(standCoverageNames(shownAt(older, T1950))).toEqual([elena]);
  });

  it('a coverage that ends in the middle of a visit: the aircraft on the stand is judged now, the one to come at its chocks', () => {
    const windows = [cover(elena, local(5), local(20))];
    // On the stand since 19:20, leaving at 20:30: covered at 19:50, not from 20:00 on.
    const parked = a5With(windows, [parkedAt(T1950)]);
    expect(signalsAt(parked, T1950)).toEqual([]);
    expect(signalsAt(parked, local(20))).toEqual([uncovered]);
    expect(deriveDisplayStatus(parked, { nowMs: local(20) }).coverage.ended)
      .toEqual([{ name: elena, endsAt: local(20), isReinforcement: false }]);
    // Due at 19:55 and staying until 20:55: she covers its chocks, so the stand asks for nobody (D-N26).
    const coming = a5With(windows, [dueAt(T1950, 5)]);
    expect(deriveDisplayStatus(coming, { nowMs: T1950 })).toMatchObject({ state: 'arriving', signals: [] });
    expect(visitCoverageNames(shownAt(coming, T1950))).toEqual([elena]);
    // Due at 20:10, once she has left.
    expect(signalsAt(a5With(windows, [dueAt(T1950, 20)]), T1950)).toEqual([uncovered]);
  });

  it('a coverage that has not started: it covers the flights that reach the stand once it starts', () => {
    const windows = [cover(luis, local(20, 30), local(23, 59))];
    const parked = deriveDisplayStatus(a5With(windows, [parkedAt(T1950)]), { nowMs: T1950 });
    expect(parked.signals).toEqual([uncovered]);
    expect(parked.coverage).toMatchObject({
      now: [], ended: [], upcoming: [{ name: luis, startsAt: local(20, 30), isReinforcement: false }],
    });
    // Due at 20:20, before it starts; due at 20:40, once it has.
    expect(signalsAt(a5With(windows, [dueAt(T1950, 30)]), T1950)).toEqual([uncovered]);
    expect(signalsAt(a5With(windows, [dueAt(T1950, 50)]), T1950)).toEqual([]);
    expect(visitCoverageNames(shownAt(a5With(windows, [dueAt(T1950, 50)]), T1950))).toEqual([luis]);
    // A flight late on its time reaches the stand now at the earliest: it is judged now, not at its past time.
    expect(signalsAt(a5With(windows, [dueAt(local(20, 31), -20)]), local(20, 31))).toEqual([]);
  });

  it('only a reinforcement covers it: that agent covers the stand, after any primary one', () => {
    const reinforcement = cover(ana, local(17), local(23), true);
    const alone = deriveDisplayStatus(a5With([reinforcement], [parkedAt(T1950)]), { nowMs: T1950 });
    expect(alone.signals).toEqual([]);
    expect(alone.coverage.now).toEqual([{ name: ana, isReinforcement: true }]);
    const both = deriveDisplayStatus(a5With([reinforcement, cover(luis, local(17), local(23))], [parkedAt(T1950)]),
      { nowMs: T1950 });
    expect(both.coverage.now).toEqual([{ name: luis, isReinforcement: false }, { name: ana, isReinforcement: true }]);
  });

  it('across midnight: a window counts by its instants, whatever day it starts or ends', () => {
    const night = cover(luis, local(22), local(6, 0, 1));
    const late = local(23, 50);
    // The aircraft on the stand at 23:50, and a flight of the 16th delayed to 00:20.
    expect(signalsAt(a5With([night], [parkedAt(late)]), late)).toEqual([]);
    expect(signalsAt(a5With([night], [dueAt(late, 30)]), late)).toEqual([]);
    // A coverage that ends at midnight says nothing of the flight due at 00:10: the board of the 16th never brings a
    // window that starts at midnight, so the names of the day decide, as before N26.
    expect(signalsAt(a5With([cover(elena, local(16), local(0, 0, 1))], [dueAt(late, 20)]), late)).toEqual([]);
    // At 00:30 the board of the 17th brings the same night window, which covers the stand then.
    const after = local(0, 30, 1);
    const tomorrow = a5With([night], [parkedAt(after)], '2026-11-17');
    expect(deriveDisplayStatus(tomorrow, { nowMs: after })).toMatchObject({
      signals: [], coverage: { live: true, now: [{ name: luis, isReinforcement: false }] },
    });
  });

  it('past the board\'s midnight nobody in its windows says nothing: the names of the day decide', () => {
    // At 23:25 on the 16th, WN303 of the 16th is due on A5 at 00:15 on the 17th. The board of the 16th brings the
    // windows of its day, 08:00 to 16:00 and 16:00 to 24:00; the one from 00:00 on the 17th is never among them.
    const at2325 = local(23, 25);
    const day = [cover(elena, local(8), local(16)), cover(luis, local(16), local(0, 0, 1))];
    const late = a5With(day, [dueAt(at2325, 50)]);
    const shown = deriveDisplayStatus(late, { nowMs: at2325 });
    expect(shown).toMatchObject({ state: 'planned', signals: [] });
    // Who covers it then is unknown: its «Agente» is who covers the stand now.
    expect(shown.coverage).toMatchObject({ live: true, now: [{ name: luis, isReinforcement: false }], visit: null });
    expect(visitCoverageNames(shownAt(late, at2325))).toEqual([luis]);
    // A window of the day that runs past midnight still names who covers it then.
    const night = a5With([cover(marta, local(22), local(6, 0, 1))], [dueAt(at2325, 50)]);
    expect(deriveDisplayStatus(night, { nowMs: at2325 }).coverage.visit).toEqual([{ name: marta, isReinforcement: false }]);
    // Before midnight the windows still judge it: due at 23:55 on a stand nobody covers from 16:00.
    expect(signalsAt(a5With([cover(elena, local(8), local(16))], [dueAt(at2325, 30)]), at2325)).toEqual([uncovered]);
    // And a stand nobody covers that day still raises it past midnight, as the names of the day said before N26.
    expect(signalsAt(a5With([], [dueAt(at2325, 50)]), at2325)).toEqual([uncovered]);
  });

  it('another date: the windows are listed and never judged against the clock', () => {
    // Planificación on the 17th, read at 19:50 on the 16th.
    const windows = [cover(elena, local(5, 0, 1), local(17, 0, 1)), cover(luis, local(17, 0, 1), local(23, 0, 1), true)];
    const tomorrow = a5With(windows, [dueAt(T1950, 24 * 60)], '2026-11-17');
    expect(deriveDisplayStatus(tomorrow, { nowMs: T1950 }).coverage).toEqual({
      live: false, now: [], visit: null, ended: [], upcoming: [], windows: [
        { name: elena, startsAt: local(5, 0, 1), endsAt: local(17, 0, 1), isReinforcement: false },
        { name: luis, startsAt: local(17, 0, 1), endsAt: local(23, 0, 1), isReinforcement: true },
      ],
    });
    // Who covers it is the day's, as before.
    expect(standCoverageNames(shownAt(tomorrow, T1950))).toEqual([elena, luis]);
    expect(visitCoverageNames(shownAt(tomorrow, T1950))).toEqual([elena, luis]);
  });

  it('the ring of the same agent follows who covers now', () => {
    const board = { operationDate: DAY, positions: [
      boardStand('A05', { coveredBy: [elena], coverage: [cover(elena, local(5), local(17))], turnarounds: [parkedAt(T1950)] }),
      boardStand('A06', { coveredBy: [elena, luis], coverage: [cover(elena, local(5), local(17)), cover(luis, local(17), local(23))] }),
      boardStand('A07', { coveredBy: [luis], coverage: [cover(luis, local(17), local(23))] }),
    ] };
    const at1950 = withStandDisplay(positionsOf(board), { nowMs: T1950 });
    expect([...sameAgentCodes(at1950, 'A5')]).toEqual([]);
    expect([...sameAgentCodes(at1950, 'A6')]).toEqual(['A7']);
    // At 16:00 she still covers A5 and A6.
    expect([...sameAgentCodes(withStandDisplay(positionsOf(board), { nowMs: local(16) }), 'A5')]).toEqual(['A6']);
  });
});

describe('attachStandGeometry', () => {
  it('attachStandGeometry matches by normalized code, skips retired stands and leaves unknown unplaced stands without geometry', () => {
    const { board } = createRampScenario(NOW);
    const mapped = mapOccupancyToRampPositions(REFERENCES, board, iso(NOW));
    const positions = attachStandGeometry(mapped, MDPC_LAYOUT);
    const byId = new Map(positions.map(position => [position.id, position]));
    expect(positions).toHaveLength(mapped.length);
    expect(mapped.some(position => 'geometry' in position)).toBe(false);
    // «A01» of the database is the layout's A1, drawn where the owner's document puts it.
    const a1 = MDPC_LAYOUT.stands.find(stand => stand.code === 'A1');
    expect(byId.get('A1')).toMatchObject({ standId: 'stand-A1', status: 'available', locationSource: 'reference' });
    expect(byId.get('A1').geometry).toMatchObject({
      center: a1.center, polygon: a1.polygon, locationSource: 'reference', geometrySource: 'surveyed',
    });
    // A stand without a database row is still drawn from the layout.
    expect(byId.get('A7')).toMatchObject({ status: 'unverified' });
    expect(byId.get('A7').geometry.geometrySource).toBe('surveyed');
    // C7, unknown to the layout and placed by OCC, gets a box of its own at the saved point.
    const c7 = byId.get('C7');
    expect(c7.geometry).toMatchObject({
      center: [c7.longitude, c7.latitude], locationSource: 'occ', geometrySource: 'derived', sizeLetter: 'D',
    });
    // Any spelling of a code, and an alias the layout lists.
    expect(attachStandGeometry([{ id: 'a-05' }], MDPC_LAYOUT)[0].geometry.polygon)
      .toBe(MDPC_LAYOUT.stands.find(stand => stand.code === 'A5').polygon);
    const qa = createQaLayout();
    const withAlias = { ...qa, stands: qa.stands.map(stand => (stand.code === 'A2' ? { ...stand, aliases: ['2A'] } : stand)) };
    expect(attachStandGeometry([{ id: '2A' }], withAlias)[0].geometry.center).toEqual(qa.stands[1].center);
    // A stand unknown to the layout and not placed has no geometry; nor has anything without a layout.
    expect(attachStandGeometry([{ id: 'Z1', locationSource: 'reference', latitude: null, longitude: null }], MDPC_LAYOUT))
      .toEqual([expect.objectContaining({ id: 'Z1', geometry: null })]);
    expect(attachStandGeometry([{ id: 'A1' }], null)[0].geometry).toBeNull();
    // Retired: a retired position is left out, and the layout's retired B33 is never matched, so a B33 that OCC
    // placed gets a box of its own (oriented as its nearest active neighbour) and one it did not place none.
    const retired = MDPC_LAYOUT.stands.find(stand => stand.code === 'B33');
    expect(attachStandGeometry([{ id: 'A1', retired: true }], MDPC_LAYOUT)).toEqual([]);
    const placedB33 = positionsOf({ positions: [boardStand('B033', { latitude: retired.center[1], longitude: retired.center[0] })] })
      .find(position => position.id === 'B33');
    expect(placedB33.geometry).toMatchObject({ center: retired.center, geometrySource: 'derived', locationSource: 'occ' });
    expect(attachStandGeometry([{ id: 'B33', locationSource: 'reference' }], MDPC_LAYOUT)[0].geometry).toBeNull();
    // A location saved by OCC within 80 m moves the layout's box.
    const moved = destinationPoint(a1.center, 90, 20);
    expect(attachStandGeometry([{ id: 'A1', locationSource: 'occ', latitude: moved[1], longitude: moved[0] }], MDPC_LAYOUT)[0]
      .geometry).toMatchObject({ center: moved, geometrySource: 'translated' });
    // The size of a box of its own comes from the stand's largest aircraft.
    expect(attachStandGeometry([{ ...c7, geometry: undefined, maxAircraftSize: 'Widebody' }], MDPC_LAYOUT)[0].geometry.sizeLetter)
      .toBe('E');
  });
});

describe('coverage', () => {
  it('coverageInitials and sameAgentCodes', () => {
    expect(coverageInitials(['M. Castillo'])).toBe('MC');
    expect(coverageInitials([marta])).toBe('MC');
    expect(coverageInitials([marta, luis])).toBe('LP +1');
    expect(coverageInitials([' Ana Ruiz ', ana, marta])).toBe('AR +1');
    expect(coverageInitials(['Ángel'])).toBe('Á');
    for (const names of [[], null, undefined, ['  ']]) expect(coverageInitials(names)).toBe('');

    const positions = positionsOf(createRampScenario(NOW).board);
    expect([...sameAgentCodes(positions, 'A1')].sort()).toEqual(['A2', 'A6']);
    expect([...sameAgentCodes(positions, 'a-04')].sort()).toEqual(['A5', 'B22']);
    expect([...sameAgentCodes(positions, 'A9')].sort()).toEqual(['A10', 'B21', 'C7']);
    expect(sameAgentCodes(positions, 'A3').size).toBe(0);
    expect(sameAgentCodes(positions, 'Z9').size).toBe(0);
    expect(sameAgentCodes(undefined, 'A1').size).toBe(0);
  });

  it('unlocatedStands lists the board stands that no drawn position shows, without a location', () => {
    const { board } = createRampScenario(NOW);
    const positions = positionsOf(board);
    const unlocated = unlocatedStands(board.positions, positions, { asOf: board.asOf });
    expect(unlocated).toEqual([expect.objectContaining({
      id: 'Z1', standId: 'stand-Z1', status: 'available', latitude: null, longitude: null, locationSource: 'none',
      geometry: null, coveredBy: [], updatedAt: board.asOf,
    })]);
    // The retired B33 of the layout is not drawn until OCC places it.
    const b33 = [boardStand('B033'), boardStand('b-33')];
    expect(unlocatedStands(b33, positionsOf({ positions: b33 })).map(position => position.id)).toEqual(['B33']);
    expect(unlocatedStands([], positions)).toEqual([]);
    expect(unlocatedStands(board.positions, positions.map(position => ({ ...position, geometry: null }))))
      .toHaveLength(board.positions.length);
    // The positions of a screen carry no geometry (they never import the layout): one with a location is drawn.
    const screenPositions = mapOccupancyToRampPositions(REFERENCES, board, board.asOf);
    expect(screenPositions.every(position => !('geometry' in position))).toBe(true);
    expect(unlocatedStands(board.positions, screenPositions).map(position => position.id)).toEqual(['Z1']);
    const withoutLocation = screenPositions.map(position => (position.id === 'A5' ? { ...position, latitude: null, longitude: null } : position));
    expect(unlocatedStands(board.positions, withoutLocation).map(position => position.id)).toEqual(['A5', 'Z1']);
  });

  it('never imports the dataset (source text guard)', () => {
    // Screens and services may import the model; the 157 KB layout reaches it only as a parameter.
    expect(readFileSync('src/features/maps/stands/standModel.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
