import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { TAGS } from '../../occ-ui/statusVocabulary';
import { STATUS_MESSAGES, formatTimeScale, kinematicsMessages } from './kinematicsMessages.js';

// Every leaf of a message tree as `a.b.c`.
function leafPaths(tree, prefix = '') {
  return Object.entries(tree).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`]));
}

describe('kinematics messages', () => {
  it('Spanish and English carry the same keys', () => {
    expect(Object.keys(kinematicsMessages)).toEqual(['es', 'en']);
    const spanish = leafPaths(kinematicsMessages.es);
    expect(leafPaths(kinematicsMessages.en)).toEqual(spanish);
    for (const language of ['es', 'en']) {
      const t = createTranslator(kinematicsMessages, language);
      for (const path of spanish) {
        const text = t(path);
        expect(typeof text, `${language} ${path}`).toBe('string');
        expect(text.trim(), `${language} ${path}`).not.toBe('');
        expect(text, `${language} ${path}`).toBe(text.trim());
      }
    }
    const es = createTranslator(kinematicsMessages, 'es');
    expect(es('demo.awaitingStandNotImported')).toBe('Esperando posición · sin importar');
    expect(es('demo.awaitingStand')).toBe('Esperando posición');
    expect(es('demo.cancelled')).toBe('Cancelado por el proveedor (demo)');
    // Every status a trajectory sample can carry has its words in both languages.
    expect(Object.keys(STATUS_MESSAGES).sort()).toEqual(['awaitingStand', 'awaitingStandNotImported', 'cancelledByProvider']);
    for (const path of Object.values(STATUS_MESSAGES)) expect(spanish).toContain(path);
    // The tags keep their one source: no message repeats «Demo» or «est.» on its own.
    const texts = ['es', 'en'].flatMap(language => leafPaths(kinematicsMessages[language])
      .map(path => createTranslator(kinematicsMessages, language)(path)));
    for (const tag of [TAGS.demo.es, TAGS.demo.en, TAGS.estimated.es, TAGS.estimated.en]) expect(texts).not.toContain(tag);
  });

  it('formats the time scale with a decimal comma in Spanish', () => {
    expect(formatTimeScale(1.9, 'es')).toBe('×1,9');
    expect(formatTimeScale(1.9, 'en')).toBe('×1.9');
    expect(formatTimeScale(1.94, 'es')).toBe('×1,9');
    expect(formatTimeScale(4.18, 'es')).toBe('×4,2');
    expect(formatTimeScale(2, 'es')).toBe('×2,0');
    // Spanish by default; a speed-up never reads ×1,0.
    expect(formatTimeScale(1.39)).toBe('×1,4');
    expect(formatTimeScale(1.012, 'es')).toBe('×1,1');
    expect(formatTimeScale(1.012, 'en')).toBe('×1.1');
    for (const value of [0, -1, Number.NaN, Infinity, null, '1.9']) expect(formatTimeScale(value, 'es'), String(value)).toBe('');
    // The label the data block shows.
    const es = createTranslator(kinematicsMessages, 'es');
    const en = createTranslator(kinematicsMessages, 'en');
    expect(es('demo.accelerated', { factor: formatTimeScale(1.9, 'es') })).toBe('Demo acelerada ×1,9');
    expect(en('demo.accelerated', { factor: formatTimeScale(1.9, 'en') })).toBe('Accelerated demo ×1.9');
  });
});
