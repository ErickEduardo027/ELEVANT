import { describe, expect, it } from 'vitest';
import { MDPC_LAYOUT } from '../airport/airportLayout';
import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../mapMessages';
import { boardVisit } from '../testing/mapFixtures';
import { nextChangeText, reasonText, coordinatesText } from '../ui/StandDetailFacts';
import { withStandDisplay } from './standModel';
import { cardinalOf, standAircraftOf, standCharacteristics, standStatus, WINGSPAN_LIMIT_M } from './standStatus';

// Synthetic stands at 14:07 in Punta Cana (18:07 UTC), with the display the stand model derives (stands/standModel.js).
const NOW = Date.parse('2026-11-13T18:07:00Z');
const MIN = 60_000;
const t = createTranslator(mapMessages, 'es');
const en = createTranslator(mapMessages, 'en');
const stand = (state, display = {}, extra = {}) => ({
  id: 'A2', standId: 'stand-A2', status: state, displayStatus: state, coveredBy: [], ...extra,
  display: {
    state, signals: [], visit: null, arrivalAt: null, departureAt: null, minutesToArrival: null, minutesToDeparture: null,
    flightNumber: null, aircraftType: null, isDemo: false, cancelledBy: null, detail: null, next: null, ...display,
  },
});
const visit = { arrivalFlightNumber: 'ZZ9001', departureFlightNumber: 'ZZ9002', aircraftRegistration: 'hi9001' };

describe('standStatus: why a stand reads its state and what comes next (owner request of 2026-11-15)', () => {
  it('a free, a disabled and an unverified stand', () => {
    expect(standStatus(stand('available'))).toEqual({ state: 'available', reason: { key: 'available', params: {} }, next: null });
    expect(standStatus(stand('disabled', { cancelledBy: 'A9' })).reason).toEqual({ key: 'disabledBy', params: { code: 'A9' } });
    expect(reasonText(standStatus(stand('disabled', { cancelledBy: 'A9' })).reason, t, 'es-DO'))
      .toBe('Inhabilitada: anulada por A9 ocupada');
    expect(standStatus(stand('disabled')).reason.key).toBe('disabled');
    expect(standStatus(stand('unverified')).reason.key).toBe('unverified');
    expect(standStatus(null)).toBeNull();
  });

  it('planned: the flight it waits for, and «Llegando» 15 minutes before it is due', () => {
    const status = standStatus(stand('planned', { visit, arrivalAt: NOW + 40 * MIN, minutesToArrival: 40 }));
    expect(status.reason).toEqual({ key: 'planned', params: { flight: 'ZZ9001', arrivalAt: NOW + 40 * MIN } });
    expect(status.next).toEqual({ key: 'becomesArriving', at: NOW + 25 * MIN, minutes: 25, params: {} });
    expect(reasonText(status.reason, t, 'es-DO')).toMatch(/^Planificada para ZZ9001, llega \d\d:\d\d$/);
    expect(nextChangeText(status.next, t, 'es-DO')).toMatch(/^Empieza su llegada a las \d\d:\d\d · en 25 min$/);
  });

  it('arriving: «aterrizó 14:05, llega en 3 min» once it landed, and the stand is taken at its arrival', () => {
    const status = standStatus(stand('arriving', {
      visit, arrivalAt: NOW + 3 * MIN, minutesToArrival: 3,
      detail: { arrival: { actualAt: NOW - 2 * MIN }, departure: {} },
    }));
    expect(status.reason.key).toBe('arrivingLanded');
    expect(reasonText(status.reason, t, 'es-DO')).toBe('Llegando: ZZ9001 aterrizó 14:05, llega en 3 min');
    expect(nextChangeText(status.next, t, 'es-DO')).toBe('El avión entra en la posición a las 14:10 · en 3 min');
    // Not landed yet: when it is due.
    const due = standStatus(stand('arriving', { visit, arrivalAt: NOW + 10 * MIN, minutesToArrival: 10 }));
    expect(reasonText(due.reason, t, 'es-DO')).toBe('Llegando: ZZ9001 llega 14:17, en 10 min');
  });

  it('occupied: since its arrival, recorded or seen, and «Por liberar» 15 minutes before it leaves', () => {
    const occupied = standStatus(stand('occupied', {
      visit: { ...visit, arrivedAt: '2026-11-13T17:10:00Z' }, departureAt: NOW + 63 * MIN, minutesToDeparture: 63,
      detail: { arrival: { actualAt: Date.parse('2026-11-13T17:10:00Z') }, departure: {} },
    }));
    expect(reasonText(occupied.reason, t, 'es-DO')).toBe('Ocupada por ZZ9001 desde las 13:10 (llegada registrada)');
    // The notice that nobody recorded the arrival wins over the board's arrival time.
    expect(standStatus({ ...stand('occupied', { visit: { ...visit, arrivedAt: '2026-11-13T17:10:00Z' },
      detail: { arrival: { actualAt: NOW }, departure: {} } }), signals: [{ kind: 'notice', reason: 'arrivalNotRecorded' }] })
      .reason.key).toBe('occupiedSeen');
    expect(occupied.next).toEqual({ key: 'becomesReleasing', at: NOW + 48 * MIN, minutes: 48, params: {} });
    const seen = standStatus(stand('occupied', { visit, detail: { arrival: { actualAt: NOW - 5 * MIN }, departure: {} } }));
    expect(seen.reason.key).toBe('occupiedSeen');
    expect(seen.next).toBeNull();
    expect(standStatus(stand('occupied', { visit })).reason.key).toBe('occupiedNoTime');
  });

  it('occupied since its aircraft reached the stand, never since its runway time (N23)', () => {
    // The board's arrival time is the runway time (13:59): it never says since when the stand is taken.
    const parked = arrival => stand('occupied', {
      visit: { ...visit, arrivedAt: '2026-11-13T17:59:00Z' }, departureAt: NOW + 63 * MIN, minutesToDeparture: 63,
      detail: { arrival: { landedAt: NOW - 8 * MIN, onStandAt: null, onStandRecorded: false, ...arrival }, departure: {} },
    });
    // OCC's on-block or a BLOCK_ON: recorded.
    const recorded = standStatus(parked({ onStandAt: NOW - 4 * MIN, onStandRecorded: true, actualAt: NOW - 4 * MIN }));
    expect(recorded.reason).toEqual({ key: 'occupiedRecorded', params: { flight: 'ZZ9001', sinceAt: NOW - 4 * MIN } });
    expect(reasonText(recorded.reason, t, 'es-DO')).toBe('Ocupada por ZZ9001 desde las 14:03 (llegada registrada)');
    // The demo chocks: the time the server planned, which nobody recorded.
    const chocks = standStatus(parked({ onStandAt: NOW - 4 * MIN, actualAt: NOW - 4 * MIN }));
    expect(reasonText(chocks.reason, t, 'es-DO')).toBe('Ocupada por ZZ9001 desde las 14:03');
    // Only its runway time (its aircraft seen in the box): nobody knows since when it is there.
    const landedOnly = standStatus(parked({ actualAt: NOW - 8 * MIN }));
    expect(landedOnly.reason).toEqual({ key: 'occupiedNoTime', params: { flight: 'ZZ9001', sinceAt: null } });
    expect(reasonText(landedOnly.reason, t, 'es-DO')).toBe('Ocupada por ZZ9001');
    expect(reasonText(recorded.reason, en, 'en-US')).toBe('Occupied by ZZ9001 since 14:03 (arrival recorded)');
  });

  it('arriving: «aterrizó» is its runway time, never the time it reached the stand (N23)', () => {
    const arriving = arrival => standStatus(stand('arriving', { visit, arrivalAt: NOW + 3 * MIN, minutesToArrival: 3,
      detail: { arrival: { landedAt: null, onStandAt: null, onStandRecorded: false, ...arrival }, departure: {} } }));
    expect(reasonText(arriving({ landedAt: NOW - 2 * MIN, actualAt: NOW - 2 * MIN }).reason, t, 'es-DO'))
      .toBe('Llegando: ZZ9001 aterrizó 14:05, llega en 3 min');
    // OCC's on-block while its aircraft is still seen outside the box: no landing time is known.
    const onBlock = arriving({ onStandAt: NOW - MIN, onStandRecorded: true, actualAt: NOW - MIN });
    expect(onBlock.reason).toEqual({ key: 'arriving', params: { flight: 'ZZ9001', landedAt: null, arrivalAt: NOW + 3 * MIN,
      minutes: 3 } });
  });

  it('the run of 16 November at A11: «aterrizó 19:49» at 19:50, «Ocupada… desde las 19:54» at 19:57 (N23)', () => {
    // As the demo worker leaves it (stands/standModel.test.js): the runway time on the arrival leg and as the board's
    // arrival time, the server's on-block at 19:54 and the tablet's BLOCK_ON at 19:54:40.
    const iso = ms => new Date(ms).toISOString();
    const utc = time => Date.parse(`2026-11-16T${time}Z`);
    const [T1950, touchdown, onBlock] = [utc('23:50:00'), utc('23:49:12'), utc('23:54:00')];
    const demo = { touchdownAt: iso(touchdown), onBlockAt: iso(onBlock), scheduledOffBlockAt: iso(onBlock + 60 * MIN),
      offBlockAt: null };
    const a11 = { id: 'A11', standId: 'stand-A11', status: 'occupied', coveredBy: ['Marta'], turnarounds: [boardVisit({
      nowMs: T1950, flight: 'WN9001', arrivalInMin: 4, departureInMin: 64, arrivedAt: iso(touchdown), isDemo: true })] };
    const legs = milestones => ({ 'turn-WN9001': [
      { direction: 'Arrival', flightNumber: 'WN9001', phase: 'landed', actualAt: iso(touchdown), actualKind: 'Runway',
        isDemo: true, demo, milestones },
      { direction: 'Departure', flightNumber: 'WN9002', phase: 'scheduled', isDemo: true, demo, milestones },
    ] });
    const reasonAt = (nowMs, milestones = []) => reasonText(standStatus(withStandDisplay([a11],
      { nowMs, flightsByTurnaround: legs(milestones) })[0]).reason, t, 'es-DO');
    expect(reasonAt(T1950)).toBe('Llegando: WN9001 aterrizó 19:49, llega en 4 min');
    expect(reasonAt(T1950 + 7 * MIN, [{ code: 'BLOCK_ON', actualAt: iso(utc('23:54:40')) }]))
      .toBe('Ocupada por WN9001 desde las 19:54 (llegada registrada)');
    expect(reasonAt(T1950 + 7 * MIN)).toBe('Ocupada por WN9001 desde las 19:54');
  });

  it('releasing: its departure, estimated or late, and the next visit or the stand free', () => {
    const releasing = standStatus(stand('releasing', {
      visit, departureAt: NOW + 10 * MIN, minutesToDeparture: 10, detail: { arrival: {}, departure: { estimatedAt: NOW + 10 * MIN } },
    }));
    expect(reasonText(releasing.reason, t, 'es-DO')).toBe('Por liberar: salida estimada 14:17');
    expect(nextChangeText(releasing.next, t, 'es-DO')).toBe('Se libera a las 14:17 · en 10 min');
    const late = standStatus(stand('releasing', { visit, departureAt: NOW - 5 * MIN, minutesToDeparture: -5 }));
    expect(reasonText(late.reason, t, 'es-DO')).toBe('Por liberar: debía salir a las 14:02, hace 5 min');
    expect(late.next.minutes).toBeNull();
    expect(nextChangeText(late.next, t, 'es-DO')).toBe('Se libera a las 14:02 · ahora');
    const turnover = standStatus(stand('releasing', {
      visit, departureAt: NOW + 10 * MIN, minutesToDeparture: 10,
      next: { flightNumber: 'ZZ500', arrivalAt: NOW + 30 * MIN, minutesToArrival: 30 },
    }));
    expect(nextChangeText(turnover.next, t, 'es-DO')).toBe('Llega ZZ500 a las 14:37 · en 30 min');
    expect(nextChangeText(turnover.next, en, 'en-US')).toBe('ZZ500 arrives at 14:37 · in 30 min');
    expect(reasonText(releasing.reason, en, 'en-US')).toBe('Releasing: estimated departure 14:17');
  });

  it('the aircraft of a stand, for the provider facts: never without a visit', () => {
    expect(standAircraftOf(stand('occupied', { visit, isDemo: true })))
      .toEqual({ registration: 'HI9001', isDemo: true, flightNumber: 'ZZ9002', aircraftType: null, state: 'occupied' });
    expect(standAircraftOf(stand('arriving', { visit, detail: { registration: 'N123AB' } })).registration).toBe('N123AB');
    expect(standAircraftOf(stand('available'))).toBeNull();
    expect(standAircraftOf(stand('disabled', { visit }))).toBeNull();
  });
});

describe('standCharacteristics: what a stand is', () => {
  it('reads the code letter, nose, size, centre and taxiway of a surveyed stand from the layout', () => {
    const facts = standCharacteristics({ id: 'A01', terminal: 'A', standId: 's', isRemote: false, hasBoardingBridge: false,
      coveredBy: ['Ana'], locationSource: 'reference', latitude: 18.56, longitude: -68.36 }, MDPC_LAYOUT);
    expect(facts).toMatchObject({
      code: 'A1', terminal: 'A', access: 'contact', sizeLetter: 'D', wingspanLimitM: 52, nose: 'S', headingTrue: 175,
      origin: 'reference', coveredBy: ['Ana'], narrowbodyOnly: false, cancelledBy: null, overlaps: [],
    });
    expect(facts.lengthM).toBeGreaterThan(50);
    expect(facts.widthM).toBeGreaterThan(40);
    expect(facts.center).toEqual([-68.36025, 18.564194]);
    expect(facts.taxiway).toMatch(/^[A-Z]\d?$/);
    expect(coordinatesText(facts.center, t)).toBe('18.56419° N, 68.36025° O');
    expect(coordinatesText(facts.center, en)).toBe('18.56419° N, 68.36025° W');
  });

  it('a bridge, a remote stand, an FBO stand, overlaps and limits; nothing invented without a layout', () => {
    expect(standCharacteristics({ id: 'B20', hasBoardingBridge: true }, MDPC_LAYOUT).access).toBe('bridge');
    expect(standCharacteristics({ id: 'AN5', isRemote: true }, MDPC_LAYOUT)).toMatchObject({ access: 'remote', overlaps: ['AN4'] });
    expect(standCharacteristics({ id: 'BN6' }, MDPC_LAYOUT)).toMatchObject({ access: 'fbo', sizeLetter: 'C', wingspanLimitM: 36 });
    expect(standCharacteristics({ id: 'A10', cancelledBy: 'A09', narrowbodyOnly: true }, MDPC_LAYOUT))
      .toMatchObject({ cancelledBy: 'A9', narrowbodyOnly: true });
    const bare = standCharacteristics({ id: 'Z1', terminal: 'Z' });
    expect(bare).toMatchObject({ code: 'Z1', terminal: 'Z', sizeLetter: null, nose: null, center: null, taxiway: null,
      coveredBy: null, origin: 'none' });
    expect(standCharacteristics(null)).toBeNull();
  });

  it('compass directions and the wingspan limits of Annex 14', () => {
    expect([0, 44, 90, 174.8, 225, 300, 359].map(cardinalOf)).toEqual(['N', 'NE', 'E', 'S', 'SW', 'NW', 'N']);
    expect(cardinalOf(null)).toBeNull();
    expect(WINGSPAN_LIMIT_M).toEqual({ A: 15, B: 24, C: 36, D: 52, E: 65, F: 80 });
  });
});
