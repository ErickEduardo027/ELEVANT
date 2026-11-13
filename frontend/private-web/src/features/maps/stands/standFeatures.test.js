import { describe, expect, it } from 'vitest';
import { STAND_STATE_KEYS } from '../../occ-ui/statusVocabulary';
import { standDrawState, toStandFeatures } from './standFeatures';

// Synthetic stands of a positions screen; the codes come padded and in lower case as the database may write them.
const position = overrides => ({
  id: 'A1', terminal: 'A', latitude: 18.5642, longitude: -68.3603, status: 'available', locationSource: 'reference',
  ...overrides,
});

describe('toStandFeatures', () => {
  it('builds one point per located stand keyed by the normalized code and drops stands without coordinates', () => {
    const data = toStandFeatures([
      position({ id: 'A01', status: 'occupied', locationSource: 'occ' }),
      position({ id: 'b21', terminal: 'B', latitude: 18.5631, longitude: -68.3692, status: 'planned' }),
      position({ id: 'BN6', terminal: 'FBO', latitude: null, longitude: null }),
      position({ id: 'B22', latitude: Number.NaN }),
      position({ code: 'FBO3', id: undefined, terminal: undefined, terminalCode: 'FBO', latitude: 18.5701, longitude: -68.3521 }),
      position({ id: 'A1', status: 'planned', latitude: 18.5, longitude: -68.3 }),
      position({ id: 'A9', retired: true }),
      null,
    ]);

    expect(data.type).toBe('FeatureCollection');
    expect(data.features).toEqual([
      {
        type: 'Feature',
        properties: { code: 'A1', terminal: 'A', status: 'occupied', unofficial: false },
        geometry: { type: 'Point', coordinates: [-68.3603, 18.5642] },
      },
      {
        type: 'Feature',
        properties: { code: 'B21', terminal: 'B', status: 'planned', unofficial: true },
        geometry: { type: 'Point', coordinates: [-68.3692, 18.5631] },
      },
      {
        type: 'Feature',
        properties: { code: 'FBO3', terminal: 'FBO', status: 'available', unofficial: true },
        geometry: { type: 'Point', coordinates: [-68.3521, 18.5701] },
      },
    ]);
    // Each code once, so the promoted ids of the source are unique; nothing comes back for nothing.
    expect(toStandFeatures([]).features).toEqual([]);
    expect(toStandFeatures(undefined).features).toEqual([]);
  });

  it('marks stands without an OCC location as unofficial', () => {
    const data = toStandFeatures([
      position({ id: 'A2', locationSource: 'occ' }),
      position({ id: 'A3', locationSource: 'reference' }),
      // The planning view of the positions map carries no location source: its stands sit at the reference.
      position({ id: 'A4', locationSource: undefined }),
    ]);
    expect(data.features.map(feature => [feature.properties.code, feature.properties.unofficial])).toEqual([
      ['A2', false], ['A3', true], ['A4', true],
    ]);
  });

  it('draws every state of the vocabulary as it is and anything else as free', () => {
    for (const state of STAND_STATE_KEYS) expect(standDrawState(state)).toBe(state);
    for (const other of [undefined, null, '', 'Occupied', 'blocked']) expect(standDrawState(other)).toBe('available');
    expect(toStandFeatures([position({ status: 'blocked' })]).features[0].properties.status).toBe('available');
  });
});
