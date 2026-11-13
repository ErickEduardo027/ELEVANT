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
});
