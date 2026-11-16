import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, expect, it } from 'vitest';
import { useMapSelection } from './useMapSelection';

const router = globalThis.__nextRouterMock;
const original = { push: router.push, replace: router.replace };
let pushes;
let replaces;

beforeEach(() => {
  pushes = [];
  replaces = [];
  router.push = href => {
    pushes.push(href);
    original.push(href);
  };
  router.replace = href => {
    replaces.push(href);
    original.replace(href);
  };
});

afterEach(() => {
  router.push = original.push;
  router.replace = original.replace;
  window.history.replaceState({}, '', '/');
});

it('writes with replace and preserves every other query key', () => {
  const page = '/admin-occ/positions-map?stationId=s-1&operationId=op-7&tab=board';
  window.history.replaceState({}, '', page);
  const { result } = renderHook(() => useMapSelection());
  expect(result.current).toMatchObject({ selection: null, view: null, terminal: null, follow: false, focus: null });

  act(() => result.current.selectStand('a05'));
  expect(replaces.at(-1)).toBe(`${page}&stand=A5`);
  expect(result.current.selection).toEqual({ kind: 'stand', id: 'A5' });

  act(() => result.current.setView('ramp', { terminal: 'B' }));
  expect(replaces.at(-1)).toBe(`${page}&stand=A5&view=ramp&terminal=B`);
  expect(result.current).toMatchObject({ view: 'ramp', terminal: 'B' });

  // One selection at a time; follow and focus are flags of their own.
  act(() => result.current.selectFlight('l:leg-1'));
  act(() => result.current.setFollow(true));
  act(() => result.current.setFocus('map'));
  expect(replaces.at(-1)).toBe(`${page}&view=ramp&terminal=B&flightId=l%3Aleg-1&follow=1&focus=map`);
  expect(result.current).toMatchObject({ selection: { kind: 'flight', id: 'l:leg-1' }, follow: true, focus: 'map' });

  act(() => result.current.selectAircraft('A1B2C3'));
  expect(result.current.selection).toEqual({ kind: 'aircraft', id: 'a1b2c3' });

  // Clearing drops the selection and the follow mode, nothing else.
  act(() => result.current.clear());
  expect(replaces.at(-1)).toBe(`${page}&view=ramp&terminal=B&focus=map`);
  act(() => result.current.setView('region'));
  // An existing key keeps its place in the query.
  expect(replaces.at(-1)).toBe(`${page}&view=region&focus=map`);

  // Two writes before the router settles both land, on top of each other.
  act(() => {
    result.current.selectStand('B21');
    result.current.setView('airfield');
  });
  expect(replaces.at(-1)).toBe(`${page}&view=airfield&focus=map&stand=B21`);
  expect(window.location.search).toBe('?stationId=s-1&operationId=op-7&tab=board&view=airfield&focus=map&stand=B21');
  expect(pushes).toEqual([]);
});

it('keeps its actions stable between renders', () => {
  window.history.replaceState({}, '', '/admin-occ/dashboard');
  const { result, rerender } = renderHook(() => useMapSelection());
  const first = result.current;
  rerender();
  expect(result.current).toBe(first);
  act(() => result.current.selectStand('A1'));
  expect(result.current.selectStand).toBe(first.selectStand);
  expect(result.current.clear).toBe(first.clear);
});
