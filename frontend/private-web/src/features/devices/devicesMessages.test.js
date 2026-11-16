import { describe, expect, it } from 'vitest';
import { DEVICE_STATUSES } from '../../services/occDevicesService';
import { devicesMessages } from './devicesMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();
const fill = (text, values) => text.replace(/\{(\w+)\}/g, (_, name) => values[name]);

describe('devicesMessages', () => {
  it('es and en carry the same keys and the same placeholders', () => {
    const paths = leafPaths(devicesMessages.es);
    expect(leafPaths(devicesMessages.en)).toEqual(paths);
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(devicesMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      // A placeholder keeps its English name in both languages, so one call fills either.
      expect(placeholdersOf(textAt(devicesMessages.en, path)), path).toEqual(placeholdersOf(textAt(devicesMessages.es, path)));
    }
    // A command's words are templates of the tablet's name and, to revoke it, of its last agent's.
    for (const language of ['es', 'en']) {
      const { unbind, revoke } = devicesMessages[language].commands;
      for (const text of [unbind.title, unbind.done, revoke.title, revoke.done]) expect(placeholdersOf(text), text).toEqual(['tablet']);
      for (const text of [revoke.descriptionBound, revoke.descriptionFree]) expect(placeholdersOf(text), text).toEqual(['agent']);
      expect(placeholdersOf(unbind.description)).toEqual([]);
    }
  });

  it('keeps the Spanish the cycle E2E and the unit tests read, and the service’s status words', () => {
    const es = devicesMessages.es;
    // fase2-preoperacion.spec.ts: the heading «Tablets» and the loading line.
    expect([es.title, es.states.loading]).toEqual(['Tablets', 'Cargando las tablets…']);
    expect(es.list.title).toBe('Tablets de la estación');
    expect([es.unbind, es.revoke, es.cancel, es.saving]).toEqual(['Liberar', 'Revocar', 'Cancelar', 'Guardando…']);
    expect([es.commands.unbind.reasonLabel, es.commands.unbind.submit]).toEqual(['Motivo (opcional)', 'Liberar tablet']);
    expect([es.commands.revoke.reasonLabel, es.commands.revoke.submit]).toEqual(['Motivo', 'Revocar tablet']);
    expect(fill(es.commands.unbind.done, { tablet: 'Tablet T-07' })).toBe('Tablet T-07 quedó libre para el próximo agente.');
    expect(fill(es.commands.revoke.done, { tablet: 'Tablet T-08' }))
      .toBe('Tablet T-08 quedó revocada; ya no queda ninguna sesión abierta en ella.');
    // Revoking only promises the sessions it ends (2-N02).
    expect(fill(es.commands.revoke.descriptionBound, { agent: 'Riley Ramp' })).toMatch(/se cierran todas las sesiones de Riley Ramp\./);
    expect(fill(es.commands.revoke.descriptionFree, { agent: 'Riley Ramp' }))
      .toMatch(/Si Riley Ramp no cerró sesión en ella, se cierran todas sus sesiones\./);
    expect([es.list.emptyTitle, es.states.forbidden, es.states.readOnly]).toEqual(['Sin tablets registradas',
      'Tu acceso no permite ver las tablets de esta estación.',
      'Tu acceso permite consultar las tablets, no liberarlas ni revocarlas.']);
    expect(es.inProgress).toMatch(/^Operación en curso/);
    // The words of who holds a tablet are the service's own (services/occDevicesService.js).
    for (const language of ['es', 'en']) expect(Object.keys(devicesMessages[language].status), language).toEqual(Object.keys(DEVICE_STATUSES));
    for (const [status, { label }] of Object.entries(DEVICE_STATUSES)) expect(es.status[status], status).toBe(label);
    expect(devicesMessages.es).not.toHaveProperty('subtitle');
  });
});
