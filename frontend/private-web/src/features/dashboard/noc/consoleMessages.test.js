import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../../maps/mapMessages';
import { occUiMessages } from '../../occ-ui/occUiMessages';
import { durationText, relativeTimeText } from '../../occ-ui/occTime';
import { FLIGHT_STATUS_KEYS } from './boardModel';
import { STALE_AFTER_MINUTES } from '../../weather/useMdpcWeather';
import { consoleMessages } from './consoleMessages';
import { PENDING_ACTIONS } from './pendingModel';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

// The honesty texts of the old dashboard (src/features/dashboard/dashboardMessages.js, gone with PR U3), word for word:
// the console keeps them. Lane M7 (2026-11-27) changed four of them on purpose: the METAR comes from NOAA AWC through
// the API, not from IEM (source, sourceCompact, no derivedNote), it is stale past 90 minutes or when the API keeps it
// after a failure (staleBody), and the pill's satellite map is gone with its imagery words.
const OLD_DASHBOARD_TEXTS = Object.freeze({
  es: {
    states: {
      loading: 'Cargando panorama operativo…',
      forbidden: 'No hay una estación OCC autorizada para consultar este panorama.',
      unavailable: 'Tu cuenta no tiene acceso autorizado a la estación PUJ.',
      unauthorized: 'La sesión expiró. Vuelva a iniciar sesión.',
      error: 'No se pudo cargar el panorama operativo de la estación.',
      timeout: 'El panorama tardó demasiado en responder. Comprueba la conexión y vuelve a intentarlo.',
      retry: 'Reintentar',
      refreshFailed: 'La última actualización falló; se muestran los datos consultados a las {time}.'
    },
    weather: {
      title: 'Meteorología MDPC',
      unofficial: 'No oficial',
      source: 'METAR MDPC de NOAA Aviation Weather Center (no oficial, sin garantía).',
      sourceCompact: 'METAR MDPC · NOAA AWC · no oficial',
      observed: 'Observado {time} UTC',
      received: 'Recibido {time} UTC',
      age: 'hace {minutes} min',
      stale: 'Desactualizado',
      staleBody: 'La última observación tiene más de {minutes} minutos o es la que el servicio meteorológico guardó tras un fallo.',
      refreshFailed: 'La última consulta falló; se muestra la observación anterior.',
      loading: 'Consultando la observación de MDPC…',
      error: 'La observación meteorológica no está disponible.',
      dialogTitle: 'Meteorología · Punta Cana (MDPC)',
      expand: 'Ver meteorología'
    },
    boardEmpty: 'No hay escalas registradas para esta estación y fecha local.',
    plannedNote: 'Asignación planificada; no confirma ocupación física.',
    needsResourcesHint: 'Escalas abiertas sin posición o sin agente asignado.',
    title: 'Panorama operativo'
  },
  en: {
    states: {
      loading: 'Loading operations overview…',
      forbidden: 'There is no authorized OCC station for this overview.',
      unavailable: 'Your account has no authorized access to the PUJ station.',
      unauthorized: 'Your session expired. Please sign in again.',
      error: 'The station operations overview could not be loaded.',
      timeout: 'The overview took too long to respond. Check the connection and try again.',
      retry: 'Retry',
      refreshFailed: 'The last refresh failed; showing data retrieved at {time}.'
    },
    weather: {
      title: 'MDPC weather',
      unofficial: 'Unofficial',
      source: 'MDPC METAR from NOAA Aviation Weather Center (unofficial, no warranty).',
      sourceCompact: 'MDPC METAR · NOAA AWC · unofficial',
      observed: 'Observed {time} UTC',
      received: 'Received {time} UTC',
      age: '{minutes} min ago',
      stale: 'Outdated',
      staleBody: 'The latest observation is older than {minutes} minutes or is the one the weather service kept after a failure.',
      refreshFailed: 'The last request failed; showing the previous observation.',
      loading: 'Retrieving the MDPC observation…',
      error: 'The weather observation is unavailable.',
      dialogTitle: 'Weather · Punta Cana (MDPC)',
      expand: 'View weather'
    },
    boardEmpty: 'No turnarounds are recorded for this station and local date.',
    plannedNote: 'Planned assignment; does not confirm physical occupancy.',
    needsResourcesHint: 'Open turnarounds without a stand or an assigned agent.',
    title: 'Operations overview'
  }
});

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

describe('consoleMessages', () => {
  it('es and en carry the same keys', () => {
    const paths = leafPaths(consoleMessages.es);
    expect(leafPaths(consoleMessages.en)).toEqual(paths);
    for (const section of ['states', 'panels', 'board', 'status', 'figures', 'pending', 'band', 'arrival', 'provenance',
      'weather', 'time']) {
      expect(paths.some(path => path.startsWith(`${section}.`)), section).toBe(true);
    }
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(consoleMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      // A placeholder keeps its English name in both languages, so one call fills either.
      expect(placeholdersOf(textAt(consoleMessages.en, path)), path)
        .toEqual(placeholdersOf(textAt(consoleMessages.es, path)));
    }
    // Every status of a strip and every action of a pending item has its words.
    for (const key of FLIGHT_STATUS_KEYS) expect(consoleMessages.es.status[key], key).toBeTruthy();
    for (const action of PENDING_ACTIONS) expect(consoleMessages.es.pending.actions[action], action).toBeTruthy();
    // N25: a tab whose flights all wait in «Por importar» counts them, in both languages.
    for (const language of ['es', 'en']) {
      for (const key of ['noneImportedArrivals', 'noneImportedDepartures']) {
        expect(placeholdersOf(String(consoleMessages[language].board[key] ?? '')), `${language}: board.${key}`)
          .toEqual(['count']);
      }
    }
  });

  it('keeps the honesty texts of the old dashboard word for word', () => {
    const { es, en } = consoleMessages;
    for (const language of ['es', 'en']) {
      // The states, and every weather word the pill and its detail say.
      const old = OLD_DASHBOARD_TEXTS[language];
      expect(consoleMessages[language].states, language).toEqual(old.states);
      for (const [key, value] of Object.entries(old.weather)) {
        expect(consoleMessages[language].weather[key], `${language}: weather.${key}`).toEqual(value);
      }
      expect(consoleMessages[language].title).toBe(old.title);
      expect(consoleMessages[language].board.empty).toBe(old.boardEmpty);
      expect(consoleMessages[language].provenance.planned).toBe(old.plannedNote);
      expect(consoleMessages[language].figures.needsResourcesHint).toBe(old.needsResourcesHint);
    }
    expect(es.states.loading).toMatch(/^Cargando panorama/);
    expect(es.states.unavailable).toContain('estación PUJ');
    expect(es.states.forbidden).toContain('estación OCC autorizada');
    expect(es.states.retry).toBe('Reintentar');
    expect(es.weather.unofficial).toBe('No oficial');
    // M7: no word of the weather names IEM any more, the stale limit is the API's 90 minutes, and the panel says its
    // name and its credit.
    for (const language of ['es', 'en']) {
      expect(JSON.stringify(consoleMessages[language].weather), language).not.toMatch(/IEM|Iowa|Mesonet|75/u);
    }
    expect(createTranslator(consoleMessages, 'es')('weather.staleBody', { minutes: STALE_AFTER_MINUTES }))
      .toContain('más de 90 minutos');
    expect(es.weather.panel.title).toBe('Meteorología PUJ');
    expect(es.weather.panel.credit).toBe('Datos: NOAA Aviation Weather Center');
    expect(es.provenance.planned).toBe('Asignación planificada; no confirma ocupación física.');
    expect(es.board.empty).toBe('No hay escalas registradas para esta estación y fecha local.');
    // The words the presentation guide waits for on the console.
    expect(es.status.noStand).toBe('Llegada sin posición asignada');
    expect(createTranslator(consoleMessages, 'es')('arrival.pill', { flight: 'ZZ9001' })).toBe('Llegada nueva: ZZ9001');
    expect(es.arrival.follow).toBe('Ver y seguir');
    expect(Object.values(es.panels)).toEqual(['Tablero', 'Alertas', 'Cifras de la jornada', 'Cifras', 'Posiciones',
      'Inspector']);
    expect(en.panels.board).toBe('Board');
    // The notice of a release from the assignment drawer, in Planificación's words and in English as well.
    expect(es.assign.agentReleased).toBe('Agente liberado. Ya puedes asignar a otro.');
    expect(en.assign.agentReleased).toBe('Agent released. You can assign another one.');
    expect(es.board.legend).toBe('Leyenda del tablero');
  });

  it('says an operation still open after its departure, in Pendientes and under «En operación» (N30)', () => {
    for (const language of ['es', 'en']) {
      const { pending, figures } = consoleMessages[language];
      expect(placeholdersOf(String(pending.openAfterDeparture ?? '')), `${language}: pending`).toEqual(['flight']);
      expect(placeholdersOf(String(figures.openAfterDeparture ?? '')), `${language}: figures`).toEqual(['count']);
      expect(placeholdersOf(String(figures.openAfterDepartureOne ?? 'x{count}')), `${language}: one`).toEqual([]);
    }
    const es = createTranslator(consoleMessages, 'es');
    const en = createTranslator(consoleMessages, 'en');
    expect(es('figures.openAfterDepartureOne')).toBe('1 abierta tras la salida');
    expect(es('figures.openAfterDeparture', { count: 2 })).toBe('2 abiertas tras la salida');
    expect(en('figures.openAfterDepartureOne')).toBe('1 open after departure');
    expect(en('figures.openAfterDeparture', { count: 2 })).toBe('2 open after departure');
    // The pending item says when it left with the words of a departure that happened.
    expect(es('pending.withWhen', { what: es('pending.openAfterDeparture', { flight: 'ZZ9002' }),
      when: es('pending.when.departsPast', { duration: '1 h 5 min' }) }))
      .toBe('ZZ9002 con la operación abierta, salió hace 1 h 5 min');
    expect(en('pending.withWhen', { what: en('pending.openAfterDeparture', { flight: 'ZZ9002' }),
      when: en('pending.when.departsPast', { duration: '1 h 5 min' }) }))
      .toBe('ZZ9002 with its operation still open, departed 1 h 5 min ago');
  });

  it('says the signals of a stand with the map words and counts with the words of occTime', () => {
    for (const language of ['es', 'en']) {
      for (const reason of ['conflict', 'uncovered', 'overdue']) {
        expect(consoleMessages[language].band.signals[reason], `${language}: ${reason}`)
          .toBe(mapMessages[language].stand[reason]);
      }
      expect(consoleMessages[language].time).toEqual(occUiMessages[language].time);
    }
    const t = createTranslator(consoleMessages, 'es');
    expect(durationText({ hours: 1, minutes: 25 }, t)).toBe('1 h 25 min');
    expect(relativeTimeText(Date.parse('2026-11-14T15:23:00Z'), Date.parse('2026-11-14T15:00:00Z'), t)).toBe('en 23 min');
    const english = createTranslator(consoleMessages, 'en');
    expect(english('pending.withWhen', { what: english('pending.noAgent', { flight: 'DM161' }),
      when: english('pending.when.arrives', { duration: '23 min' }) })).toBe('DM161 without an agent, arrives in 23 min');
  });
});
