import { FLIGHT_REPORT_PHASES } from '@elevant/api-client';
import { describe, expect, it } from 'vitest';
import { consoleMessages } from '../dashboard/noc/consoleMessages';
import { occUiMessages } from './occUiMessages';

// Every leaf of a message tree as a dotted path, sorted.
function leafPaths(node, prefix = '') {
  return Object.entries(node).flatMap(([key, value]) => (value !== null && typeof value === 'object'
    ? leafPaths(value, `${prefix}${key}.`)
    : [`${prefix}${key}`])).sort();
}

const textAt = (messages, path) => path.split('.').reduce((node, key) => node[key], messages);
const placeholdersOf = text => [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort();

describe('occUiMessages', () => {
  it('es and en carry the same keys and no empty text', () => {
    const paths = leafPaths(occUiMessages.es);
    expect(leafPaths(occUiMessages.en)).toEqual(paths);
    // The primitives of the console and the ones that were already there.
    for (const section of ['legend', 'alerts', 'drawer', 'toasts', 'panel', 'skeleton', 'stat', 'time', 'flightStrip',
      'timeline', 'milestones']) {
      expect(paths.some(path => path.startsWith(`${section}.`)), section).toBe(true);
    }
    for (const path of paths) {
      for (const language of ['es', 'en']) {
        const text = textAt(occUiMessages[language], path);
        expect(typeof text === 'string' && text.trim().length > 0, `${language}: ${path}`).toBe(true);
      }
      // A placeholder keeps its English name in both languages, so one call fills either.
      expect(placeholdersOf(textAt(occUiMessages.en, path)), path).toEqual(placeholdersOf(textAt(occUiMessages.es, path)));
    }
    // The stale notice is the console's own sentence (the old dashboard's, word for word).
    expect(occUiMessages.es.panel.stale).toBe(consoleMessages.es.states.refreshFailed);
    expect(occUiMessages.en.panel.stale).toBe(consoleMessages.en.states.refreshFailed);
  });

  it('the phase words in Spanish equal FLIGHT_REPORT_PHASES', () => {
    const ids = FLIGHT_REPORT_PHASES.map(phase => phase.id);
    expect(ids).toEqual(['arrival', 'on_stand', 'departure', 'pushback']);
    expect(Object.keys(occUiMessages.es.milestones.phases)).toEqual(ids);
    expect(Object.keys(occUiMessages.en.milestones.phases)).toEqual(ids);
    for (const phase of FLIGHT_REPORT_PHASES) expect(occUiMessages.es.milestones.phases[phase.id]).toBe(phase.label);
  });
});
