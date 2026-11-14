import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { STAND_REFERENCE } from '../stands/standReference';
import { SCENARIO_AGENTS, boardStand, boardVisit } from '../testing/mapFixtures';

// The fixed scenes of the map lab (app/map-lab, development only): synthetic data over the internal reference
// catalogue of Punta Cana, the same on every run, so the visual suite (tests/visual) drives and photographs each one
// without a session, the API or the network; the layout review shows the generated MDPC dataset itself. Pure data.
// Later PRs add their scenes here (traffic, the demo flight, 3D).
//
// A scene is `{ id, kind, title, description, view, stands, at, selection, basemap, webgl }`:
// - `kind`: `map`, the OCC map with the scene's stands (MapLab.jsx), or `layout-qa`, the review screen of the MDPC
//   airport layout (LayoutQaScene.jsx), which draws the layout itself and has no stands of its own;
// - `view`: the view the map opens on when the URL names none (region · approach · airfield · ramp);
// - `stands`: the stands of the screen as the positions map gives them to its map (positionsMapMappers.js over a
//   synthetic positions board), with their visits;
// - `at`: the instant the stands read at (their states and countdowns), unless the URL freezes another one with `?t=`;
// - `selection`: `{ kind, id }`, written to the URL when the scene opens and the URL selects nothing, or `null`;
// - `basemap`: `on` (the vector tiles of OpenFreeMap), `none` (the style without them, as `?basemap=none`) or `cut`
//   (the style with them, but the lab makes every base-map request fail, so the map shows its degraded notice);
// - `webgl`: `false` makes the browser refuse WebGL while the scene is open, so the map shows its fallback list.

export const BASEMAP_MODES = Object.freeze(['on', 'none', 'cut']);
export const SCENE_KINDS = Object.freeze(['map', 'layout-qa']);

/** The instant of the lab's stands: 11:00 in Punta Cana, the frozen clock of the visual suite (tests/visual). */
export const SCENE_INSTANT = Date.parse('2026-11-13T15:00:00.000Z');

function deepFreeze(value) {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.values(value).forEach(deepFreeze);
    Object.freeze(value);
  }
  return value;
}

const { marta, luis, ana } = SCENARIO_AGENTS;

// The ramp at SCENE_INSTANT, by stand: its visits (flight, minutes to its arrival and its departure, whether it
// arrived), who covers it and what else the board says of it. Every state of the vocabulary is there: free and
// planned stands; «Llegando» (A3 covered by nobody, so it carries the attention signal; A6 the demo flight; B25);
// «Ocupada» (A4 with another flight arriving, the urgent signal); «Por liberar» (A5, and B21 past its departure, with
// the attention signal); A10 cancelled by the combined A9 («Inhabilitada», linked to it); A8 limited to narrow-body
// aircraft (its code-C box inside); B35 planned within the hour with nobody covering it; BN13 without a database row
// («Sin verificar»).
const visit = (flight, arrivalInMin, departureInMin, extra = {}) => ({ flight, arrivalInMin, departureInMin, ...extra });
const RAMP = Object.freeze({
  A01: { coveredBy: [marta] },
  A02: { coveredBy: [marta], visits: [visit('DM201', 90, 150)] },
  A03: { visits: [visit('DM203', 10, 75)] },
  A04: { coveredBy: [luis], visits: [visit('DM205', -30, 60, { arrived: true }), visit('DM207', 5, 120)] },
  A05: { coveredBy: [luis], visits: [visit('DM209', -45, 10, { arrived: true })] },
  A06: { coveredBy: [marta], visits: [visit('ZZ9001', 6, 66, { isDemo: true })] },
  A07: { coveredBy: [luis], visits: [visit('DM211', -20, 70, { arrived: true })] },
  A08: { coveredBy: [luis], narrowbodyOnly: true },
  A09: { coveredBy: [ana], visits: [visit('DM213', -15, 120, { arrived: true })] },
  A10: { coveredBy: [ana], cancelledBy: 'A09' },
  A11: { coveredBy: [ana], visits: [visit('DM215', 45, 110)] },
  AN01: {},
  AN02: { coveredBy: [ana], visits: [visit('DM217', -50, 40, { arrived: true })] },
  AN03: {},
  AN04: { coveredBy: [marta], visits: [visit('DM219', 120, 180)] },
  AN05: {},
  B20: { coveredBy: [luis], visits: [visit('DM221', -25, 65, { arrived: true })] },
  B21: { coveredBy: [ana], visits: [visit('DM223', -90, -5, { arrived: true })] },
  B22: { coveredBy: [luis] },
  B23: { coveredBy: [luis], visits: [visit('DM225', 75, 140)] },
  B24: {},
  B25: { coveredBy: [marta], visits: [visit('DM227', 12, 80)] },
  B26: { coveredBy: [marta], visits: [visit('DM229', -10, 95, { arrived: true })] },
  B27: {},
  B28: {},
  B29: { coveredBy: [ana], visits: [visit('DM231', 100, 160)] },
  B30: {},
  B31: { coveredBy: [ana], visits: [visit('DM233', -35, 55, { arrived: true })] },
  B32: {},
  B34: {},
  B35: { visits: [visit('DM235', 50, 115)] },
  B36: {},
  B37: {},
  BN06: { standType: 'Remote', isRemote: true, maxAircraftSize: 'Narrowbody', narrowbodyOnly: true },
  BN07: { standType: 'Remote', isRemote: true },
  BN08: { standType: 'Remote', isRemote: true, coveredBy: [luis], visits: [visit('DM237', -40, 80, { arrived: true })] },
  BN09: { standType: 'Remote', isRemote: true },
  BN10: { standType: 'Remote', isRemote: true },
  BN11: { standType: 'Remote', isRemote: true, coveredBy: [luis], visits: [visit('DM239', 140, 200)] },
  BN12: { standType: 'Remote', isRemote: true },
  // BN13 has no database row: the map draws it «Sin verificar».
});

/** The positions board of the lab at `nowMs`, in the shape the API sends it (getOccPositions). */
export function labBoard(nowMs = SCENE_INSTANT) {
  const positions = Object.entries(RAMP).map(([code, { visits = [], ...stand }]) => boardStand(code, {
    ...stand,
    turnarounds: visits.map(({ flight, arrivalInMin, departureInMin, ...extra }) => boardVisit({
      nowMs, flight, arrivalInMin, departureInMin, ...extra,
    })),
  }));
  return {
    stationId: '20000000-0000-7000-8000-000000000003',
    stationCode: 'PUJ',
    operationDate: new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Santo_Domingo' }).format(nowMs),
    asOf: new Date(nowMs).toISOString(),
    positions,
    unassigned: [],
    canAssign: true,
  };
}

const REFERENCES = STAND_REFERENCE.map(stand => ({
  id: stand.code, terminal: stand.terminal, lat: stand.latitude, lon: stand.longitude,
}));

/**
 * The stands of the lab: the 41 reference stands in catalogue order, as the positions map gives them to its map from
 * labBoard(SCENE_INSTANT), all at their reference location (not placed by OCC, so the legend says «No oficial»).
 */
export function labStands() {
  const board = labBoard(SCENE_INSTANT);
  return mapOccupancyToRampPositions(REFERENCES, board, board.asOf);
}

const STANDS = deepFreeze(labStands());
const NO_STANDS = Object.freeze([]);

function scene(id, { kind = 'map', title, description, view, selection = null, basemap = 'on', webgl = true }) {
  const map = kind === 'map';
  return {
    id, kind, title, description, view, stands: map ? STANDS : NO_STANDS, at: map ? SCENE_INSTANT : null, selection, basemap, webgl,
  };
}

export const SCENES = deepFreeze([
  scene('ramp-states', {
    title: 'Rampa: posiciones y estados',
    description: 'Las 41 posiciones de referencia como polígonos con los siete estados, una pareja combinada, '
      + 'posiciones cubiertas y sin cubrir y sus señales, a las 11:00 de la escena.',
    view: 'ramp',
  }),
  scene('ramp-selected', {
    title: 'Rampa: posición elegida',
    description: 'La A5 elegida, con su borde cian y su rótulo por delante de los demás.',
    view: 'ramp',
    selection: { kind: 'stand', id: 'A5' },
  }),
  scene('airfield', {
    title: 'Aeródromo',
    description: 'El aeropuerto entero dibujado con su plano propio: pistas con sus marcas, calles de rodaje, plataformas, '
      + 'terminales y puntos de espera, con las posiciones y sus estados y el punto de referencia de PUJ.',
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
