import { describe, expect, it } from 'vitest';
import { readyContractsMessages } from './readyContractsMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => values[name]);

describe('readyContractsMessages', () => {
  it('es and en carry the same keys, the same placeholders and no empty text', () => {
    const paths = leafPaths(readyContractsMessages.es);
    expect(leafPaths(readyContractsMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(readyContractsMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      expect(placeholdersOf(textAt(readyContractsMessages.en, path)), path)
        .toEqual(placeholdersOf(textAt(readyContractsMessages.es, path)));
    }
  });

  it('keeps the Spanish the cycle E2E, the guide and the tests read, with no subtitle and no arrow', () => {
    const es = readyContractsMessages.es;
    // fase2-preoperacion.spec.ts and the guide find the list by this name.
    expect(es.title).toBe('Contratos listos para operar');
    expect([es.date, es.plan, es.retry, es.countOne]).toEqual(['Fecha de operación', 'Planificar vuelos', 'Reintentar',
      '1 contrato listo']);
    expect(fill(es.version, { number: 2 })).toBe('Versión 2');
    expect(fill(es.validFromOpen, { from: '1 ene 2026' })).toBe('Desde 1 ene 2026, sin fecha fin');
    expect(fill(es.validFromTo, { from: '1 feb 2026', to: '31 dic 2026' })).toBe('1 feb 2026 a 31 dic 2026');
    expect(fill(es.servicesToggle, { count: 3 })).toBe('Servicios contratados (3)');
    expect(es.flightsOne).toBe('1 vuelo planificado ese día');
    expect(es.emptyTitle).toMatch(/^No hay contratos listos para esta fecha/);
    for (const language of ['es', 'en']) {
      expect(readyContractsMessages[language]).not.toHaveProperty('subtitle');
      expect(readyContractsMessages[language].validFromTo).not.toMatch(/→/);
      expect(Object.keys(readyContractsMessages[language].renewalModes)).toEqual(['Automatic', 'Manual']);
    }
  });
});
