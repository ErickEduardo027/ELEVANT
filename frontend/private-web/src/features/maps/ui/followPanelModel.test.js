import { describe, expect, it } from 'vitest';
import { destinationPoint } from '../airport/geo';
import { PUJ_ARP } from '../core/cameraPresets';
import { flightFacts, operationFacts, phaseKeyOf } from './followPanelModel';

// What the panel of «Seguir en 3D» says of the followed aircraft (CN-30).
const STATION = { code: 'PUJ', point: PUJ_ARP };
const KT = 1 / 1.943844;
const FPM = 1 / 196.8504;
const FT = 0.3048;
const at20Nm = destinationPoint(PUJ_ARP, 290, 20 * 1852);
const ROW = Object.freeze({
  flightKey: 'p:1', direction: 'Arrival', flightNumber: 'AA465', callsign: 'AAL465',
  airline: { name: 'American Airlines', iataCode: 'AA', icaoCode: 'AAL' },
  counterpart: { iataCode: 'MIA', icaoCode: 'KMIA' }, scheduledAt: '2026-11-13T15:14:00Z',
  estimatedAt: '2026-11-13T15:26:00Z', actualAt: null, phase: 'approaching', imported: true,
  turnaround: { operationCode: 'AA465-1113', status: 'Confirmed', operationStatus: 'Assigned' },
  stand: { code: 'B21', terminalCode: 'B' },
  aircraft: { registration: 'ZZ-AA465', typeIcaoCode: 'A321' },
  milestones: [{ code: 'BLOCK_ON', actualAt: '2026-11-13T15:30:00Z' }, { code: 'PUSHBACK', actualAt: null }],
});
const AIRBORNE = Object.freeze({
  id: 'f:p:1', kind: 'aviam', flightKey: 'p:1', lon: at20Nm[0], lat: at20Nm[1], altM: 3_800 * FT, gsMs: 261 * KT,
  vrateMs: -900 * FPM, trackDeg: 119.6, onGround: false, phase: 'approach', squawk: '2531', quality: 'live',
  typeIcao: 'A321', registration: 'ZZ-AA465', callsign: 'AAL465', flightNumber: 'AA465',
});

describe('the follow panel model (CN-30)', () => {
  it('reads the flight of an aircraft in the air: route, instruments, distance and arrival', () => {
    const facts = flightFacts(AIRBORNE, ROW, { station: STATION });
    expect(facts).toMatchObject({
      title: 'AA465', subtitle: 'AAL465', airline: 'American Airlines', type: 'A321', registration: 'ZZ-AA465',
      from: 'MIA', to: 'PUJ', altitude: { ft: 3_800, ground: false }, speedKt: 261, verticalFpm: -900, headingDeg: 120,
      squawk: '2531', phase: 'approach', source: 'live',
    });
    expect(facts.distanceNm).toBeCloseTo(20, 0);
    // 20 NM at 261 kt: about 5 minutes.
    expect(facts.etaMin).toBe(5);
  });

  it('reads other traffic without a row, and a departure from the station', () => {
    const other = flightFacts({ ...AIRBORNE, kind: 'other', flightKey: null, flightNumber: null, callsign: 'ACA1410' }, null,
      { station: STATION });
    expect(other).toMatchObject({ title: 'ACA1410', airline: 'ACA', from: null, to: null });
    const departing = flightFacts({ ...AIRBORNE, direction: 'Departure', vrateMs: 2_000 * FPM, phase: null },
      { ...ROW, direction: 'Departure', counterpart: { iataCode: 'PTY' } }, { station: STATION });
    expect(departing).toMatchObject({ from: 'PUJ', to: 'PTY', etaMin: null, phase: 'climb' });
  });

  it('names the phase from what the aircraft does when the motion names none', () => {
    expect(phaseKeyOf({ onGround: true, gsMs: 0 })).toBe('stopped');
    expect(phaseKeyOf({ onGround: true, gsMs: 12 * KT })).toBe('taxiing');
    expect(phaseKeyOf({ onGround: false, vrateMs: 0 })).toBe('cruise');
    expect(phaseKeyOf({ onGround: false, vrateMs: -1_500 * FPM })).toBe('descent');
    expect(phaseKeyOf({ phase: 'taxiIn', onGround: true })).toBe('taxiIn');
    // A phase the signal contradicts gives way: on the runway at 137 kt after a plan's «final» is the landing roll.
    expect(phaseKeyOf({ phase: 'final', onGround: true, gsMs: 137 * KT })).toBe('landing');
    expect(phaseKeyOf({ phase: 'climb', onGround: true, gsMs: 140 * KT })).toBe('takeoff');
    expect(phaseKeyOf({ phase: 'taxiOut', onGround: false, vrateMs: 1_800 * FPM })).toBe('climb');
    // On the ground: no altitude, no vertical rate.
    expect(flightFacts({ ...AIRBORNE, onGround: true, altM: 14 }, ROW, { station: STATION })).toMatchObject({
      altitude: { ft: null, ground: true }, verticalFpm: null, etaMin: null,
    });
  });

  it('reads the operation of an ELEVANT flight: code, state, stand, times, delay and milestones', () => {
    const operation = operationFacts(ROW, { standMismatch: { assigned: 'B21', actual: 'B22' } }, { locale: 'es-DO' });
    expect(operation).toMatchObject({
      code: 'AA465-1113', status: 'Asignada', stand: 'B21', terminal: 'B', direction: 'arrival', imported: true,
      scheduled: '11:14', estimated: '11:26', actual: null, delayMin: 12, mismatch: { assigned: 'B21', actual: 'B22' },
    });
    expect(operation.milestones).toEqual([{ code: 'BLOCK_ON', at: '11:30' }]);
    expect(operationFacts(null)).toBeNull();
  });
});
