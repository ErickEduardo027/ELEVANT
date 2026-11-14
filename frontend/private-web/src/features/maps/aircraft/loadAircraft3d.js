// Loads the 3D chunk (aircraft/aircraft3dChunk.js: three and the aircraft modules that use it) once per page, the first
// time a map asks for it (design G1). A plain import(), as the installed Next guide «Lazy loading» does for an external
// library: the chunk holds modules, not a component, so next/dynamic has no part here. Only a browser loads it: on the
// server the call rejects before the import.
//
// A failed load rejects, warns once per page (in English, on the console only: the map keeps its 2D picture and says
// nothing) and forgets the attempt, so the next call tries again.

let pending = null;
let warned = false;

const importAircraft3dChunk = () => (typeof window === 'undefined'
  ? Promise.reject(new Error('The 3D aircraft load in the browser only.'))
  : import('./aircraft3dChunk'));

/**
 * The 3D aircraft modules, loaded once: `Promise<{ three, buildAircraftGeometry, createAircraft3dLayer? }>`, `three`
 * being the parts of three the modules take as their parameter (THREE_PARTS). `importChunk` and `warn` are for tests.
 */
export function loadAircraft3d({ importChunk = importAircraft3dChunk, warn = console.warn } = {}) {
  if (pending === null) {
    pending = importChunk().then(chunk => Object.freeze({
      three: chunk.THREE_PARTS,
      buildAircraftGeometry: chunk.buildAircraftGeometry,
      ...(typeof chunk.createAircraft3dLayer === 'function' ? { createAircraft3dLayer: chunk.createAircraft3dLayer } : {}),
    }), error => {
      pending = null;
      if (!warned) {
        warned = true;
        warn('The 3D aircraft could not be loaded; the map keeps its 2D aircraft.', error);
      }
      throw error;
    });
  }
  return pending;
}

/** Forgets the loaded chunk and the warning, as a new page would. Tests only. */
export function resetAircraft3dLoaderForTests() {
  pending = null;
  warned = false;
}
