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
});
