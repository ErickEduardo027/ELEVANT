import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { withStandDisplay } from '../../maps/stands/standModel';
import { createRampScenario } from '../../maps/testing/mapFixtures';
import { createMapFlights } from '../../maps/testing/trafficFixtures';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { RAMP_POSITIONS } from '../positionsData';
import { consoleMessages } from './consoleMessages';
import {
  bandWindow, buildStandTimeline, flightsByTurnaroundOf, standCounts, TIMELINE_FILTERS, TIMELINE_RANGES,
} from './standTimeline';

const NOW = Date.parse('2026-11-14T18:32:00Z'); // 14:32 in Punta Cana
const MINUTE = 60_000;
const t = createTranslator(consoleMessages, 'es');
const at = minutes => new Date(NOW + minutes * MINUTE).toISOString();

// The console's stands at NOW: the positions board over the reference list, read with the map flights.
function ramp({ nowMs = NOW, flightsByTurnaround } = {}) {
  const scenario = createRampScenario(NOW);
  const flights = flightsByTurnaround ?? scenario.flightsByTurnaround;
  const stands = withStandDisplay(mapOccupancyToRampPositions(RAMP_POSITIONS, scenario.board, at(0)),
    { nowMs, flightsByTurnaround: flights });
  return { stands, flightsByTurnaround: flights };
}

function band(options = {}, { range = '4h', filter = 'withFlights', aircraft } = {}) {
  const { stands, flightsByTurnaround } = ramp(options);
  return buildStandTimeline({ stands, flightsByTurnaround, aircraft, nowMs: NOW,
    ...bandWindow(range, NOW, 'America/Santo_Domingo'), filter, t });
}

const rowOf = (timeline, code) => timeline.rows.find(row => row.id === code);

describe('standTimeline', () => {
  it('one row per stand, its visits as bars at their best times', () => {
    const timeline = band();
    // The stands with a visit in the window, in the order of the reference list.
    expect(timeline.rows.map(row => row.id)).toEqual(['A2', 'A3', 'A4', 'A5', 'A6', 'A9', 'B21']);
    for (const row of timeline.rows) expect(row.label).toBe(row.id);

    // The board's times: the recorded arrival is actual, the planned departure the schedule.
    const [onStand, incoming] = rowOf(timeline, 'A4').bars;
    expect(onStand).toMatchObject({ id: 'turn-DM205', arrivalFlight: 'DM205', departureFlight: 'DM206', state: 'onStand',
      startAt: Date.parse(at(-30)), startKind: 'actual', endAt: Date.parse(at(60)), endKind: 'scheduled' });
    expect(incoming).toMatchObject({ id: 'turn-DM207', state: 'planned', startAt: Date.parse(at(5)),
      startKind: 'scheduled' });

    // The map legs win over the board: the demo flight landed (runway, actual) and is still taxiing to A6, whatever
    // the board's recorded arrival says, so it is not on its stand yet; and it is marked «Demo».
    const [demo] = rowOf(timeline, 'A6').bars;
    expect(demo).toMatchObject({ arrivalFlight: 'ZZ9001', departureFlight: 'ZZ9002', startAt: Date.parse(at(-2)),
      startKind: 'actual', endAt: Date.parse(at(63)), endKind: 'scheduled', state: 'planned', demo: true,
      estimated: false, flightKey: 'p:demo-arr' });
    // The bar is estimated only when the map draws its aircraft at an estimated position.
    const estimated = band({}, { aircraft: [{ flightKey: 'p:demo-arr', quality: 'estimated' }] });
    expect(rowOf(estimated, 'A6').bars[0].estimated).toBe(true);
    // Once the server parks it, it is on its stand.
    const parked = buildStandTimeline({ ...ramp({ nowMs: NOW + 4 * MINUTE }), nowMs: NOW + 4 * MINUTE,
      ...bandWindow('4h', NOW, 'America/Santo_Domingo'), t });
    expect(rowOf(parked, 'A6').bars[0].state).toBe('onStand');
    // In operation: the turnaround InProgress (the board's status of an arrived visit).
    expect(rowOf(timeline, 'A9').bars[0].inOperation).toBe(true);
  });

  it('a pushed-back visit is departed', () => {
    const scenario = createRampScenario(NOW);
    const pushedBack = { code: 'PUSHBACK', actualAt: at(-3) };
    const leg = (turnaroundId, direction, flightNumber, extra) => ({ flightKey: `l:${flightNumber}`,
      visitKey: `t:${turnaroundId}`, turnaroundId, direction, flightNumber, phase: 'scheduled', scheduledAt: null,
      estimatedAt: null, actualAt: null, actualKind: null, isDemo: false, demo: null, stand: { code: 'A05' },
      milestones: [pushedBack], ...extra });
    const flightsByTurnaround = {
      ...scenario.flightsByTurnaround,
      // DM209 is still on the board's A5 list (the board was read before the tap); its map legs carry the PUSHBACK.
      'turn-DM209': [leg('turn-DM209', 'Arrival', 'DM209', { phase: 'arrived', actualAt: at(-45), actualKind: 'OnBlock' }),
        leg('turn-DM209', 'Departure', 'DM210', { scheduledAt: at(10) })],
      // DM150 left A5 an hour ago: the board no longer lists it, the map keeps the assignment.
      'turn-DM150': [leg('turn-DM150', 'Arrival', 'DM150', { phase: 'arrived', actualAt: at(-100), actualKind: 'OnBlock',
        milestones: [{ code: 'PUSHBACK', actualAt: at(-40) }] }),
      leg('turn-DM150', 'Departure', 'DM151', { phase: 'departed', scheduledAt: at(-45), actualAt: at(-35),
        actualKind: 'Runway', milestones: [{ code: 'PUSHBACK', actualAt: at(-40) }] })],
    };
    const timeline = band({ flightsByTurnaround });
    const bars = rowOf(timeline, 'A5').bars;
    expect(bars.map(bar => [bar.id, bar.state])).toEqual([['turn-DM150', 'departed'], ['turn-DM209', 'departed']]);
    expect(bars[0]).toMatchObject({ arrivalFlight: 'DM150', departureFlight: 'DM151', startAt: Date.parse(at(-100)),
      startKind: 'actual', endAt: Date.parse(at(-35)), endKind: 'actual' });
  });

  it('with flights hides empty rows', () => {
    const { stands } = ramp();
    expect(TIMELINE_FILTERS).toEqual(['withFlights', 'all']);
    const withFlights = band();
    const all = band({}, { filter: 'all' });
    // Every stand of the console has a row in «Todas», in its order; «Con vuelos» keeps only those with bars.
    expect(all.rows.map(row => row.id)).toEqual(stands.map(stand => stand.id));
    expect(rowOf(all, 'A1').bars).toEqual([]);
    expect(rowOf(withFlights, 'A1')).toBeUndefined();
    expect(all.rows.filter(row => row.bars.length > 0).map(row => row.id)).toEqual(withFlights.rows.map(row => row.id));
    // A visit outside the window is not a flight of it: A2's arrival in 90 min is out of a window that ends in 60.
    const narrow = buildStandTimeline({ stands, nowMs: NOW, windowStart: NOW - 60 * MINUTE, windowEnd: NOW + 60 * MINUTE,
      filter: 'withFlights', t });
    expect(rowOf(narrow, 'A2')).toBeUndefined();
    expect(() => buildStandTimeline({ stands, nowMs: NOW, filter: 'empty', t })).toThrow(RangeError);
  });

  it('a conflict carries its signal', () => {
    const timeline = band();
    // A4: another aircraft comes onto it before the one on it leaves (urgent), on the visit the stand shows.
    const [current, incoming] = rowOf(timeline, 'A4').bars;
    expect(current.conflict).toEqual({ label: 'Otra aeronave llega a esta posición', signal: 'urgent' });
    expect(incoming.conflict).toBeNull();
    // A3: nobody covers it and its flight is due within the hour; B21: its aircraft is past its departure time.
    expect(rowOf(timeline, 'A3').bars[0].conflict).toEqual({ label: 'Sin agente que la cubra', signal: 'attention' });
    expect(rowOf(timeline, 'B21').bars[0].conflict).toEqual({ label: 'Pasó su hora de salida', signal: 'attention' });
    // Calm stands carry none.
    expect(rowOf(timeline, 'A2').bars[0].conflict).toBeNull();
    expect(rowOf(timeline, 'A9').bars[0].conflict).toBeNull();
    // The words follow the language.
    const english = buildStandTimeline({ ...ramp(), nowMs: NOW, ...bandWindow('4h', NOW, 'America/Santo_Domingo'),
      t: createTranslator(consoleMessages, 'en') });
    expect(rowOf(english, 'A4').bars[0].conflict.label).toBe('Another aircraft is arriving at this stand');
  });

  it('the day window follows the station time zone', () => {
    expect(Object.keys(TIMELINE_RANGES)).toEqual(['4h', '8h', 'day']);
    // 22:30 of the 13th in Punta Cana is already the 14th in UTC: the band shows the station's day.
    const evening = Date.parse('2026-11-14T02:30:00Z');
    expect(bandWindow('day', evening, 'America/Santo_Domingo')).toEqual({
      windowStart: Date.parse('2026-11-13T04:00:00Z'), windowEnd: Date.parse('2026-11-14T04:00:00Z'),
    });
    expect(bandWindow('day', evening, 'UTC')).toEqual({
      windowStart: Date.parse('2026-11-14T00:00:00Z'), windowEnd: Date.parse('2026-11-15T00:00:00Z'),
    });
    expect(bandWindow('4h', NOW, 'America/Santo_Domingo')).toEqual({ windowStart: NOW - 60 * MINUTE,
      windowEnd: NOW + 180 * MINUTE });
    expect(bandWindow('8h', NOW, 'America/Santo_Domingo')).toEqual({ windowStart: NOW - 120 * MINUTE,
      windowEnd: NOW + 360 * MINUTE });
    expect(bandWindow('day', Number.NaN, 'America/Santo_Domingo')).toBeNull();
    expect(() => bandWindow('week', NOW, 'America/Santo_Domingo')).toThrow(RangeError);

    // In the day window B21's visit, which arrived at 13:02, is drawn from its arrival.
    const day = band({}, { range: 'day' });
    expect(rowOf(day, 'B21').bars[0].startAt).toBe(Date.parse(at(-90)));
  });

  it('keeps one Map of flights per read and counts the stands by their seven states', () => {
    const { flights } = createMapFlights();
    const byTurnaround = flightsByTurnaroundOf(flights);
    expect(flightsByTurnaroundOf(flights)).toBe(byTurnaround);
    expect(flightsByTurnaroundOf([...flights])).not.toBe(byTurnaround);
    // The legs of each visit, the proposals still to import (no turnaround) left out.
    expect([...byTurnaround.values()].map(legs => legs.map(leg => leg.flightNumber)))
      .toEqual([['ZZ161', 'ZZ162'], ['ZZ300', 'ZZ301'], ['ZZ500'], ['ZZ700']]);
    expect(flightsByTurnaroundOf(null)).toEqual(new Map());

    const counts = standCounts(ramp().stands);
    expect(Object.keys(counts)).toEqual([...STAND_STATE_KEYS]);
    // A4 and A9 occupied, A5 and B21 about to be freed, A3 and A6 arriving, A2 planned, A10 disabled by A9.
    expect(counts).toMatchObject({ occupied: 2, releasing: 2, arriving: 2, planned: 1, disabled: 1 });
    expect(Object.values(counts).reduce((sum, value) => sum + value, 0)).toBe(ramp().stands.length);
    expect(standCounts(null)).toEqual(Object.fromEntries(STAND_STATE_KEYS.map(key => [key, 0])));
  });
});
