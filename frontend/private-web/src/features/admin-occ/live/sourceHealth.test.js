import { expect, it, vi } from 'vitest';
import { OCC_SOURCES, SOURCE_STATES, createSourceHealthStore, summarizeSources } from './sourceHealth';

const T = Date.parse('2026-11-12T14:31:00Z');
const source = (id, state) => ({ id, state, at: null, detail: null, tags: [] });

it('reports, replaces and removes sources and notifies subscribers', () => {
  expect(Object.keys(OCC_SOURCES)).toEqual(['elevant', 'realtime', 'providerFlights', 'airTraffic', 'weather', 'satellite',
    'basemap']);
  expect(OCC_SOURCES.elevant).toEqual({ es: 'Operación ELEVANT', en: 'ELEVANT operations' });
  expect(OCC_SOURCES.realtime.es).toBe('Tiempo real');
  expect(SOURCE_STATES).toEqual(['ok', 'delayed', 'offline', 'forbidden', 'unconfigured', 'idle']);

  const store = createSourceHealthStore();
  const listener = vi.fn();
  const unsubscribe = store.subscribe(listener);
  expect(store.getSnapshot()).toEqual([]);

  store.report('realtime', { state: 'delayed', at: T, detail: 'polling' });
  store.report('elevant', { state: 'ok', at: '2026-11-12T14:31:00.000Z' });
  expect(listener).toHaveBeenCalledTimes(2);
  // Catalogue order, instants in ms whatever the reporter sent.
  expect(store.getSnapshot()).toEqual([
    { id: 'elevant', state: 'ok', at: T, detail: null, tags: [] },
    { id: 'realtime', state: 'delayed', at: T, detail: 'polling', tags: [] },
  ]);

  // An equal report notifies nobody and keeps the snapshot's identity (useSyncExternalStore).
  const snapshot = store.getSnapshot();
  store.report('elevant', { state: 'ok', at: T });
  expect(listener).toHaveBeenCalledTimes(2);
  expect(store.getSnapshot()).toBe(snapshot);

  // A new report replaces the old one.
  store.report('elevant', { state: 'offline', at: T, tags: ['stale'] });
  expect(store.getSnapshot()[0]).toEqual({ id: 'elevant', state: 'offline', at: T, detail: null, tags: ['stale'] });
  expect(listener).toHaveBeenCalledTimes(3);

  store.remove('realtime');
  store.remove('realtime');
  expect(store.getSnapshot().map(item => item.id)).toEqual(['elevant']);
  expect(listener).toHaveBeenCalledTimes(4);

  // A misspelt source or state fails at once instead of showing an unknown row.
  expect(() => store.report('flights', { state: 'ok' })).toThrow(TypeError);
  expect(() => store.report('elevant', { state: 'late' })).toThrow(TypeError);

  unsubscribe();
  store.report('weather', { state: 'ok' });
  expect(listener).toHaveBeenCalledTimes(4);
});

it('summarizes ok, one delayed, several delayed and disconnected from ELEVANT', () => {
  expect(summarizeSources([])).toEqual({ kind: 'ok', delayedCount: 0 });
  expect(summarizeSources([source('elevant', 'ok'), source('realtime', 'ok'), source('airTraffic', 'ok')]))
    .toEqual({ kind: 'ok', delayedCount: 0 });
  expect(summarizeSources([source('elevant', 'ok'), source('realtime', 'delayed')]))
    .toEqual({ kind: 'delayed', delayedCount: 1 });
  expect(summarizeSources([source('elevant', 'ok'), source('realtime', 'delayed'), source('airTraffic', 'offline'),
    source('weather', 'delayed')])).toEqual({ kind: 'delayed', delayedCount: 3 });
  // ELEVANT unreachable outranks everything; the others still count.
  expect(summarizeSources([source('elevant', 'offline'), source('realtime', 'offline'), source('weather', 'ok')]))
    .toEqual({ kind: 'disconnected', delayedCount: 1 });
});

it('never counts forbidden, unconfigured or idle sources as delayed', () => {
  expect(summarizeSources([source('elevant', 'ok'), source('providerFlights', 'forbidden'),
    source('airTraffic', 'unconfigured'), source('weather', 'idle'), source('satellite', 'idle')]))
    .toEqual({ kind: 'ok', delayedCount: 0 });
  // ELEVANT itself only disconnects the summary when it is offline.
  expect(summarizeSources([source('elevant', 'idle'), source('realtime', 'idle')])).toEqual({ kind: 'ok', delayedCount: 0 });
});
