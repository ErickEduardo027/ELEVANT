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
