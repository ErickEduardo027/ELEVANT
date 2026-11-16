import { parseInstant } from '../../../services/serverClock';
import { toWeatherReading } from '../../../services/weatherService';
import { mapOccupancyToRampPositions } from '../../positions-map/positionsMapMappers';
import { destinationPoint, roundCoord } from '../airport/geo';
import { STAND_REFERENCE } from '../stands/standReference';
import { SCENARIO_AGENTS, boardStand, boardVisit } from '../testing/mapFixtures';
import { TRAFFIC_FLIGHT_KEY } from '../testing/trafficFixtures';
import { createAerodromeWeather } from '../testing/weatherFixtures';
import { LAB_CHOSEN_HEX, TRAFFIC_SCENARIOS } from './trafficScenes';

// The fixed scenes of the map lab (app/map-lab, development only): synthetic data over the internal reference
// catalogue of Punta Cana, the same on every run, so the visual suite (tests/visual) drives and photographs each one
// without a session, the API or the network; the layout review shows the generated MDPC dataset itself. Pure data.
// Later PRs add their scenes here (traffic, the demo flight, 3D).
//
// A scene is `{ id, kind, title, description, view, stands, at, selection, follow, basemap, webgl, placing }`:
// - `kind`: `map`, the OCC map with the scene's stands (MapLab.jsx), or `layout-qa`, the review screen of the MDPC
//   airport layout (LayoutQaScene.jsx), which draws the layout itself and has no stands of its own;
// - `view`: the view the map opens on when the URL names none (region · approach · airfield · ramp);
// - `stands`: the stands of the screen as the positions map gives them to its map (positionsMapMappers.js over a
//   synthetic positions board), with their visits;
// - `at`: the instant the stands read at (their states and countdowns), unless the URL freezes another one with `?t=`;
// - `selection`: `{ kind, id }`, written to the URL when the scene opens and the URL selects nothing, or `null`;
// - `follow`: `true` writes `follow=1` with it (PR M6: follow mode), else `false`;
// - `basemap`: `on` (the vector tiles of OpenFreeMap), `none` (the style without them, as `?basemap=none`) or `cut`
//   (the style with them, but the lab makes every base-map request fail, so the map shows its degraded notice);
// - `webgl`: `false` makes the browser refuse WebGL while the scene is open, so the map shows its fallback list;
// - `placing`: `{ code, sizeHint, pending }`, a stand being placed («Ubicar en el mapa»): its box follows the pointer,
//   `pending` (`{ latitude, longitude, snapped }` or `null`) is the location waiting to be saved and a click moves it;
//   `null` for none.
// A traffic scene (PR M5) also has `traffic`: the synthetic air picture, map flights and tracks of
// lab/trafficScenes.js, which the lab draws at the frozen clock for the URL's selection (MapLab.jsx), without polling;
// with `layersMenu: true` it opens with the layers menu open. A reference scene (PR M8) has `weather`, a synthetic
// answer of GET occ/weather (testing/weatherFixtures.js) that the lab reads once (labWeather), and may have `traffic`
// too; the night scene reads at an instant of its own, dusk in Punta Cana. A weather scene (PR M8) may also have
// `satellite`, the times the simulated satellite images name (useSatelliteImagery: createSimulatedSatelliteImagery; no
// scene ever reads GIBS), and `layers`, the layers it opens with (OccMap's layerOverrides).

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

/** The stand the placing scene places: free, at its reference point, with nobody covering it. */
export const PLACING_STAND = 'B27';
/** How far south of its reference point the placing scene's pending location sits: past the snap, inside a box. */
export const PLACING_OFFSET_M = 35;

// The pending location of the placing scene, from the stand's point in the internal reference catalogue.
function placingScene() {
  const reference = STAND_REFERENCE.find(stand => stand.code === PLACING_STAND);
  const [longitude, latitude] = roundCoord(destinationPoint([reference.longitude, reference.latitude], 180, PLACING_OFFSET_M));
  return { code: PLACING_STAND, sizeHint: null, pending: { latitude, longitude, snapped: false } };
}

function scene(id, {
  kind = 'map', title, description, view, selection = null, follow = false, basemap = 'on', webgl = true, placing = null,
}) {
  const map = kind === 'map';
  return {
    id, kind, title, description, view, stands: map ? STANDS : NO_STANDS, at: map ? SCENE_INSTANT : null, selection,
    follow: follow === true, basemap, webgl, placing,
  };
}

// A map scene with the synthetic traffic of its id (lab/trafficScenes.js).
const trafficScene = (id, options) => ({ ...scene(id, options), traffic: TRAFFIC_SCENARIOS[id],
  ...(options.layersMenu === true ? { layersMenu: true } : {}) });

/** The instant of the night scene: 18:15 in Punta Cana, at dusk, the edge of the civil twilight crossing the region. */
export const NIGHT_SCENE_INSTANT = Date.parse('2026-11-13T22:15:00.000Z');

const isoAt = (ms, minutes = 0) => new Date(ms + minutes * 60_000).toISOString();

// The region's mixed traffic of lab/trafficScenes.js, with ZZ500 (en route, not drawn) coming from Santo Domingo
// instead of Miami: an airport of the region, which the references emphasise as the counterpart of a flight of today.
const SANTO_DOMINGO = Object.freeze({ iataCode: 'SDQ', icaoCode: 'MDSD', name: 'Las Américas International',
  latitude: 18.429701, longitude: -69.6689 });
function withCounterpart(scenario, flightKey, counterpart) {
  const rows = scenario.flights.flights.map(row => (row.flightKey === flightKey ? { ...row, counterpart } : row));
  return { ...scenario, flights: { ...scenario.flights, flights: rows } };
}

// A map scene with the references of PR M8: its synthetic weather, its traffic when it has one, and its own instant.
function referenceScene(id, { weather, traffic = null, at = null, ...options }) {
  return {
    ...scene(id, options),
    ...(at === null ? {} : { at }),
    weather,
    ...(traffic === null ? {} : { traffic }),
  };
}

/**
 * The satellite images of the lab (PR M8): the times GIBS would name for the GOES-East clouds and the IMERG rain before
 * the scene's 11:00, 10:50 and 10:30 in Punta Cana. Simulated: the visual suite answers their tiles with a synthetic
 * picture (tests/visual/support/isolate.mjs).
 */
export const LAB_SATELLITE = Object.freeze({
  goes: Object.freeze({ time: '2026-11-13T14:50:00Z', precision: 'instant' }),
  imerg: Object.freeze({ time: '2026-11-13T14:30:00Z', precision: 'instant' }),
});

// A map scene with the weather of PR M8: a reference scene with, when given, its satellite images and its layers.
function weatherScene(id, { satellite = null, layers = null, ...options }) {
  return {
    ...referenceScene(id, options),
    ...(satellite === null ? {} : { satellite }),
    ...(layers === null ? {} : { layers }),
  };
}

/**
 * The weather of a scene as useMdpcWeather answers it (the `weather` of OccMap), read once from its synthetic answer of
 * GET occ/weather: the lab never polls. `null` without one.
 */
export function labWeather(answer) {
  if (!answer) return null;
  const reading = toWeatherReading(answer, { receivedAt: parseInstant(answer.serverTime) });
  return Object.freeze({
    status: reading.observation ? 'success' : 'empty',
    data: reading.observation,
    fetchedAt: reading.receivedAt,
    refreshFailed: false,
    refreshing: false,
    refresh: () => {},
    apiStatus: reading.apiStatus,
    taf: reading.taf,
    retrievedAt: reading.retrievedAt,
    source: reading.source,
    error: null,
  });
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
  scene('ramp-combined-selected', {
    title: 'Rampa: pareja combinada elegida',
    description: 'La A10, anulada por la combinada A9, elegida: su borde cian, el enlace a la A9, «Anulada por A9» y las '
      + 'posiciones que cubre el mismo agente.',
    view: 'ramp',
    selection: { kind: 'stand', id: 'A10' },
  }),
  scene('ramp-placing-ghost', {
    title: 'Rampa: ubicar una posición',
    description: `La ${PLACING_STAND} se está ubicando: su caja a tamaño real sigue al puntero y la ubicación pendiente `
      + `queda ${PLACING_OFFSET_M} m al sur, a la espera de «Guardar ubicación».`,
    view: 'ramp',
    selection: { kind: 'stand', id: PLACING_STAND },
    placing: placingScene(),
  }),
  scene('airfield', {
    title: 'Aeródromo',
    description: 'El aeropuerto entero dibujado con su plano propio: pistas con sus marcas, calles de rodaje, plataformas, '
      + 'terminales y puntos de espera, con las posiciones y sus estados y el punto de referencia de PUJ.',
    view: 'airfield',
  }),
  scene('approach', {
    title: 'Aproximación',
    description: 'Hasta 40 NM alrededor de PUJ: el punto de referencia del aeropuerto, los anillos, los ejes de pista con la '
      + '08 habitual y las radioayudas, sin posiciones.',
    view: 'approach',
  }),
  scene('region', {
    title: 'Región',
    description: 'Hasta 250 NM alrededor de PUJ: el punto de referencia del aeropuerto, los anillos y los aeropuertos de '
      + 'la región, sin posiciones.',
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
  trafficScene('region-traffic-mixed', {
    title: 'Región: tráfico mixto',
    description: 'Hasta 250 NM alrededor de PUJ: un vuelo de AVIAM en final y otro que sale, una docena de aviones de '
      + 'otras líneas de todas las categorías y uno sin actualizar desde hace 45 s.',
    view: 'region',
  }),
  trafficScene('approach-traffic-demo', {
    title: 'Aproximación: llegada demo',
    description: 'El vuelo demo en final de la 08, donde lo pone su trayectoria ajustada al reloj del servidor, con su '
      + 'placa «Demo» y su anillo «est.», la llegada de AVIAM en base y otro tráfico alrededor.',
    view: 'approach',
  }),
  trafficScene('ramp-traffic-ground', {
    title: 'Rampa: tráfico en tierra',
    description: 'La llegada de AVIAM rodando a la A4, una salida en la A6, otro avión rodando por la calle B y un '
      + 'transpondedor oculto en la A1, que ocupa una visita de AVIAM.',
    view: 'ramp',
  }),
  trafficScene('approach-traffic-estimated-stale', {
    title: 'Aproximación: estimado y sin actualizar',
    description: 'La imagen aérea con más de un minuto de retraso: cada avión atenuado con la hora de su última '
      + 'posición, los que llevan más tiempo sin señal desvaneciéndose, y un vuelo de AVIAM con su posición estimada '
      + 'por el horario.',
    view: 'approach',
  }),
  trafficScene('region-traffic-selected', {
    title: 'Región: vuelo elegido',
    description: 'ZZ161 elegido en final de la 08: en cian, más grande y con su anillo, su recorrido observado, su trayecto '
      + 'estimado desde Miami y lo que le queda hasta su posición A5, con su bloque de datos acoplado arriba a la izquierda.',
    view: 'region',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.arrival },
  }),
  trafficScene('approach-traffic-hex-selected', {
    title: 'Aproximación: otro tráfico elegido',
    description: 'Un avión de otra línea elegido por su dirección ADS-B: su bloque dice «Otro tráfico» y su ruta es solo '
      + 'lo que voló.',
    view: 'approach',
    selection: { kind: 'aircraft', id: LAB_CHOSEN_HEX },
  }),
  trafficScene('region-layers-menu', {
    title: 'Región: menú de capas',
    description: 'El tráfico mixto de la región con el menú de capas abierto: el grupo Tráfico, con los vuelos de AVIAM '
      + 'siempre visibles.',
    view: 'region',
    layersMenu: true,
  }),
  referenceScene('region-references', {
    title: 'Región: referencias',
    description: 'Hasta 250 NM alrededor de PUJ a las 11:00: los anillos de distancia, los aeropuertos de la región con '
      + 'Santo Domingo resaltado por un vuelo de hoy y el tráfico mixto encima.',
    view: 'region',
    weather: createAerodromeWeather(),
    traffic: withCounterpart(TRAFFIC_SCENARIOS['region-traffic-mixed'], TRAFFIC_FLIGHT_KEY.noFix, SANTO_DOMINGO),
  }),
  referenceScene('region-references-night', {
    title: 'Región: referencias de noche',
    description: 'La región a las 18:15 de Punta Cana: pasado el crepúsculo civil, la noche cubre ya Puerto Rico y su '
      + 'borde se acerca a PUJ.',
    view: 'region',
    at: NIGHT_SCENE_INSTANT,
    weather: createAerodromeWeather({ serverTime: isoAt(NIGHT_SCENE_INSTANT), observedAt: isoAt(NIGHT_SCENE_INSTANT, -10),
      retrievedAt: isoAt(NIGHT_SCENE_INSTANT, -3) }),
  }),
  referenceScene('approach-references', {
    title: 'Aproximación: ejes de pista y radioayudas',
    description: 'Hasta 40 NM alrededor de PUJ: los anillos, los ejes de pista extendidos con la 08 en uso estimada por '
      + 'el viento del METAR, las radioayudas PNA y PCA y la llegada demo en final.',
    view: 'approach',
    weather: createAerodromeWeather(),
    traffic: TRAFFIC_SCENARIOS['approach-traffic-demo'],
  }),
  weatherScene('region-satellite', {
    title: 'Región: nubes y lluvia por satélite',
    description: 'Hasta 250 NM alrededor de PUJ a las 11:00, con las nubes de GOES-East y la lluvia de IMERG encendidas y '
      + 'fijadas a la hora de su imagen, bajo las referencias y el tráfico mixto. Imágenes simuladas, sin red.',
    view: 'region',
    weather: createAerodromeWeather(),
    satellite: LAB_SATELLITE,
    layers: { 'weather.goes': true, 'weather.imerg': true },
    traffic: TRAFFIC_SCENARIOS['region-traffic-mixed'],
  }),
  weatherScene('airfield-wind-live', {
    title: 'Aeródromo: viento en pista',
    description: 'El viento del METAR de las 10:50, 100° a 13 kt, junto al aeródromo: su flecha y «100° 13 kt R08», con el '
      + 'viento de frente y de costado de cada pista en su tooltip.',
    view: 'airfield',
    weather: createAerodromeWeather(),
  }),
  weatherScene('airfield-wind-stale', {
    title: 'Aeródromo: viento sin actualizar',
    description: 'El último METAR es de las 08:00: el viento se atenúa y dice «Sin actualizar desde las 08:00».',
    view: 'airfield',
    weather: createAerodromeWeather({ status: 'Stale' }),
  }),
  weatherScene('airfield-wind-unavailable', {
    title: 'Aeródromo: sin clima del aeródromo',
    description: 'El servicio del clima no tiene METAR: no hay viento en el mapa y el menú de capas dice por qué.',
    view: 'airfield',
    weather: createAerodromeWeather({ status: 'Unavailable' }),
  }),
  // The demo flight in motion (PR M6): each scene fires it with the server's timeline so the lab's instant finds it where
  // the scene says (lab/trafficScenes.js).
  trafficScene('approach-demo-final', {
    title: 'Aproximación: vuelo demo en final',
    description: 'El vuelo demo importado con la A6, en final de la 08 dos minutos antes de tocar pista, elegido: su '
      + 'bloque dice que su posición es estimada.',
    view: 'approach',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  trafficScene('airfield-demo-taxiing', {
    title: 'Aeródromo: vuelo demo rodando',
    description: 'El vuelo demo importado rueda por las calles de rodaje hacia la A6, minuto y medio después de tocar '
      + 'pista en la 08.',
    view: 'airfield',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  trafficScene('ramp-demo-awaiting-stand', {
    title: 'Rampa: vuelo demo esperando posición',
    description: 'Nadie importó el vuelo demo: espera en el punto de espera de la plataforma de la terminal B, con su '
      + 'bloque «Esperando posición · sin importar».',
    view: 'ramp',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  trafficScene('approach-traffic-live-estimated', {
    title: 'Aproximación: en vivo, sin señal y estimado',
    description: 'ZZ161 en vivo, ZZ700 saliendo sin señal desde hace 20 s y ZZ500 estimado por su horario: el bloque de '
      + 'cada uno dice de dónde sale su posición. Elegido, ZZ700.',
    view: 'approach',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.departed },
  }),
  trafficScene('airfield-demo-cancelled', {
    title: 'Aeródromo: vuelo demo cancelado',
    description: 'El proveedor canceló el vuelo demo en final corta: se desvanece donde está y su bloque dice «Cancelado '
      + 'por el proveedor (demo)».',
    view: 'airfield',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  trafficScene('approach-demo-accelerated', {
    title: 'Aproximación: vuelo demo de 2 minutos',
    description: 'Disparado con 2 minutos hasta la posición: sus 30 s en el aire no alcanzan a velocidad real desde 5 NM, '
      + 'así que esa parte va comprimida y su bloque dice «Demo acelerada ×N».',
    view: 'approach',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  // The route of the chosen flight and follow mode (PR M6, lab/trafficScenes.js).
  trafficScene('approach-demo-route', {
    title: 'Aproximación: ruta del vuelo demo',
    description: 'El vuelo demo importado con la A6, elegido un minuto después de aparecer: su trayecto estimado desde '
      + 'Nueva York y lo que le queda por volar, la aproximación, la pista 08, la salida y el rodaje hasta la A6.',
    view: 'approach',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
  }),
  trafficScene('airfield-departure-route', {
    title: 'Aeródromo: ruta de una salida',
    description: 'La salida del vuelo demo elegida mientras rueda hacia la 08, dos minutos después de dejar la A6 a su '
      + 'hora: lo que recorrió desde la posición y lo que le queda, el rodaje, la pista 08, el ascenso y el círculo '
      + 'máximo hacia Nueva York.',
    view: 'airfield',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoDeparture },
  }),
  trafficScene('approach-follow-final', {
    title: 'Aproximación: seguir al vuelo demo en final',
    description: 'El vuelo demo en final de la 08, seguido: la cámara lo encuadra con el umbral de la pista, entre los '
      + 'paneles.',
    view: 'approach',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
    follow: true,
  }),
  trafficScene('airfield-follow-taxi', {
    title: 'Aeródromo: seguir al vuelo demo en rodaje',
    description: 'El vuelo demo rodando hacia la A6, seguido: la cámara lo centra de cerca mientras rueda.',
    view: 'airfield',
    selection: { kind: 'flight', id: TRAFFIC_FLIGHT_KEY.demoArrival },
    follow: true,
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
