import { STAND_REFERENCE } from '../stands/standReference';

// The fixed scenes of the map lab (app/map-lab, development only): synthetic data over the internal reference
// catalogue of Punta Cana, the same on every run, so the visual suite (tests/visual) drives and photographs each one
// without a session, the API or the network; the layout review shows the generated MDPC dataset itself. Pure data.
// Later PRs add their scenes here (stand polygons, traffic, the demo flight, 3D).
//
// A scene is `{ id, kind, title, description, view, stands, selection, basemap, webgl }`:
// - `kind`: `map`, the OCC map with the scene's stands (MapLab.jsx), or `layout-qa`, the review screen of the MDPC
//   airport layout (LayoutQaScene.jsx), which draws the layout itself and has no stands of its own;
// - `view`: the view the map opens on when the URL names none (region · approach · airfield · ramp);
// - `stands`: the stands of the screen, as a positions screen gives them to the map
//   (`{ id, terminal, latitude, longitude, status, locationSource }`);
// - `selection`: `{ kind, id }`, written to the URL when the scene opens and the URL selects nothing, or `null`;
// - `basemap`: `on` (the vector tiles of OpenFreeMap), `none` (the style without them, as `?basemap=none`) or `cut`
//   (the style with them, but the lab makes every base-map request fail, so the map shows its degraded notice);
// - `webgl`: `false` makes the browser refuse WebGL while the scene is open, so the map shows its fallback list.

export const BASEMAP_MODES = Object.freeze(['on', 'none', 'cut']);
export const SCENE_KINDS = Object.freeze(['map', 'layout-qa']);

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

// Each terminal cycles through states of its own by the stand's place inside the terminal: the scene shows the seven
// states, and each terminal view shows a part of the legend of its own (Terminal A five states, B four, FBO two).
const TERMINAL_STATES = Object.freeze({
  A: Object.freeze(['occupied', 'available', 'planned', 'arriving', 'occupied', 'releasing', 'available', 'planned']),
  B: Object.freeze(['available', 'occupied', 'disabled', 'planned', 'available', 'occupied']),
  FBO: Object.freeze(['available', 'unverified', 'available']),
});

/**
 * The stands of the lab: the 41 reference stands in catalogue order, each with the state its terminal's pattern gives
 * its place inside the terminal, all at their reference location (not placed by OCC, so the legend says «No oficial»).
 */
export function labStands() {
  const places = new Map();
  return STAND_REFERENCE.map(stand => {
    const place = places.get(stand.terminal) ?? 0;
    places.set(stand.terminal, place + 1);
    const pattern = TERMINAL_STATES[stand.terminal] ?? ['available'];
    return {
      id: stand.code,
      terminal: stand.terminal,
      latitude: stand.latitude,
      longitude: stand.longitude,
      status: pattern[place % pattern.length],
      locationSource: 'reference',
    };
  });
}

const STANDS = deepFreeze(labStands());
const NO_STANDS = Object.freeze([]);

function scene(id, { kind = 'map', title, description, view, selection = null, basemap = 'on', webgl = true }) {
  return { id, kind, title, description, view, stands: kind === 'map' ? STANDS : NO_STANDS, selection, basemap, webgl };
}

export const SCENES = deepFreeze([
  scene('ramp-points', {
    title: 'Rampa: posiciones y estados',
    description: 'Las 41 posiciones de referencia como puntos sobre el plano propio del aeródromo, con los siete estados mezclados.',
    view: 'ramp',
  }),
  scene('ramp-selected', {
    title: 'Rampa: posición elegida',
    description: 'La A5 elegida, con su borde cian.',
    view: 'ramp',
    selection: { kind: 'stand', id: 'A5' },
  }),
  scene('airfield', {
    title: 'Aeródromo',
    description: 'El aeropuerto entero dibujado con su plano propio: pistas con sus marcas, calles de rodaje, plataformas, '
      + 'terminales y puntos de espera, con las posiciones agrupadas y el punto de referencia de PUJ.',
    view: 'airfield',
  }),
  scene('approach', {
    title: 'Aproximación',
    description: 'Hasta 40 NM alrededor de PUJ: el punto de referencia del aeropuerto, sin posiciones.',
    view: 'approach',
  }),
  scene('region', {
    title: 'Región',
    description: 'Hasta 250 NM alrededor de PUJ: el punto de referencia del aeropuerto, sin posiciones.',
    view: 'region',
  }),
  scene('unavailable-fallback', {
    title: 'Sin WebGL: lista de respaldo',
    description: 'El navegador no puede dibujar el mapa y las posiciones se muestran en una lista.',
    view: 'ramp',
    webgl: false,
  }),
  scene('basemap-degraded', {
    title: 'Mapa base caído',
    description: 'El mapa base no carga: se ve el aviso y las posiciones siguen en el mapa.',
    view: 'ramp',
    basemap: 'cut',
  }),
  scene('layout-qa', {
    kind: 'layout-qa',
    title: 'Revisión del plano de MDPC',
    description: 'El plano generado tal como sale de OpenStreetMap y los puntos de ELEVANT: cada posición con su código, '
      + 'su rumbo y sus marcas, las puertas de OSM, el grafo de rodaje y una sonda de rutas entre dos nodos.',
    view: 'airfield',
  }),
]);

/** The scene with that id, or `null`. */
export function findScene(id) {
  return SCENES.find(item => item.id === id) ?? null;
}

// An instant written in ISO 8601 with its offset, as `?t=` takes it (`2026-11-13T15:00:00Z`).
const ISO_INSTANT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** The milliseconds of an ISO 8601 instant with its offset, or `null` for anything else. */
export function labInstant(text) {
  if (typeof text !== 'string' || !ISO_INSTANT.test(text)) return null;
  const time = Date.parse(text);
  return Number.isFinite(time) ? time : null;
}

/**
 * What the URL of the lab asks for: `{ sceneId, scene, basemap, frozenAt }`. `?scene=` names the scene (`scene` is
 * `null` when it names none or an unknown one), `?basemap=none` draws any scene without the vector tiles, and `?t=`
 * freezes the clock of the map at that instant (`frozenAt` in milliseconds, `null` when absent or not ISO 8601).
 */
export function readLabQuery(params) {
  const query = new URLSearchParams(params instanceof URLSearchParams ? params : params?.toString?.() ?? '');
  const sceneId = query.get('scene');
  const found = sceneId === null ? null : findScene(sceneId);
  return {
    sceneId,
    scene: found,
    basemap: query.get('basemap') === 'none' ? 'none' : found?.basemap ?? 'on',
    frozenAt: labInstant(query.get('t')),
  };
}
