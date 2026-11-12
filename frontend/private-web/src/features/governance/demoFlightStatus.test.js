import { describe, expect, it } from 'vitest';
import {
  clockTime, countdownText, demoFlightAction, demoFlightPhase, isMoving, operationStatusLabel, phaseLabel, serverClockOffset,
} from './demoFlightStatus';

// A flight triggered at 10:00 in Punta Cana (14:00Z) to park in 8 minutes with 60 on the ground, as the server's clock
// resolves it: the taxi takes 45 % of the 8 minutes (3 min 36 s), so the wheels touch the runway at 10:04:24.
const zone = 'America/Santo_Domingo';
const at = iso => Date.parse(iso);
const flight = (extra = {}) => ({ id: 'demo-1', state: 'Active', phase: 'Approach', imported: false,
  appearAt: '2026-11-12T14:00:00+00:00', touchdownAt: '2026-11-12T14:04:24+00:00', onBlockAt: '2026-11-12T14:08:00+00:00',
  scheduledOffBlockAt: '2026-11-12T15:08:00+00:00', offBlockAt: '2026-11-12T15:08:00+00:00',
  takeoffAt: '2026-11-12T15:13:00+00:00', vanishAt: '2026-11-12T15:23:00+00:00', operationStatus: null, ...extra });
/** Imported: the aircraft waits at its stand for the agent, so the server knows no departure yet. */
const waiting = (extra = {}) => flight({ imported: true, offBlockAt: null, takeoffAt: null, vanishAt: null,
  operationStatus: 'Assigned', ...extra });
const cancelled = flight({ state: 'Cancelled', phase: 'Gone', offBlockAt: null, takeoffAt: null,
  vanishAt: '2026-11-12T14:02:00+00:00' });

describe('demo flight status (ADR-0041)', () => {
  it('recomputes the phase between two reads from the server instants', () => {
    // The read said «Approach»; the browser follows the instants until the next one.
    const read = flight();
    expect(demoFlightPhase(read, at('2026-11-12T14:01:00Z'))).toBe('Approach');
    expect(demoFlightPhase(read, at('2026-11-12T14:04:23.999Z'))).toBe('Approach');
    expect(demoFlightPhase(read, at('2026-11-12T14:04:24Z'))).toBe('TaxiIn');
    expect(demoFlightPhase(read, at('2026-11-12T14:08:00Z'))).toBe('Parked');
    expect(demoFlightPhase(read, at('2026-11-12T15:08:00Z'))).toBe('TaxiOut');
    expect(demoFlightPhase(read, at('2026-11-12T15:13:00Z'))).toBe('Departed');
    expect(demoFlightPhase(read, at('2026-11-12T15:23:00Z'))).toBe('Gone');
    // An instant the server has not decided is never reached: the imported aircraft keeps waiting.
    expect(demoFlightPhase(waiting(), at('2026-11-12T18:00:00Z'))).toBe('Parked');
    // A cancelled flight vanished at its cancel instant.
    expect(demoFlightPhase(cancelled, at('2026-11-12T14:03:00Z'))).toBe('Gone');
    // Instants with more than milliseconds read the same.
    expect(demoFlightPhase(flight({ touchdownAt: '2026-11-12T14:04:24.1234567+00:00' }), at('2026-11-12T14:04:24.200Z')))
      .toBe('TaxiIn');
  });

  it('counts down on the server clock offset', () => {
    // This browser runs 10 s behind: the server stamped 14:03:40 in the middle of a 400 ms round trip.
    const offset = serverClockOffset('2026-11-12T14:03:40+00:00', at('2026-11-12T14:03:29.800Z'), at('2026-11-12T14:03:30.200Z'));
    expect(offset).toBe(10_000);
    const browserNow = at('2026-11-12T14:03:30Z');
    expect(countdownText(flight(), browserNow + offset, zone)).toBe('Llega a la posición en 4 min 20 s');
    expect(countdownText(flight(), browserNow, zone)).toBe('Llega a la posición en 4 min 30 s');
    expect(serverClockOffset('not a time', 1, 2)).toBe(0);
    expect(serverClockOffset('2026-11-12T14:00:00Z', Number.NaN, 2)).toBe(0);

    expect(countdownText(flight(), at('2026-11-12T14:07:15Z'), zone)).toBe('Llega a la posición en 45 s');
    expect(countdownText(flight(), at('2026-11-12T14:03:00Z'), zone)).toBe('Llega a la posición en 5 min');
    expect(countdownText(flight(), at('2026-11-12T14:10:00Z'), zone)).toBe('En posición desde las 10:08 · Sale a las 11:08');
    expect(countdownText(waiting(), at('2026-11-12T14:10:00Z'), zone))
      .toBe('En posición desde las 10:08 · Salida programada a las 11:08');
    expect(countdownText(waiting(), at('2026-11-12T15:30:00Z'), zone))
      .toBe('En posición desde las 10:08 · Espera el push-back del agente');
    expect(countdownText(flight(), at('2026-11-12T15:08:00Z'), zone)).toBe('Despega en 5 min');
    expect(countdownText(flight(), at('2026-11-12T15:14:00Z'), zone)).toBe('Despegó a las 11:13');
    expect(countdownText(flight({ state: 'Finished' }), at('2026-11-12T15:30:00Z'), zone)).toBe('Terminó a las 11:23');
    expect(countdownText(cancelled, at('2026-11-12T14:03:00Z'), zone)).toBe('Cancelado a las 10:02');
    expect(clockTime(null, zone)).toBe('—');
    expect(clockTime('2026-11-12T14:08:00Z', 'Not/A_Zone')).toBe('10:08');
  });

  it('labels every state and operation status', () => {
    expect(['Approach', 'TaxiIn', 'Parked', 'TaxiOut', 'Departed', 'Gone'].map(phase => phaseLabel('Active', phase)))
      .toEqual(['En aproximación', 'Aterrizó, rueda a la posición', 'En posición', 'Saliendo', 'Despegó', 'Terminado']);
    expect(phaseLabel('Cancelled', 'Gone')).toBe('Cancelado');
    expect(phaseLabel('Finished', 'Departed')).toBe('Despegó');
    expect(phaseLabel('Finished', 'Gone')).toBe('Terminado');

    expect(['Planned', 'Assigned', 'InProgress', 'PendingReview', 'InReview', 'Approved', 'Returned', 'Cancelled']
      .map(operationStatusLabel)).toEqual(['Operación planificada', 'Operación asignada', 'Operación en curso',
      'Operación pendiente de revisión', 'Operación en revisión', 'Operación aprobada', 'Operación devuelta',
      'Operación cancelada']);
    expect(operationStatusLabel(null)).toBe('');
    // A state this screen does not know is named, never shown alone as an English word.
    expect(operationStatusLabel('Paused')).toBe('Operación: Otro (Paused)');
  });

  it('an aircraft moves only in approach, taxi-in and taxi-out', () => {
    const moving = iso => isMoving(flight(), at(iso));
    expect(['2026-11-12T14:01:00Z', '2026-11-12T14:05:00Z', '2026-11-12T14:10:00Z', '2026-11-12T15:09:00Z',
      '2026-11-12T15:14:00Z', '2026-11-12T15:30:00Z'].map(moving)).toEqual([true, true, false, true, false, false]);
    expect(isMoving(waiting(), at('2026-11-12T16:00:00Z'))).toBe(false);
    expect(isMoving(cancelled, at('2026-11-12T14:01:00Z'))).toBe(false);
    expect(isMoving(flight({ state: 'Finished' }), at('2026-11-12T14:01:00Z'))).toBe(false);
  });

  it('offers «Cancelar vuelo» before touchdown and «Terminar demo» until the aircraft leaves', () => {
    expect(demoFlightAction(flight(), at('2026-11-12T14:01:00Z'))).toBe('Cancel');
    expect(demoFlightAction(flight(), at('2026-11-12T14:05:00Z'))).toBe('Finish');
    expect(demoFlightAction(waiting(), at('2026-11-12T16:00:00Z'))).toBe('Finish');
    expect(demoFlightAction(flight(), at('2026-11-12T15:09:00Z'))).toBeNull();
    // «Terminar demo» already brought the off-block forward to the on-block: nothing is left to end.
    expect(demoFlightAction(waiting({ offBlockAt: '2026-11-12T14:08:00+00:00', takeoffAt: '2026-11-12T14:13:00+00:00',
      vanishAt: '2026-11-12T14:23:00+00:00' }), at('2026-11-12T14:06:00Z'))).toBeNull();
    expect(demoFlightAction(cancelled, at('2026-11-12T14:01:00Z'))).toBeNull();
  });
});
