import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { RAMP_POSITIONS } from '../../dashboard/positionsData';
import { createQaLayout } from '../testing/mapFixtures';
import { MDPC_LAYOUT, indexLayout as reExportedIndex, matchStand as reExportedMatch } from './airportLayout';
import { indexLayout, layoutStandReferences, matchStand } from './layoutIndex';

describe('layoutIndex', () => {
  it('layoutStandReferences gives the code, terminal, centre and retired flag of every stand in the shape of RAMP_POSITIONS', () => {
    const references = layoutStandReferences(MDPC_LAYOUT);
    expect(references).toHaveLength(MDPC_LAYOUT.stands.length);
    for (const [at, stand] of MDPC_LAYOUT.stands.entries()) {
      expect(references[at], stand.code).toEqual({
        id: stand.code, code: stand.code, terminal: stand.terminal, lat: stand.center[1], lon: stand.center[0],
        retired: stand.retired === true,
      });
    }
    // The same list as positionsData.js, whose points are the centres of the owner's document (decision 20).
    expect(references.map(({ id, terminal, lat, lon, retired }) => ({ id, terminal, lat, lon, retired })))
      .toEqual(RAMP_POSITIONS.map(position => ({ ...position, retired: position.retired === true })));
    expect(references.filter(reference => reference.retired).map(reference => reference.id)).toEqual(['B33']);
    expect(Object.isFrozen(references)).toBe(true);
    expect(Object.isFrozen(references[0])).toBe(true);

    // Codes come out normalized, and a stand without a centre is not a reference.
    const layout = createQaLayout();
    const loose = layoutStandReferences({
      stands: [{ ...layout.stands[0], code: 'a-010' }, { ...layout.stands[1], center: null }, null],
    });
    expect(loose.map(reference => reference.id)).toEqual(['A10']);
    expect(loose[0]).toMatchObject({ code: 'A10', terminal: 'A', lat: layout.stands[0].center[1], retired: false });
    expect(layoutStandReferences(null)).toEqual([]);
  });

  it('indexes stands by normalized code and alias, and the dataset module re-exports the same functions', () => {
    const layout = createQaLayout();
    const index = indexLayout(layout);
    expect(matchStand('a-02', index)).toEqual({ stand: layout.stands[1], via: 'code' });
    expect(matchStand('9A', index)).toBeNull();
    expect(index.graph.nodes.size).toBe(layout.taxiGraph.nodes.length);
    expect(index.nodesById.get('ah-a').kind).toBe('apronHold');
    expect(reExportedIndex).toBe(indexLayout);
    expect(reExportedMatch).toBe(matchStand);
  });

  it('never imports the dataset (source text guard)', () => {
    // The stand model and the screens import this module; the 157 KB layout stays in the map chunk (OccMap.jsx).
    expect(readFileSync('src/features/maps/airport/layoutIndex.js', 'utf8')).not.toMatch(/airportLayout|\.json['"]/);
  });
});
