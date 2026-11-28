import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { haversineM } from '../airport/geo';
import { resolveLivery } from '../aircraft/liveries';
import { AIRCRAFT_TYPES } from '../aircraft/types';
import { GALLERY_AIRCRAFT, GALLERY_SCENARIO, GALLERY_TYPES } from './aircraftShowcaseScene';
import { findScene } from './scenes';

const manifest = JSON.parse(readFileSync(path.resolve(process.cwd(), 'public/models/aircraft/manifest.json'), 'utf8'));

describe('the gallery of the 3D models (M5)', () => {
  it('names every type of the models manifest once, each a type of types.js', () => {
    expect([...GALLERY_TYPES].sort()).toEqual(Object.keys(manifest.types).sort());
    for (const type of GALLERY_TYPES) expect(AIRCRAFT_TYPES[type], type).toBeTruthy();
  });

  it('draws each type three times with three different liveries, at invented addresses', () => {
    expect(GALLERY_AIRCRAFT).toHaveLength(GALLERY_TYPES.length * 3);
    expect(new Set(GALLERY_AIRCRAFT.map(item => item.hex)).size).toBe(GALLERY_AIRCRAFT.length);
    for (const item of GALLERY_AIRCRAFT) {
      expect(item.hex).toMatch(/^f0d1[0-9a-f]{2}$/);
      expect(item.registration).toMatch(/^ZZ-/);
    }
    for (const type of GALLERY_TYPES) {
      const liveries = GALLERY_AIRCRAFT.filter(item => item.type === type).map(item => resolveLivery(item).id);
      expect(new Set(liveries).size, type).toBe(3);
    }
  });

  it('keeps every aircraft well clear of the others, and the scene draws them as live traffic', () => {
    for (const [index, item] of GALLERY_AIRCRAFT.entries()) {
      for (const other of GALLERY_AIRCRAFT.slice(index + 1)) {
        expect(haversineM(item.at, other.at), `${item.hex} ${other.hex}`).toBeGreaterThan(150);
      }
    }
    const scene = findScene('airfield-3d-models');
    expect(scene).toMatchObject({ view: 'airfield', pitchMode: '3d', traffic: GALLERY_SCENARIO });
    expect(GALLERY_SCENARIO.picture.aircraft.map(item => item.typeIcaoCode)).toEqual(GALLERY_AIRCRAFT.map(item => item.type));
  });
});
