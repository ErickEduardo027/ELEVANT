import { describe, expect, it } from 'vitest';
import { flightMonitoringMessages } from './flightMonitoringMessages';

// Every path to a text of a message tree, `a.b.c`.
const paths = (node, prefix = '') => Object.entries(node).flatMap(([key, value]) => (typeof value === 'string'
  ? [`${prefix}${key}`] : paths(value, `${prefix}${key}.`)));
const texts = node => Object.values(node).flatMap(value => (typeof value === 'string' ? [value] : texts(value)));

describe('flightMonitoringMessages', () => {
  it('carries the same keys in Spanish and English, each with a text', () => {
    expect(paths(flightMonitoringMessages.en).sort()).toEqual(paths(flightMonitoringMessages.es).sort());
    for (const language of ['es', 'en']) {
      for (const text of texts(flightMonitoringMessages[language])) expect(text.trim().length, language).toBeGreaterThan(0);
    }
  });

  it('names the source of the flights, never a provider, and writes «Sin posición» for a missing stand', () => {
    expect(JSON.stringify(flightMonitoringMessages)).not.toMatch(/FlyAware|FlightAware/i);
    expect(flightMonitoringMessages.es.status.stale).toMatch(/^Sin conexión con la fuente de vuelos/);
    expect(flightMonitoringMessages.en.status.stale).toMatch(/^No connection to the flight source/);
    expect(flightMonitoringMessages.es.alerts.disconnected).toMatch(/fuente de vuelos/);
    expect(flightMonitoringMessages.es.inspector.noStand).toBe('Sin posición');
    // The Spanish texts say «posición», never «stand».
    expect(texts(flightMonitoringMessages.es).filter(text => /\bstand\b/i.test(text))).toEqual([]);
  });

  it('keeps the words the map adapter reads (FlightMap.jsx, the maps lane\'s)', () => {
    expect(flightMonitoringMessages.es.map).toEqual({
      resetView: 'Restablecer vista',
      centerPuj: 'Centrar PUJ',
      unavailableTitle: 'El mapa no está disponible en este navegador',
      unavailableDescription: 'La lista de vuelos sigue funcionando. Para ver el mapa, usa un navegador con la aceleración gráfica activada.',
    });
  });
});
