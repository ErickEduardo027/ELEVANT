import { describe, expect, it } from 'vitest';
import { coverageMessages } from './coverageMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

describe('coverageMessages', () => {
  it('es and en carry the same keys and placeholders, and keep the Spanish the cycle E2E reads', () => {
    const paths = leafPaths(coverageMessages.es);
    expect(leafPaths(coverageMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(coverageMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      // A placeholder keeps its English name in both languages, so one call fills either.
      expect(placeholdersOf(textAt(coverageMessages.en, path)), path).toEqual(placeholdersOf(textAt(coverageMessages.es, path)));
    }

    // What fase3-operacion.spec.ts and the presentation guide (occConsole.ts, coverStand) read, word for word.
    const es = coverageMessages.es;
    expect(es.states.loading).toBe('Cargando la cobertura de posiciones…');
    expect(es.nav.label).toBe('Terminal y vista');
    expect(es.terminal.replace('{code}', 'A')).toBe('Terminal A');
    expect([es.form.label, es.form.submit, es.form.agent]).toEqual(['Asignar posiciones', 'Asignar posiciones', 'Agente']);
    expect([es.coverages.title, es.coverages.release]).toEqual(['Coberturas del día', 'Liberar']);
    // The region names the unit tests find, and the attribute words of the board.
    expect([es.board.title, es.configuration.attributes.title, es.configuration.rules.title, es.configuration.combined.title])
      .toEqual(['Posiciones de la terminal', 'Atributos de las posiciones', 'Reglas de la terminal', 'Posiciones combinadas']);
    expect([es.board.bridge, es.board.narrowbody, es.board.noAgent, es.board.inactive])
      .toEqual(['Puente', 'Estrecho', 'Sin agente', 'Desactivada']);
    // No header of the board, and no word of its legend, is called «Puente»: the attribute's word stays the only one.
    expect([...Object.values(es.board.columns), ...Object.values(es.board.legend)]).not.toContain(es.board.bridge);
    // The legends in the headers (contratos 2.4): their names, and the word of an attribute's mark. «Desactivada» and
    // «Refuerzo» are the pills' own words.
    expect([es.board.legend.label, es.board.legend.attribute, es.coverages.legend.label])
      .toEqual(['Atributos y estado', 'Atributo', 'Tipo de cobertura']);
    // The station's states, as the screen said them before U6.
    expect(es.states.forbidden).toBe('Tu acceso no permite ver la cobertura de posiciones de esta estación.');
    expect(es.states.noTerminals).toBe('La estación no tiene terminales activas. OCC las crea en «Datos maestros».');
  });

  it('names the constraint kinds and aircraft sizes of the board, and has no eyebrow or subtitle', () => {
    for (const language of ['es', 'en']) {
      const messages = coverageMessages[language];
      // The values of OccCoverageBoardResponse: `constraints[].kind` and `stands[].maxAircraftSize`.
      expect(Object.keys(messages.kinds), language).toEqual(['Cancels', 'NarrowbodyOnly']);
      expect(Object.keys(messages.configuration.combined.effects), language).toEqual(['Cancels', 'NarrowbodyOnly']);
      expect(Object.keys(messages.sizes), language).toEqual(['Narrowbody', 'Widebody']);
      expect(messages).not.toHaveProperty('eyebrow');
      expect(messages).not.toHaveProperty('subtitle');
    }
    expect(coverageMessages.es.kinds).toEqual({ Cancels: 'anula', NarrowbodyOnly: 'limita a estrecho' });
    expect(coverageMessages.es.sizes).toEqual({ Narrowbody: 'Solo estrecho', Widebody: 'Hasta ancho' });
    // The link sentence holds its link once, where the screen puts «Datos maestros».
    for (const language of ['es', 'en']) {
      expect(coverageMessages[language].configuration.attributes.masterData.split('{link}'), language).toHaveLength(2);
    }
  });
});
