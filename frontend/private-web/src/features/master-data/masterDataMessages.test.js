import { describe, expect, it } from 'vitest';
import { AIRCRAFT_SIZES } from '../../services/occMasterDataService';
import { masterDataMessages } from './masterDataMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => values[name]);

describe('masterDataMessages', () => {
  it('es and en carry the same keys and the Spanish the cycle E2E reads', () => {
    const paths = leafPaths(masterDataMessages.es);
    expect(leafPaths(masterDataMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(masterDataMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      // A placeholder keeps its English name in both languages, so one call fills either.
      expect(placeholdersOf(textAt(masterDataMessages.en, path)), path).toEqual(placeholdersOf(textAt(masterDataMessages.es, path)));
    }

    // What fase2-preoperacion.spec.ts reads in «Datos maestros», word for word.
    const es = masterDataMessages.es;
    expect(es.states.loading).toBe('Cargando los datos maestros…');
    expect([es.terminals.form.label, es.terminals.form.code, es.terminals.form.name, es.terminals.form.submit])
      .toEqual(['Nueva terminal', 'Código', 'Nombre', 'Crear terminal']);
    expect([es.stands.form.label, es.stands.form.terminal, es.stands.form.code, es.stands.form.submit])
      .toEqual(['Nueva posición', 'Terminal', 'Código', 'Crear posición']);
    expect([es.aircraftTypes.form.label, es.aircraftTypes.form.icao, es.aircraftTypes.form.manufacturer,
      es.aircraftTypes.form.model, es.aircraftTypes.form.submit])
      .toEqual(['Nuevo tipo de avión', 'OACI', 'Fabricante', 'Modelo', 'Crear tipo de avión']);
    // The E2E finds the size field by /^Tamaño/ and the terminal field by /^Terminal/.
    expect(es.aircraftTypes.form.size).toMatch(/^Tamaño/);
    expect(es.stands.form.size).toMatch(/^Tamaño/);
    expect(fill(es.terminals.created, { code: 'E2E-ABCD' })).toBe('Terminal E2E-ABCD creada.');
    expect(fill(es.stands.created, { code: 'E2E-ABCD-1' })).toBe('Posición E2E-ABCD-1 creada.');
    expect(fill(es.aircraftTypes.created, { code: 'ZABC' })).toBe('Tipo de avión ZABC creado.');

    // The region names, the row names and the flags the unit tests find, as the screen said them before U6.
    expect([es.terminals.title, es.stands.title, es.aircraftTypes.title]).toEqual(['Terminales', 'Posiciones', 'Tipos de avión']);
    expect(fill(es.terminals.code, { code: 'A' })).toBe('Código de la terminal A');
    expect(fill(es.terminals.name, { code: 'C' })).toBe('Nombre de la terminal C');
    expect(fill(es.stands.code, { code: 'A01' })).toBe('Código de la posición A01');
    expect(fill(es.aircraftTypes.iata, { code: 'A320' })).toBe('Código IATA de A320');
    expect([es.terminals.active, es.stands.active, es.stands.bridge, es.stands.remote, es.aircraftTypes.active, es.common.save])
      .toEqual(['Activa', 'Activa', 'Puente', 'Remota', 'Activo', 'Guardar']);
    expect(es.states.noStation).toBe('Tu cuenta no tiene una estación OCC autorizada.');
    expect(es.states.forbidden).toBe('Tu acceso no permite ver los datos maestros de esta estación.');
    expect(es.states.readOnly).toBe('Tu acceso permite consultar los datos maestros, no modificarlos.');
    // The map link of each stand (contratos 2.1).
    expect([es.stands.viewOnMap, fill(es.stands.viewOnMapLabel, { code: 'A1' })]).toEqual(['Ver en el mapa', 'Ver A1 en el mapa']);
  });

  it('names the sizes by the keys of AIRCRAFT_SIZES and has no eyebrow or subtitle', () => {
    for (const language of ['es', 'en']) {
      expect(Object.keys(masterDataMessages[language].sizes), language).toEqual(Object.keys(AIRCRAFT_SIZES));
      expect(masterDataMessages[language]).not.toHaveProperty('eyebrow');
      expect(masterDataMessages[language]).not.toHaveProperty('subtitle');
    }
    // The Spanish words are the service's own.
    expect(masterDataMessages.es.sizes).toEqual(AIRCRAFT_SIZES);
  });
});
