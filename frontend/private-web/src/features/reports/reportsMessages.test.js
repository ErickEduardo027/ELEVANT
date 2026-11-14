import { describe, expect, it } from 'vitest';
import { reportsMessages } from './reportsMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => values[name]);

describe('reportsMessages', () => {
  it('es and en carry the same keys, the same placeholders and no empty text', () => {
    const paths = leafPaths(reportsMessages.es);
    expect(leafPaths(reportsMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(reportsMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      expect(placeholdersOf(textAt(reportsMessages.en, path)), path).toEqual(placeholdersOf(textAt(reportsMessages.es, path)));
    }
  });

  it('keeps the Spanish the tests read, says one row in the singular and has no subtitle', () => {
    const es = reportsMessages.es;
    expect([es.report, es.from, es.to, es.generate, es.previous, es.next, es.retry]).toEqual(['Reporte', 'Desde', 'Hasta',
      'Generar', 'Anterior', 'Siguiente', 'Reintentar']);
    expect(['Excel', 'PDF', 'CSV'].map(format => fill(es.exportAs, { format })))
      .toEqual(['Exportar Excel', 'Exportar PDF', 'Exportar CSV']);
    expect(es.exporting).toBe('Exportando…');
    expect(es.pdfTooLarge).toBe('El PDF admite hasta 5 000 filas: exporte a Excel o CSV, o acote el período.');
    expect(fill(es.exportFailed, { message: 'sin conexión' })).toBe('No se pudo exportar: sin conexión');
    expect(fill(es.generatedAt, { date: '26/10/2026, 08:00' })).toBe('Generado 26/10/2026, 08:00');
    expect(fill(es.rows, { page: 2, count: 25 })).toBe('Página 2, 25 filas');
    expect(fill(es.rowsOne, { page: 1 })).toBe('Página 1, 1 fila');
    for (const language of ['es', 'en']) {
      expect(reportsMessages[language]).not.toHaveProperty('subtitle');
      // A meta line of the panel lists its facts apart: no middle dot joins them (design H.1).
      expect(reportsMessages[language].rows).not.toMatch(/·/);
    }
  });
});
