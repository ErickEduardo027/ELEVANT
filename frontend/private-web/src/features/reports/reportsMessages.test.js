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
    expect([es.report, es.from, es.to, es.asOf, es.generate, es.previous, es.next, es.retry]).toEqual(['Reporte', 'Desde',
      'Hasta', 'Fecha de corte', 'Generar', 'Anterior', 'Siguiente', 'Reintentar']);
    expect([es.downloadPdf, es.downloadExcel]).toEqual(['Descargar PDF', 'Descargar Excel']);
    expect(Object.values(es.presets)).toEqual(['Hoy', 'Últimos 7 días', 'Este mes', 'Mes anterior', 'Personalizado']);
    // The list of reports loads in its own words: nothing is generated yet.
    expect([es.loadingCatalog, reportsMessages.en.loadingCatalog]).toEqual(['Cargando reportes…', 'Loading reports…']);
    expect(es.loadingCatalog).not.toBe(es.loading);
    expect(es.pdfTooLarge).toBe('El PDF admite hasta 5 000 filas: descarga el Excel o acota el período y los filtros.');
    expect(fill(es.exportFailed, { message: 'sin conexión' })).toBe('No se pudo descargar: sin conexión');
    expect(fill(es.generatedBy, { date: '26/10/2026 08:00', by: 'Ana Pérez' })).toBe('Generado el 26/10/2026 08:00 por Ana Pérez');
    expect(fill(es.counts.page, { page: 2, count: 25 })).toBe('Página 2, 25 filas');
    expect(fill(es.counts.pageOne, { page: 1 })).toBe('Página 1, 1 fila');
    for (const language of ['es', 'en']) {
      expect(reportsMessages[language]).not.toHaveProperty('subtitle');
      // No CSV in the interface (ADR-0048): the API keeps it, the screen offers PDF and Excel.
      expect(JSON.stringify(reportsMessages[language])).not.toMatch(/CSV/);
      // A meta line of the panel lists its facts apart: no middle dot joins them (design H.1).
      expect(Object.values(reportsMessages[language].counts).join(' ')).not.toMatch(/·/);
    }
  });
});
