import { OCC_AIR_PICTURE_REASONS } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../i18n/languageStore';
import { OCC_SHORTCUTS } from '../occ-ui/occShortcuts';
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

  it('the base-map notice names nothing that a map may not draw', () => {
    // Every map shows it: Monitoreo draws no stand, and the region and approach views draw none either.
    for (const language of ['es', 'en']) {
      const notice = createTranslator(mapMessages, language)('basemap.degraded');
      expect(notice, language).not.toMatch(/posici|stand|aer[oó]dromo|airfield|vuelo|flight|avi[oó]n|aircraft/i);
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
    // The tag: GND on the ground and the age of a stale position.
    expect([es('traffic.ground'), es('traffic.ageSeconds', { count: 45 }), es('traffic.ageMinutes', { count: 4 })])
      .toEqual(['GND', '· 45 s', '· 4 min']);
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
      es('dataBlock.stale', { age: es('dataBlock.seconds', { count: 45 }) }), es('dataBlock.noPosition'), es('dataBlock.demo'),
      es('dataBlock.notImported'), es('dataBlock.cancelledDemo')]).toEqual(['Vuelo ZZ161', 'En vivo · hace 4 s',
      'Sin señal desde hace 45 s', 'Sin posición todavía', 'Vuelo demo', 'Sin importar', 'Cancelado por el proveedor (demo)']);
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
