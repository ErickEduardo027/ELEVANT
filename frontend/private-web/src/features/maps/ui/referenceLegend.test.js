import { describe, expect, it } from 'vitest';
import { REFERENCE_LEGEND_KINDS } from '../traffic/referenceFeatures';
import { referenceLegendEntries } from './referenceLegend';

const ALL = { kinds: REFERENCE_LEGEND_KINDS, runway: { arrival: '08', source: 'wind' } };

describe('reference legend entries', () => {
  it('lists each reference only while it is on screen', () => {
    const entries = referenceLegendEntries(ALL);
    expect(entries.map(entry => [entry.key, entry.swatch])).toEqual([
      ['rings', 'rings'], ['centrelines', 'centrelines'], ['runwayInUse', 'runwayInUse'], ['airports', 'airports'],
      ['counterparts', 'counterparts'], ['vor', 'vor'], ['ndb', 'ndb'], ['night', 'night'],
    ]);
    expect(entries.map(entry => entry.label)).toEqual([
      'Anillos de distancia', 'Eje de pista extendido (marca cada NM)', 'Pista 08 (estimada por el viento)',
      'Aeropuerto de la región', 'Origen o destino de un vuelo de hoy', 'Radioayuda VOR-DME', 'Radioayuda NDB',
      'Noche (tras el crepúsculo civil)',
    ]);
    // Only what is on screen, in the legend's order whatever order it comes in.
    expect(referenceLegendEntries({ kinds: ['night', 'rings'] }).map(entry => entry.key)).toEqual(['rings', 'night']);
    expect(referenceLegendEntries()).toEqual([]);
    expect(referenceLegendEntries({ kinds: ['fir', 'weather'] })).toEqual([]);
    // The runway in use says where it comes from, and is not listed without its runway.
    expect(referenceLegendEntries({ kinds: ['runwayInUse'], runway: { arrival: '26', source: 'live' } }))
      .toEqual([{ key: 'runwayInUse', swatch: 'runwayInUse', label: 'Pista 26 (según las llegadas)' }]);
    expect(referenceLegendEntries({ kinds: ['runwayInUse'], runway: { arrival: '08', source: 'default' } })[0].label)
      .toBe('Pista 08 (habitual)');
    expect(referenceLegendEntries({ kinds: ['centrelines', 'runwayInUse'], runway: null }).map(entry => entry.key))
      .toEqual(['centrelines']);
  });

  it('speaks English', () => {
    expect(referenceLegendEntries(ALL, { language: 'en' }).map(entry => entry.label)).toEqual([
      'Range rings', 'Extended runway centreline (a tick per NM)', 'Runway 08 (estimated from the wind)',
      'Airport in the region', 'Origin or destination of a flight today', 'VOR-DME navaid', 'NDB navaid',
      'Night (after civil twilight)',
    ]);
  });
});
