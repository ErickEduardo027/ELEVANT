import { describe, expect, it } from 'vitest';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { ROUTE_KINDS, TRAFFIC_KINDS, TRAFFIC_TAGS, TRAIL_KINDS } from '../traffic/trafficFeatures';
import { trafficLegendEntries } from './trafficLegend';

const ALL = { kinds: TRAFFIC_KINDS, tags: TRAFFIC_TAGS, trails: TRAIL_KINDS, route: ROUTE_KINDS };

describe('traffic legend entries', () => {
  it('lists the aircraft kinds, then the tags in the words of the vocabulary, then the trails and the route', () => {
    const entries = trafficLegendEntries(ALL);
    expect(entries.map(entry => [entry.key, entry.swatch])).toEqual([
      ['aviamArrival', 'aviamArrival'], ['aviamDeparture', 'aviamDeparture'], ['other', 'other'],
      ['otherGround', 'otherGround'], ['demo', 'demo'], ['estimated', 'estimated'], ['stale', 'stale'],
      ['trail', 'trail'], ['trailEstimated', 'trailEstimated'], ['routeFlown', 'routeFlown'], ['routeNext', 'routeNext'],
    ]);
    expect(entries.map(entry => entry.label)).toEqual([
      'Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale', 'Otro tráfico', 'Otro tráfico en tierra',
      TAGS.demo.es, TAGS.estimated.es, TAGS.stale.short.es, 'Estela', 'Estela estimada', 'Recorrido del vuelo elegido',
      'Hasta su próximo punto, en línea recta',
    ]);
    // A kind is its swatch and its name; a tag its word with a short hint; the two trails share a line.
    expect(entries.map(entry => entry.hint)).toEqual([null, null, null, null, 'Vuelo simulado', 'Calculada con el horario',
      'Atenuado, con su antigüedad', null, null, null, null]);
    // The two parts of the route take a line each.
    expect(entries.map(entry => entry.span)).toEqual([2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2]);
    // A trail alone takes the whole line, so nothing else of the legend sits beside it.
    expect(trafficLegendEntries({ trails: ['live'] })).toEqual([{ key: 'trail', swatch: 'trail', label: 'Estela', hint: null,
      span: 2 }]);
  });

  it('lists only what is on screen, in English too', () => {
    expect(trafficLegendEntries()).toEqual([]);
    expect(trafficLegendEntries({ kinds: ['other'], tags: [], trails: [] }).map(entry => entry.key)).toEqual(['other']);
    // Values outside the lists are not entries.
    expect(trafficLegendEntries({ kinds: ['zeppelin'], tags: ['unofficial'], trails: ['dotted'], route: ['planned'] })).toEqual([]);
    const english = trafficLegendEntries(ALL, { language: 'en' });
    expect(english.map(entry => entry.label)).toEqual([
      'AVIAM arrival', 'AVIAM departure', 'Other traffic', 'Other traffic on the ground', TAGS.demo.en, TAGS.estimated.en,
      TAGS.stale.short.en, 'Trail', 'Estimated trail', 'Route flown by the selected flight', 'To its next point, in a straight line',
    ]);
    expect(english.find(entry => entry.key === 'estimated').hint).toBe('Calculated from the schedule');
  });
});
