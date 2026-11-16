import { describe, expect, it } from 'vitest';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { REFERENCE_LEGEND_KINDS } from '../traffic/referenceFeatures';
import { referenceLegendEntries } from './referenceLegend';

const ALL = { kinds: REFERENCE_LEGEND_KINDS, runway: { arrival: '08', source: 'wind' } };

describe('reference legend entries', () => {
  it('lists each reference only while it is on screen', () => {
    const entries = referenceLegendEntries(ALL);
    expect(entries.map(entry => [entry.key, entry.swatch])).toEqual([
      ['rings', 'rings'], ['centrelines', 'centrelines'], ['runwayInUse', 'runwayInUse'],
      ['counterparts', 'counterparts'], ['vor', 'vor'], ['ndb', 'ndb'], ['night', 'night'],
    ]);
    expect(entries.map(entry => entry.label)).toEqual([
      'Anillos de distancia', 'Eje de pista extendido (marca cada NM)', 'Pista 08 (estimada por el viento)',
      'Origen o destino de un vuelo de hoy', 'Radioayuda VOR-DME', 'Radioayuda NDB',
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
      'Origin or destination of a flight today', 'VOR-DME navaid', 'NDB navaid',
      'Night (after civil twilight)',
    ]);
  });
  it('lists the weather after the references: the wind with «No oficial», also «Sin actualizar» when stale, each image with its time', () => {
    const imagery = { goes: { time: '2026-11-13T14:50:00Z', precision: 'instant' }, imerg: { time: '2026-11-13', precision: 'day' } };
    const entries = referenceLegendEntries({ kinds: ['imerg', 'wind', 'rings', 'goes'], runway: null, imagery });
    expect(entries).toEqual([
      { key: 'rings', swatch: 'rings', label: 'Anillos de distancia' },
      { key: 'wind', swatch: 'wind', label: 'Viento en pista', tag: TAGS.unofficial.es, hint: null },
      { key: 'goes', swatch: 'goes', label: 'Nubes por satélite (GOES-East, infrarrojo)', tag: null, hint: 'Imagen de las 10:50' },
      { key: 'imerg', swatch: 'imerg', label: 'Lluvia estimada (IMERG)', tag: null, hint: 'Imagen del 13 nov' },
    ]);
    // A stale wind is dimmed and says it with the vocabulary's word, and it is still not official: a late METAR is no
    // more official, and the map's label never says it (contracts 2.4: nothing depends on hover). In English too.
    expect(referenceLegendEntries({ kinds: ['windStale'] })).toEqual([
      { key: 'windStale', swatch: 'windStale', label: 'Viento en pista', tag: TAGS.unofficial.es, hint: TAGS.stale.short.es },
    ]);
    expect(referenceLegendEntries({ kinds: ['wind', 'goes'], imagery }, { language: 'en' }).map(entry => [entry.label,
      entry.tag, entry.hint])).toEqual([
      ['Runway wind', 'Unofficial', null], ['Satellite clouds (GOES-East, infrared)', null, 'Image of 10:50'],
    ]);
    expect(referenceLegendEntries({ kinds: ['windStale'] }, { language: 'en' }).map(entry => [entry.label, entry.tag,
      entry.hint])).toEqual([['Runway wind', 'Unofficial', 'Not updated']]);
    // An image without its time is still listed, without a hint.
    expect(referenceLegendEntries({ kinds: ['goes'] })[0].hint).toBeNull();
  });
});
