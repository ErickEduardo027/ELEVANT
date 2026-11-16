// The health of the data sources the OCC frame names in its status bar (design C.4). The hooks that read a source
// report into one store held by the shell; the status bar reads the store and its pure summary.

/** The sources the OCC knows, with their names. Only `elevant` and `realtime` report today. */
export const OCC_SOURCES = Object.freeze({
  elevant: Object.freeze({ es: 'Operación ELEVANT', en: 'ELEVANT operations' }),
  realtime: Object.freeze({ es: 'Tiempo real', en: 'Real time' }),
  // Reserved, in the order the status bar lists them: the provider feed reports from U3, air traffic and the base map
  // from M5, the weather and the satellite image from M8.
  providerFlights: Object.freeze({ es: 'Vuelos del proveedor', en: 'Provider flights' }),
  airTraffic: Object.freeze({ es: 'Tráfico aéreo', en: 'Air traffic' }),
  weather: Object.freeze({ es: 'Clima MDPC', en: 'MDPC weather' }),
  satellite: Object.freeze({ es: 'Satélite', en: 'Satellite' }),
  basemap: Object.freeze({ es: 'Mapa base', en: 'Base map' }),
});

/**
 * `ok` current; `delayed` older than it should be, or a refresh failed; `offline` unreachable; `forbidden` the account
 * may not read it; `unconfigured` the environment does not provide it; `idle` not read on this screen.
 */
export const SOURCE_STATES = Object.freeze(['ok', 'delayed', 'offline', 'forbidden', 'unconfigured', 'idle']);

const CATALOG_ORDER = Object.keys(OCC_SOURCES);

function toInstant(at) {
  if (at == null) return null;
  const value = typeof at === 'number' ? at : Date.parse(at);
  return Number.isFinite(value) ? value : null;
}

function sameReport(left, right) {
  return left.state === right.state && left.at === right.at && left.detail === right.detail
    && left.tags.length === right.tags.length && left.tags.every((tag, index) => tag === right.tags[index]);
}

/**
 * One store per OCC tab. `report(id, { state, at, detail, tags })` adds or replaces a source (`at` is the instant of
 * its last good data, in ms or ISO, kept in ms); a report equal to the current one notifies nobody. `getSnapshot()`
 * keeps its identity until something changes, as useSyncExternalStore needs.
 */
export function createSourceHealthStore() {
  const entries = new Map();
  const listeners = new Set();
  let snapshot = Object.freeze([]);

  function publish() {
    snapshot = Object.freeze([...entries.values()]
      .sort((left, right) => CATALOG_ORDER.indexOf(left.id) - CATALOG_ORDER.indexOf(right.id)));
    listeners.forEach(listener => listener());
  }

  return {
    report(id, { state, at = null, detail = null, tags = [] } = {}) {
      if (!Object.hasOwn(OCC_SOURCES, id)) throw new TypeError(`Unknown OCC source: ${id}`);
      if (!SOURCE_STATES.includes(state)) throw new TypeError(`Unknown source state: ${state}`);
      const next = Object.freeze({ id, state, at: toInstant(at), detail, tags: Object.freeze([...tags]) });
      const previous = entries.get(id);
      if (previous && sameReport(previous, next)) return;
      entries.set(id, next);
      publish();
    },
    remove(id) {
      if (entries.delete(id)) publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot() {
      return snapshot;
    },
  };
}

/**
 * «Fuentes al día», «{n} fuentes con retraso» or «Sin conexión con ELEVANT». Only a source that should be current and
 * is not counts: one the account may not read, the environment lacks or this screen does not read never does.
 */
export function summarizeSources(items = []) {
  const delayedCount = items.filter(item => item.id !== 'elevant'
    && (item.state === 'delayed' || item.state === 'offline')).length;
  if (items.some(item => item.id === 'elevant' && item.state === 'offline')) return { kind: 'disconnected', delayedCount };
  return { kind: delayedCount > 0 ? 'delayed' : 'ok', delayedCount };
}
