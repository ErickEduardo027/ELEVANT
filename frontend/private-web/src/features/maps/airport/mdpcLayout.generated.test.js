import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { buildLayout, stringifyLayout } from '../../../../scripts/maps/lib/buildLayout.mjs';

// The committed layout is generated, never edited by hand: rebuilding it from the committed inputs must give the same
// bytes. When this fails, run `node scripts/maps/build-mdpc-layout.mjs` and commit inputs and outputs together.
const read = path => readFileSync(path, 'utf8');
const inputs = () => ({
  osm: JSON.parse(read('scripts/maps/input/mdpc.osm.json')),
  ourAirports: JSON.parse(read('scripts/maps/input/ourairports.mdpc.json')),
  standPoints: RAMP_POSITIONS,
  overrides: JSON.parse(read('scripts/maps/input/stand-overrides.json')),
});

describe('generated MDPC layout', () => {
  it('the committed layout and region context equal the generator output for the committed inputs', () => {
    const first = buildLayout(inputs());
    expect(stringifyLayout(first.layout)).toBe(read('src/features/maps/airport/data/mdpc.layout.json'));
    expect(stringifyLayout(first.region)).toBe(read('src/features/maps/airport/data/region.context.json'));
    // Deterministic: a second run gives the same report and layout.
    const second = buildLayout(inputs());
    expect(second.report).toEqual(first.report);
    expect(stringifyLayout(second.layout)).toBe(stringifyLayout(first.layout));
  });

  it('keeps the manual table honest: aliases ship empty and nothing is marked reviewed without a reviewer', () => {
    const overrides = JSON.parse(read('scripts/maps/input/stand-overrides.json'));
    expect(overrides.schema).toBe(1);
    expect(overrides.aliases).toEqual({});
    for (const [code, entry] of Object.entries(overrides.stands)) {
      const allowed = ['osmWay', 'headingTrue', 'sizeLetter', 'kind', 'polygon', 'retired', 'note', 'reviewedBy',
        'reviewedOn'];
      expect(Object.keys(entry).filter(key => !allowed.includes(key)), code).toEqual([]);
      expect(typeof entry.note, code).toBe('string');
    }
  });
});
