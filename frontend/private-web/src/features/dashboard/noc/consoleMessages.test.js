import { describe, expect, it } from 'vitest';
import { createTranslator } from '../../../i18n/languageStore';
import { mapMessages } from '../../maps/mapMessages';
import { occUiMessages } from '../../occ-ui/occUiMessages';
import { durationText, relativeTimeText } from '../../occ-ui/occTime';
import { dashboardMessages } from '../dashboardMessages';
import { FLIGHT_STATUS_KEYS } from './boardModel';
import { consoleMessages } from './consoleMessages';
import { PENDING_ACTIONS } from './pendingModel';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

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
  });

  it('keeps the honesty texts of the old dashboard word for word', () => {
    const { es, en } = consoleMessages;
    for (const language of ['es', 'en']) {
      // The states, and every weather word the pill and its detail say.
      expect(consoleMessages[language].states, language).toEqual(dashboardMessages[language].states);
      for (const [key, value] of Object.entries(consoleMessages[language].weather)) {
        expect(value, `${language}: weather.${key}`).toEqual(dashboardMessages[language].weather[key]);
      }
      expect(consoleMessages[language].board.empty).toBe(dashboardMessages[language].board.empty);
      expect(consoleMessages[language].provenance.planned).toBe(dashboardMessages[language].map.note);
      expect(consoleMessages[language].figures.needsResourcesHint)
        .toBe(dashboardMessages[language].summary.needsResourcesHint);
    }
    expect(es.states.loading).toMatch(/^Cargando panorama/);
    expect(es.states.unavailable).toContain('estación PUJ');
    expect(es.states.forbidden).toContain('estación OCC autorizada');
    expect(es.states.retry).toBe('Reintentar');
    expect(es.weather.unofficial).toBe('No oficial');
    expect(es.provenance.planned).toBe('Asignación planificada; no confirma ocupación física.');
    expect(es.board.empty).toBe('No hay escalas registradas para esta estación y fecha local.');
    // The words the presentation guide waits for on the console.
    expect(es.status.noStand).toBe('Llegada sin posición asignada');
    expect(createTranslator(consoleMessages, 'es')('arrival.pill', { flight: 'ZZ9001' })).toBe('Llegada nueva: ZZ9001');
    expect(es.arrival.follow).toBe('Ver y seguir');
    expect(Object.values(es.panels)).toEqual(['Tablero', 'Alertas', 'Cifras de la jornada', 'Posiciones', 'Inspector']);
    expect(en.panels.board).toBe('Board');
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
