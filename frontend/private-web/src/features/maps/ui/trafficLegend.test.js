import { describe, expect, it } from 'vitest';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { ROUTE_KINDS, TRAFFIC_KINDS, TRAFFIC_TAGS, TRAIL_KINDS } from '../traffic/trafficFeatures';
import { trafficLegendEntries } from './trafficLegend';

const ALL = { kinds: TRAFFIC_KINDS, tags: TRAFFIC_TAGS, trails: TRAIL_KINDS, route: ROUTE_KINDS };

describe('traffic legend entries', () => {
  it('lists the aircraft kinds, then the tags in the words of the vocabulary, then the trails and the route', () => {
    const entries = trafficLegendEntries(ALL);
    const routeKeys = ['routeFlownObserved', 'routeFlownEstimated', 'routeRemaining', 'routeMark'];
    expect(entries.map(entry => [entry.key, entry.swatch])).toEqual([
      ['aviamArrival', 'aviamArrival'], ['aviamDeparture', 'aviamDeparture'], ['other', 'other'],
      ['otherGround', 'otherGround'], ['demo', 'demo'], ['estimated', 'estimated'], ['stale', 'stale'],
      ['trail', 'trail'], ['trailEstimated', 'trailEstimated'], ...routeKeys.map(key => [key, key]),
    ]);
    expect(entries.map(entry => entry.label)).toEqual([
      'Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale', 'Otro tráfico', 'Otro tráfico en tierra',
      TAGS.demo.es, TAGS.estimated.es, TAGS.stale.short.es, 'Estela', 'Estela estimada', 'Recorrido observado',
      'Trayecto estimado', 'Ruta prevista', 'Puntos de la ruta',
    ]);
    // A kind is its swatch and its name; a tag its word with a short hint; the two trails share a line. A stale
    // aircraft's tag says the time of its last position, and so does the hint. The route's marked points say which.
    expect(entries.map(entry => entry.hint)).toEqual([null, null, null, null, 'Vuelo simulado', 'Calculada con el horario',
      'Atenuado, con la hora de su última posición', null, null, null, null, null, 'Toma de pista, salida y posición']);
    // Each part of the route takes a line.
    expect(entries.map(entry => entry.span)).toEqual([2, 2, 2, 2, 2, 2, 2, 1, 1, 2, 2, 2, 2]);
    // The route alone: only the parts on screen (trafficOnScreen lists them in the order of ROUTE_KINDS).
    expect(trafficLegendEntries({ route: ['flownEstimated', 'remaining'] }).map(entry => entry.label))
      .toEqual(['Trayecto estimado', 'Ruta prevista']);
    // A trail alone takes the whole line, so nothing else of the legend sits beside it.
    expect(trafficLegendEntries({ trails: ['live'] })).toEqual([{ key: 'trail', swatch: 'trail', label: 'Estela', hint: null,
      span: 2 }]);
  });

  it('lists only what is on screen, in English too', () => {
    expect(trafficLegendEntries()).toEqual([]);
    expect(trafficLegendEntries({ kinds: ['other'], tags: [], trails: [] }).map(entry => entry.key)).toEqual(['other']);
    // Values outside the lists are not entries, the parts of PR M5's route among them.
    expect(trafficLegendEntries({ kinds: ['zeppelin'], tags: ['unofficial'], trails: ['dotted'], route: ['planned', 'flown',
      'next'] })).toEqual([]);
    const english = trafficLegendEntries(ALL, { language: 'en' });
    expect(english.map(entry => entry.label)).toEqual([
      'AVIAM arrival', 'AVIAM departure', 'Other traffic', 'Other traffic on the ground', TAGS.demo.en, TAGS.estimated.en,
      TAGS.stale.short.en, 'Trail', 'Estimated trail', 'Observed path', 'Estimated path', 'Planned route', 'Route points',
    ]);
    expect(english.at(-1).hint).toBe('Touchdown, runway exit and stand');
    expect(english.find(entry => entry.key === 'estimated').hint).toBe('Calculated from the schedule');
    expect(english.find(entry => entry.key === 'stale').hint).toBe('Dimmed, with the time of its last position');
  });
});
