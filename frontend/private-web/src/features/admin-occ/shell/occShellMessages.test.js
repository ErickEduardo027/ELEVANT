import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { occUiMessages } from '../../occ-ui/occUiMessages';
import { ADMIN_OCC_NAVIGATION, OCC_NAV_SECTIONS } from '../navigation';
import { occNavLabel } from './occNavLabel';
import { occShellMessages } from './occShellMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);

describe('OCC shell messages', () => {
  it('es and en carry the same keys', () => {
    expect(leafPaths(occShellMessages.en)).toEqual(leafPaths(occShellMessages.es));
    for (const language of ['es', 'en']) {
      for (const path of leafPaths(occShellMessages[language])) {
        const text = textAt(occShellMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
    }
  });

  it('the occ-ui messages carry the same keys in es and en', () => {
    expect(leafPaths(occUiMessages.en)).toEqual(leafPaths(occUiMessages.es));
    expect(leafPaths(occUiMessages.es).length).toBeGreaterThan(0);
  });

  it('every OCC module and section has a label in both languages', () => {
    expect(ADMIN_OCC_NAVIGATION).toHaveLength(14);
    for (const language of ['es', 'en']) {
      for (const item of ADMIN_OCC_NAVIGATION) {
        expect(occShellMessages[language].nav[item.id], `${language}: nav.${item.id}`).toEqual(expect.any(String));
      }
      for (const section of OCC_NAV_SECTIONS) {
        expect(occShellMessages[language].sections[section.id], `${language}: sections.${section.id}`)
          .toEqual(expect.any(String));
      }
    }
    // The two that were missing.
    expect(occShellMessages.es.nav['master-data']).toBe('Datos maestros');
    expect(occShellMessages.en.nav['master-data']).toBe('Master data');
    expect(occShellMessages.es.nav.devices).toBe('Tablets');
    expect(occShellMessages.en.nav.devices).toBe('Tablets');
  });

  it('occNavLabel names a module in each language and falls back to its label, never to a key', () => {
    const spanish = createTranslator(occShellMessages, 'es');
    const english = createTranslator(occShellMessages, 'en');
    for (const item of ADMIN_OCC_NAVIGATION) {
      expect(occNavLabel(spanish, item), item.id).toBe(occShellMessages.es.nav[item.id]);
      expect(occNavLabel(english, item), item.id).toBe(occShellMessages.en.nav[item.id]);
    }
    // A module the messages do not know keeps its own name.
    expect(occNavLabel(spanish, { id: 'module-from-tomorrow', label: 'Módulo nuevo' })).toBe('Módulo nuevo');
    expect(occNavLabel(english, { id: 'module-from-tomorrow', label: 'Módulo nuevo' })).toBe('Módulo nuevo');
  });
});
