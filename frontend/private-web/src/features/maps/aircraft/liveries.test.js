import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  DEFAULT_LIVERY, LIVERIES, LIVERY_ZONES, LOGO_BASE_URL, LOGO_IATA, PAINT_ZONES, PART_ZONES, liveryName, liveryPaint,
  liveryZones, resolveLivery,
} from './liveries';

// The liveries of the detailed aircraft (CN-30): brand colours and the airline's words, resolved from what the map
// knows of an aircraft; no artwork.
const HEX = /^#[0-9a-f]{6}$/i;
const PUJ_AIRLINES = ['CMP', 'AAL', 'DAL', 'UAL', 'JBU', 'SWA', 'ACA', 'WJA', 'SWG', 'TSC', 'AFR', 'AEA', 'AVA', 'RPB',
  'DWI', 'NKS', 'FFT'];

describe('liveries (CN-30)', () => {
  it('cover the airlines seen at Punta Cana, each with its colours, its name and its logo slot', () => {
    expect(Object.keys(LIVERIES).sort()).toEqual([...PUJ_AIRLINES].sort());
    for (const livery of [...Object.values(LIVERIES), DEFAULT_LIVERY]) {
      const icao = livery.id;
      for (const colour of ['fuselage', 'belly', 'tail', 'engine', 'wing', 'text', 'tailText']) {
        expect(livery[colour], `${icao} ${colour}`).toMatch(HEX);
      }
      for (const colour of ['cheatline', 'cheatline2', 'tailAccent']) {
        if (livery[colour] !== null) expect(livery[colour], `${icao} ${colour}`).toMatch(HEX);
      }
      // PR M5: the public-domain text logos ship as SVG under public/; the rest keep an empty slot.
      expect(livery.logoTexture, icao).toBe(LOGO_IATA.includes(livery.iata) ? `${LOGO_BASE_URL}${livery.iata}.svg` : '');
      expect(Object.isFrozen(livery)).toBe(true);
    }
    for (const icao of PUJ_AIRLINES) {
      expect(LIVERIES[icao].icao).toBe(icao);
      expect(LIVERIES[icao].iata).toMatch(/^[A-Z0-9]{2}$/);
      expect(LIVERIES[icao].name.length).toBeGreaterThan(1);
    }
    expect(DEFAULT_LIVERY.name).toBe('');
  });

  it('ship each text logo with its Commons record and none of the symbols under copyright (PR M5)', () => {
    const folder = path.resolve(process.cwd(), 'public', LOGO_BASE_URL.slice(1));
    const record = JSON.parse(fs.readFileSync(path.join(folder, 'logos.json'), 'utf8')).logos;
    expect(Object.keys(record).sort()).toEqual([...LOGO_IATA].sort());
    const readme = fs.readFileSync(path.join(folder, 'README.md'), 'utf8');
    for (const iata of LOGO_IATA) {
      const svg = fs.readFileSync(path.join(folder, `${iata}.svg`), 'utf8');
      expect(svg, iata).toMatch(/^<svg width="[\d.]+" height="[\d.]+"/);
      expect(svg, iata).not.toMatch(/<script|<image|<foreignObject|\son\w+\s*=|javascript:|data:|@import/i);
      expect(record[iata].tag, iata).toMatch(/^PD-(?:textlogo|shape)$/);
      expect(record[iata].trademarked, iata).toBe(true);
      expect(readme, iata).toContain(record[iata].page);
    }
    // Copa and Arajet have no SVG on Commons; the American symbol, the United globe and Frontier's tails are out.
    expect(LIVERIES.CMP.logoTexture).toBe('');
    expect(LIVERIES.DWI.logoTexture).toBe('');
    expect(Object.values(record).map(item => item.commonsFile).join(' ')).not.toMatch(/AA_Symbol|United_Airlines_Logo|tail/i);
    expect(readme).toMatch(/Aviso de marcas/);
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

  it("liveryZones gives each zone's colour of a livery, or of the livery an aircraft resolves to", () => {
    expect(liveryZones(LIVERIES.SWA)).toEqual({ fuselage: '#304cb2', belly: '#304cb2', tail: '#304cb2',
      engine: '#304cb2', wing: LIVERIES.SWA.wing });
    expect(liveryZones({ callsign: 'DAL455' })).toEqual({ fuselage: '#ffffff', belly: '#0a2c5c', tail: '#0a2c5c',
      engine: '#0a2c5c', wing: LIVERIES.DAL.wing });
    expect(liveryZones()).toEqual(liveryZones(DEFAULT_LIVERY));
    for (const colour of Object.values(liveryZones(LIVERIES.CMP))) expect(colour).toMatch(HEX);
    expect(Object.isFrozen(liveryZones(LIVERIES.CMP))).toBe(true);
  });

  it('take the instanced zones and the palette of the 3D models from one liveryPaint (M9 and PR M5)', () => {
    expect(PAINT_ZONES).toEqual(['fuselage', 'belly', 'cheatline', 'cheatline2', 'tail', 'tailAccent', 'engine', 'wing']);
    for (const zone of LIVERY_ZONES) expect(PAINT_ZONES).toContain(zone);
    for (const livery of [...Object.values(LIVERIES), DEFAULT_LIVERY]) {
      const paint = liveryPaint(livery);
      expect(Object.keys(paint), livery.id).toEqual(PAINT_ZONES);
      for (const colour of Object.values(paint)) expect(colour, livery.id).toMatch(HEX);
      for (const zone of LIVERY_ZONES) expect(liveryZones(livery)[zone], `${livery.id} ${zone}`).toBe(paint[zone]);
    }
    // A missing cheatline takes the upper body, a missing second cheatline the belly, a missing accent the fin.
    expect(LIVERIES.DAL.cheatline).toBeNull();
    expect(liveryPaint(LIVERIES.DAL)).toMatchObject({ cheatline: LIVERIES.DAL.fuselage, cheatline2: LIVERIES.DAL.belly });
    expect(liveryPaint({ callsign: 'DAL455' })).toBe(liveryPaint(LIVERIES.DAL));
    expect(Object.isFrozen(liveryPaint(LIVERIES.CMP))).toBe(true);
  });
});
