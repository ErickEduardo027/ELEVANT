import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LIVERY, LIVERIES, LIVERY_ZONES, PART_ZONES, liveryName, liveryZones, resolveLivery,
} from './liveries';

// The liveries of the detailed aircraft (CN-30): brand colours and the airline's words, resolved from what the map
// knows of an aircraft; no artwork.
const HEX = /^#[0-9a-f]{6}$/i;
const PUJ_AIRLINES = ['CMP', 'AAL', 'DAL', 'UAL', 'JBU', 'SWA', 'ACA', 'WJA', 'SWG', 'TSC', 'AFR', 'AEA', 'AVA', 'RPB',
  'DWI', 'NKS', 'FFT'];

describe('liveries (CN-30)', () => {
  it('cover the airlines seen at Punta Cana, each with its colours, its name and an empty logo slot', () => {
    expect(Object.keys(LIVERIES).sort()).toEqual([...PUJ_AIRLINES].sort());
    for (const livery of [...Object.values(LIVERIES), DEFAULT_LIVERY]) {
      const icao = livery.id;
      for (const colour of ['fuselage', 'belly', 'tail', 'engine', 'wing', 'text', 'tailText']) {
        expect(livery[colour], `${icao} ${colour}`).toMatch(HEX);
      }
      for (const colour of ['cheatline', 'cheatline2', 'tailAccent']) {
        if (livery[colour] !== null) expect(livery[colour], `${icao} ${colour}`).toMatch(HEX);
      }
      // No logo ships: a licensed one can be dropped in by its path, without code.
      expect(livery.logoTexture, icao).toBe('');
      expect(Object.isFrozen(livery)).toBe(true);
    }
    for (const icao of PUJ_AIRLINES) {
      expect(LIVERIES[icao].icao).toBe(icao);
      expect(LIVERIES[icao].iata).toMatch(/^[A-Z0-9]{2}$/);
      expect(LIVERIES[icao].name.length).toBeGreaterThan(1);
    }
    expect(DEFAULT_LIVERY.name).toBe('');
  });

  it('resolve by the airline ICAO designator, its IATA code, the callsign prefix or the flight number', () => {
    expect(resolveLivery({ airlineIcao: 'cmp' })).toBe(LIVERIES.CMP);
    expect(resolveLivery({ airlineIata: 'AA' })).toBe(LIVERIES.AAL);
    expect(resolveLivery({ callsign: 'CMP893' })).toBe(LIVERIES.CMP);
    expect(resolveLivery({ callsign: ' dwi304 ' })).toBe(LIVERIES.DWI);
    expect(resolveLivery({ flightNumber: 'CM893' })).toBe(LIVERIES.CMP);
    expect(resolveLivery({ flightNumber: 'B6 123' })).toBe(LIVERIES.JBU);
    expect(resolveLivery({ flightNumber: 'P57301' })).toBe(LIVERIES.RPB);
    // The ICAO designator wins over a callsign of another airline (a wet lease flies under its operator's code).
    expect(resolveLivery({ airlineIcao: 'UAL', callsign: 'CMP893' })).toBe(LIVERIES.UAL);
  });

  it('fall back to the default for a registration as callsign, an unknown airline or nothing', () => {
    expect(resolveLivery({ callsign: 'N123AB' })).toBe(DEFAULT_LIVERY);
    expect(resolveLivery({ callsign: 'ZZZ161', flightNumber: 'ZZ161' })).toBe(DEFAULT_LIVERY);
    expect(resolveLivery({})).toBe(DEFAULT_LIVERY);
    expect(resolveLivery(null)).toBe(DEFAULT_LIVERY);
  });

  it('set the name as the livery writes it', () => {
    expect(liveryName(LIVERIES.AAL)).toBe('AMERICAN');
    expect(liveryName(LIVERIES.JBU)).toBe('jetBlue');
    expect(liveryName(DEFAULT_LIVERY)).toBe('');
  });
});

describe('livery zones (M9)', () => {
  it('names the five zones an instanced model paints and the zone of every part of the procedural models', () => {
    expect(LIVERY_ZONES).toEqual(['fuselage', 'belly', 'tail', 'engine', 'wing']);
    expect(Object.isFrozen(LIVERY_ZONES)).toBe(true);
    for (const zone of Object.values(PART_ZONES)) expect(LIVERY_ZONES).toContain(zone);
    expect(PART_ZONES).toMatchObject({ fuselage: 'fuselage', fin: 'tail', nacelle: 'engine', wing: 'wing' });
  });

  it('liveryZones gives each zone's colour of a livery, or of the livery an aircraft resolves to', () => {
    expect(liveryZones(LIVERIES.SWA)).toEqual({ fuselage: '#304cb2', belly: '#304cb2', tail: '#304cb2',
      engine: '#304cb2', wing: LIVERIES.SWA.wing });
    expect(liveryZones({ callsign: 'DAL455' })).toEqual({ fuselage: '#ffffff', belly: '#0a2c5c', tail: '#0a2c5c',
      engine: '#0a2c5c', wing: LIVERIES.DAL.wing });
    expect(liveryZones()).toEqual(liveryZones(DEFAULT_LIVERY));
    for (const colour of Object.values(liveryZones(LIVERIES.CMP))) expect(colour).toMatch(HEX);
    expect(Object.isFrozen(liveryZones(LIVERIES.CMP))).toBe(true);
  });
});
