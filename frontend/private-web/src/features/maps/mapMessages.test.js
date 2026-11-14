import { OCC_AIR_PICTURE_REASONS } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import { OCC_SHORTCUTS } from '../occ-ui/occShortcuts';
import { STAND_STATES, TAGS } from '../occ-ui/statusVocabulary';
import { mapMessages } from './mapMessages';

// Every leaf of a message tree as `a.b.c`.
function leafPaths(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`]));
}

describe('map messages', () => {
  it('Spanish and English carry the same keys', () => {
    expect(Object.keys(mapMessages)).toEqual(['es', 'en']);
    const spanish = leafPaths(mapMessages.es);
    expect(leafPaths(mapMessages.en)).toEqual(spanish);
    for (const language of ['es', 'en']) {
      const t = createTranslator(mapMessages, language);
      for (const path of spanish) {
        const text = t(path);
        expect(typeof text, `${language} ${path}`).toBe('string');
        expect(text.trim(), `${language} ${path}`).not.toBe('');
        expect(text, `${language} ${path}`).toBe(text.trim());
      }
    }
    expect(createTranslator(mapMessages, 'es')('basemap.degraded'))
      .toBe('No se pudo cargar el mapa base. Los datos de ELEVANT siguen en el mapa.');
    expect(createTranslator(mapMessages, 'en')('basemap.degraded'))
      .toBe('The base map could not be loaded. ELEVANT data is still on the map.');
    expect(createTranslator(mapMessages, 'en')('view.group')).toBe('Map view');
  });

  it('names the airfield items of the legend and fills the tooltip of a runway or a taxiway in both languages', () => {
    const es = createTranslator(mapMessages, 'es');
    const en = createTranslator(mapMessages, 'en');
    expect(['runway', 'taxiway', 'hold', 'apron', 'terminal'].map(key => es(`legend.${key}`)))
      .toEqual(['Pista', 'Calle de rodaje', 'Punto de espera', 'Plataforma', 'Terminal']);
    expect(['runway', 'taxiway', 'hold', 'apron', 'terminal'].map(key => en(`legend.${key}`)))
      .toEqual(['Runway', 'Taxiway', 'Holding point', 'Apron', 'Terminal']);
    expect(`${es('airfield.runway', { id: '08/26' })} · ${es('airfield.size', { length: 3100, width: 45 })}`)
      .toBe('Pista 08/26 · 3100 m × 45 m');
    expect(es('airfield.taxiway', { ref: 'A' })).toBe('Calle de rodaje A');
    expect(es('airfield.unnamed')).toBe('Calle de rodaje sin nombre');
    expect([en('airfield.runway', { id: '09/27' }), en('airfield.size', { length: 3100, width: 45 }), en('airfield.taxiway', { ref: 'B' }),
      en('airfield.unnamed')]).toEqual(['Runway 09/27', '3100 m × 45 m', 'Taxiway B', 'Unnamed taxiway']);
  });

  it('names the stand marks of the legend in both languages: the terminal chip and its arrow, the combined link and the narrow-body box', () => {
    const es = createTranslator(mapMessages, 'es');
    const en = createTranslator(mapMessages, 'en');
    const keys = ['chip', 'chipHint', 'chipArriving', 'combined', 'narrowbody'];
    expect(keys.map(key => es(`legend.${key}`))).toEqual([
      'Posiciones de una terminal', 'Ocupadas del total; acerca el mapa para ver cada una',
      'Llega un vuelo a una posición de la terminal', 'Enlace con la posición que la anula', 'Caja de fuselaje estrecho',
    ]);
    expect(keys.map(key => en(`legend.${key}`))).toEqual([
      'Stands of a terminal', 'Occupied of the total; zoom in to see each one', 'A flight is arriving at a stand of the terminal',
      'Link to the stand that cancels it', 'Narrow-body box',
    ]);
    // The signals take their words from the vocabulary (SIGNALS), so no message repeats them.
    expect(Object.keys(mapMessages.es.legend).filter(key => /attention|urgent/i.test(key))).toEqual([]);
    // The clusters of M2 are gone with their words.
    expect(Object.keys(mapMessages.es.legend)).not.toContain('group');
    expect(Object.keys(mapMessages.en.legend)).not.toContain('groupHint');
  });

  it('the base-map notice names nothing that a map may not draw', () => {
    // Every map shows it: Monitoreo draws no stand, and the region and approach views draw none either.
    for (const language of ['es', 'en']) {
      const notice = createTranslator(mapMessages, language)('basemap.degraded');
      expect(notice, language).not.toMatch(/posici|stand|aer[oó]dromo|airfield|vuelo|flight|avi[oó]n|aircraft/i);
    }
  });

  it('says what a stand says of itself in both languages: times, coverage, signals and where its location comes from', () => {
    const es = createTranslator(mapMessages, 'es');
    const en = createTranslator(mapMessages, 'en');
    expect(es('stand.arrivesIn', { time: '14:20', minutes: 12 })).toBe('Llega 14:20 · en 12 min');
    expect(es('stand.arrives', { time: '14:20' })).toBe('Llega 14:20');
    expect(es('stand.departsIn', { time: '15:05', minutes: 8 })).toBe('Sale 15:05 · en 8 min');
    expect(es('stand.departs', { time: '15:05' })).toBe('Sale 15:05');
    expect(es('stand.coveredBy', { names: 'M. Castillo' })).toBe('Cubre M. Castillo');
    expect(['uncovered', 'overdue', 'conflict'].map(key => es(`stand.${key}`)))
      .toEqual(['Sin agente que la cubra', 'Pasó su hora de salida', 'Otra aeronave llega a esta posición']);
    expect(es('stand.cancelledBy', { code: '9A' })).toBe('Anulada por 9A');
    expect(['narrowbodyOnly', 'unlocated', 'located', 'reference'].map(key => es(`stand.${key}`)))
      .toEqual(['Solo fuselaje estrecho', 'Sin ubicar', 'Ubicada por OCC', 'Referencia interna sin verificar']);
    expect(en('stand.arrivesIn', { time: '14:20', minutes: 12 })).toBe('Arrives 14:20 · in 12 min');
    expect(en('stand.departs', { time: '15:05' })).toBe('Departs 15:05');
    expect(['uncovered', 'overdue', 'conflict', 'unlocated'].map(key => en(`stand.${key}`)))
      .toEqual(['No agent covers it', 'Past its departure time', 'Another aircraft is arriving at this stand', 'Not placed']);
  });

  it('says «Ubicar en el mapa» with its confirmation in the words of design D5, and names the new legend marks', () => {
    const es = createTranslator(mapMessages, 'es');
    const en = createTranslator(mapMessages, 'en');
    expect(es('placing.prompt', { code: 'A5' })).toBe('Haz clic en el centro de la posición A5.');
    expect([es('placing.save'), es('placing.cancel')]).toEqual(['Guardar ubicación', 'Cancelar']);
    expect(es('placing.saving', { code: 'A5' })).toBe('Guardando la ubicación de A5…');
    expect(es('placing.saved', { code: 'A5' })).toBe('A5 quedó ubicada en el mapa.');
    expect(es('placing.label', { code: 'A5' })).toBe('Ubicar A5 en el mapa');
    expect(en('placing.prompt', { code: 'A5' })).toBe('Click the centre of stand A5.');
    expect([en('placing.save'), en('placing.cancel'), en('placing.saved', { code: 'A5' })])
      .toEqual(['Save location', 'Cancel', 'A5 is now placed on the map.']);
    expect(['sameAgent', 'sameAgentHover', 'ghost', 'pending'].map(key => es(`legend.${key}`))).toEqual([
      'Mismo agente que la posición elegida', 'Mismo agente que la posición bajo el puntero', 'Posición que estás ubicando',
      'Ubicación sin guardar',
    ]);
    expect(['sameAgent', 'sameAgentHover'].map(key => en(`legend.${key}`)))
      .toEqual(['Same agent as the selected stand', 'Same agent as the stand under the pointer']);
    expect(es('facts.label')).toBe('Estado en el mapa');
  });

  it('takes the stand states and the tags from the vocabulary instead of copying them', () => {
    // «Libre», «Demo», «No oficial»… are the words of occ-ui/statusVocabulary.js on every screen.
    for (const language of ['es', 'en']) {
      const texts = leafPaths(mapMessages[language]).map(path => createTranslator(mapMessages, language)(path));
      const vocabulary = [...Object.values(STAND_STATES), ...Object.values(TAGS)].map(entry => entry[language]);
      for (const word of vocabulary) expect(texts, `${language} ${word}`).not.toContain(word);
    }
  });

  it('takes the view names from the key table instead of copying them', () => {
    const texts = ['es', 'en'].flatMap(language => leafPaths(mapMessages[language])
      .map(path => createTranslator(mapMessages, language)(path)));
    for (const { action, es, en } of OCC_SHORTCUTS.filter(row => row.action.startsWith('view.'))) {
      expect(texts, action).not.toContain(es);
      expect(texts, action).not.toContain(en);
    }
  });

  it('names the traffic of the legend, the words of a tag and the states of the air traffic in both languages', () => {
    const es = createTranslator(mapMessages, 'es');
    const en = createTranslator(mapMessages, 'en');
    expect(['aviamArrival', 'aviamDeparture', 'other', 'otherGround', 'trail', 'trailEstimated']
      .map(key => es(`legend.traffic.${key}`))).toEqual(['Vuelo de AVIAM que llega', 'Vuelo de AVIAM que sale',
      'Otro tráfico', 'Otro tráfico en tierra', 'Estela', 'Estela estimada']);
    expect(en('legend.traffic.aviamDeparture')).toBe('AVIAM departure');
    // The tag: GND on the ground. «est.» and «Sin actualizar desde las {time}» are the vocabulary's (TAGS), so the map
    // has no words of its own for a stale position: no age, no «Sin señal».
    expect(es('traffic.ground')).toBe('GND');
    expect([es('legend.traffic.staleHint'), en('legend.traffic.staleHint')])
      .toEqual(['Atenuado, con la hora de su última posición', 'Dimmed, with the time of its last position']);
    for (const language of ['es', 'en']) {
      const texts = leafPaths(mapMessages[language]).map(path => createTranslator(mapMessages, language)(path));
      expect(texts.filter(text => /sin señal|no signal|sin actualizar|not updated|^· \{count\}/i.test(text)), language)
        .toEqual([]);
    }
    // The chips over the map, word for word, and a reason for every one the air picture may give.
    expect([es('source.loading'), es('source.empty'), es('source.unavailable'), es('source.retry'), es('source.forbidden')])
      .toEqual(['Cargando tráfico…', 'No hay aviones en la zona', 'No hay tráfico en vivo en este momento.', 'Reintentar',
        'Tu acceso no incluye el tráfico en vivo.']);
    expect(es('source.delayed', { age: es('source.ageMinutes', { count: 4 }) }))
      .toBe('Tráfico con retraso: último dato hace 4 min.');
    expect(en('source.delayed', { age: en('source.ageSeconds', { count: 45 }) })).toBe('Traffic delayed: last data 45 s ago.');
    // The notice of the AVIAM flights, apart from the traffic's chip.
    expect([es('source.flights.label'), es('source.flights.unavailable'), en('source.flights.unavailable')])
      .toEqual(['Estado de los vuelos de AVIAM', 'No se pudieron cargar los vuelos de AVIAM.',
        'The AVIAM flights could not be loaded.']);
    for (const reason of OCC_AIR_PICTURE_REASONS) {
      expect(es(`source.reason.${reason}`), reason).toMatch(/^La fuente de tráfico .+\.$/);
      expect(en(`source.reason.${reason}`), reason).toMatch(/^The traffic source .+\.$/);
    }
    // The data block and the layers menu (PR M5 step c), in plain words.
    expect([es('dataBlock.label', { id: 'ZZ161' }), es('dataBlock.live', { age: es('dataBlock.seconds', { count: 4 }) }),
      es('dataBlock.noPosition'), es('dataBlock.demo'), es('dataBlock.notImported'), es('dataBlock.cancelledDemo')])
      .toEqual(['Vuelo ZZ161', 'En vivo · hace 4 s', 'Sin posición todavía', 'Vuelo demo', 'Sin importar',
        'Cancelado por el proveedor (demo)']);
    expect([es('dataBlock.viewTurnaround'), es('dataBlock.viewStand'), es('dataBlock.close')])
      .toEqual(['Ver escala', 'Ver posición', 'Cerrar']);
    expect(['traffic.aviam', 'traffic.other', 'traffic.labels', 'traffic.trails', 'route'].map(key => es(`layers.key.${key}`)))
      .toEqual(['Vuelos de AVIAM', 'Otro tráfico', 'Etiquetas de todo el tráfico', 'Estelas de todo el tráfico',
        'Ruta del vuelo elegido']);
    expect([es('layers.group.traffic'), es('layers.locked'), en('layers.group.traffic'), en('layers.key.traffic.aviam')])
      .toEqual(['Tráfico', 'Siempre visible', 'Traffic', 'AVIAM flights']);
    // The words the server writes never reach the screen: no reason names the provider or repeats a code.
    for (const language of ['es', 'en']) {
      const texts = OCC_AIR_PICTURE_REASONS.map(reason => createTranslator(mapMessages, language)(`source.reason.${reason}`));
      expect(texts.join(' '), language).not.toMatch(/_|adsb|provider_error|rate_limited/i);
    }
  });
});
