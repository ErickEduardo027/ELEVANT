import { act, renderHook } from '@testing-library/react';
import { afterEach, expect, it } from 'vitest';
import { useAppSearchParams } from './useAppSearchParams';

const originalPush = globalThis.__nextRouterMock.push;

afterEach(() => {
  globalThis.__nextRouterMock.push = originalPush;
  window.history.replaceState({}, '', '/');
});

it('keeps successive filter edits while earlier Next navigations are pending', () => {
  window.history.replaceState({}, '', '/gestion-humana/reportes?kind=expirations');
  const navigations = [];
  globalThis.__nextRouterMock.push = href => navigations.push(href);
  const { result } = renderHook(() => useAppSearchParams());

  act(() => {
    result.current[1](current => {
      current.set('stationId', 'station-1');
      return current;
    });
    result.current[1](current => {
      current.set('from', '2026-10-01');
      return current;
    });
  });

  expect(navigations).toEqual([
    '/gestion-humana/reportes?kind=expirations&stationId=station-1',
    '/gestion-humana/reportes?kind=expirations&stationId=station-1&from=2026-10-01',
  ]);

  // The first response can arrive while the second navigation remains pending.
  act(() => {
    window.history.pushState({}, '', navigations[0]);
    window.dispatchEvent(new PopStateEvent('popstate'));
  });
  act(() => {
    result.current[1](current => {
      current.set('to', '2026-10-06');
      return current;
    });
  });
  expect(navigations[2]).toBe(
    '/gestion-humana/reportes?kind=expirations&stationId=station-1&from=2026-10-01&to=2026-10-06',
  );
});
