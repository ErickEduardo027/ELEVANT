import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions, mapTurnaroundsToRampPositions } from '../../positions-map/positionsMapMappers';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { destinationPoint } from '../airport/geo';
import { layoutStandReferences } from '../airport/layoutIndex';
import { SCENARIO_AGENTS, boardStand, boardVisit, createQaLayout, createRampScenario } from '../testing/mapFixtures';
import {
  ARRIVING_WINDOW_MS, COVERAGE_WINDOW_MS, RELEASING_WINDOW_MS, attachStandGeometry, coverageInitials,
  deriveDisplayStatus, floorToMinute, sameAgentCodes, standDrawState, unlocatedStands,
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

  it('without milestones or an aircraft position the board\'s arrival time puts the aircraft on the stand', () => {
    const position = positionOf('A5', onA5([visit({ arrivalInMin: -4, departureInMin: 80, arrived: true })]));
    expect(deriveDisplayStatus(position, { nowMs: NOW })).toMatchObject({
      state: 'occupied', departureAt: NOW + 80 * MINUTE, minutesToDeparture: 80, flightNumber: 'DM162', signals: [],
    });
    // Known milestones without BLOCK_ON say nothing by themselves: with no aircraft position the board still decides.
    const flights = { 'turn-DM161': [{ direction: 'Arrival', phase: 'landed', milestones: [] }] };
    expect(deriveDisplayStatus(position, { nowMs: NOW, flightsByTurnaround: flights }).state).toBe('occupied');
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

  it('raises «Otra aeronave llega a esta posición» when another visit arrives while the stand is occupied', () => {
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
  });

  it('never imports the dataset (source text guard)', () => {
    // Screens and services may import the model; the 157 KB layout reaches it only as a parameter.
    expect(readFileSync('src/features/maps/stands/standModel.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
