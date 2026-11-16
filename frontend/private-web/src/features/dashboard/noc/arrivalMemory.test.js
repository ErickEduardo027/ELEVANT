import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  OCC_CLOSED_ARRIVALS_KEY, OCC_CLOSED_ARRIVALS_LIMIT, readClosedArrivals, rememberClosedArrival,
  resetClosedArrivalsForTests,
} from './arrivalMemory';

const ACCOUNT = '2b7c4e1a-9d3f-4c5b-8e6a-1f2d3c4b5a69';
const OTHER_ACCOUNT = '7d1e2f3a-4b5c-4d6e-8f70-81920a1b2c3d';
const KEY = 'p:6af00000-0000-4000-8000-000000000001';
const SECOND = 'p:6af00000-0000-4000-8000-000000000003';

afterEach(() => {
  vi.restoreAllMocks();
  resetClosedArrivalsForTests();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

const stored = () => JSON.parse(window.sessionStorage.getItem(OCC_CLOSED_ARRIVALS_KEY));

describe('arrivalMemory', () => {
  it('remembers the closed arrivals of the account for the tab session, and only its own', () => {
    expect(OCC_CLOSED_ARRIVALS_KEY).toBe('elevant-occ-closed-arrivals');
    expect(readClosedArrivals(ACCOUNT)).toEqual(new Set());
    rememberClosedArrival(KEY, ACCOUNT);
    rememberClosedArrival(SECOND, ACCOUNT);
    rememberClosedArrival(KEY, ACCOUNT);
    expect(readClosedArrivals(ACCOUNT)).toEqual(new Set([KEY, SECOND]));
    // One JSON object in this tab's sessionStorage, each key once, the last closed last; nothing in localStorage.
    expect(stored()).toEqual({ accountId: ACCOUNT, keys: [SECOND, KEY] });
    expect(window.localStorage.getItem(OCC_CLOSED_ARRIVALS_KEY)).toBeNull();
    // Another account signing in in the same tab starts with nothing closed, and its first close replaces the record.
    expect(readClosedArrivals(OTHER_ACCOUNT)).toEqual(new Set());
    rememberClosedArrival(SECOND, OTHER_ACCOUNT);
    expect(stored()).toEqual({ accountId: OTHER_ACCOUNT, keys: [SECOND] });
    expect(readClosedArrivals(OTHER_ACCOUNT)).toEqual(new Set([SECOND]));
    // A key that is not a text is ignored.
    rememberClosedArrival('', OTHER_ACCOUNT);
    rememberClosedArrival(null, OTHER_ACCOUNT);
    expect(stored()).toEqual({ accountId: OTHER_ACCOUNT, keys: [SECOND] });
  });

  it('keeps the last closed keys only, and reads a damaged record as nothing closed', () => {
    const keys = Array.from({ length: OCC_CLOSED_ARRIVALS_LIMIT + 5 }, (_, index) => `p:flight-${index}`);
    for (const key of keys) rememberClosedArrival(key, ACCOUNT);
    expect(stored().keys).toEqual(keys.slice(-OCC_CLOSED_ARRIVALS_LIMIT));

    resetClosedArrivalsForTests();
    for (const damaged of ['{nope', '[]', 'null', '7', JSON.stringify({ accountId: 7, keys: [KEY] }),
      JSON.stringify({ accountId: ACCOUNT, keys: 'p:x' })]) {
      window.sessionStorage.setItem(OCC_CLOSED_ARRIVALS_KEY, damaged);
      expect(readClosedArrivals(ACCOUNT), damaged).toEqual(new Set());
    }
    // Keys that are not texts are dropped; the next close replaces what was there.
    window.sessionStorage.setItem(OCC_CLOSED_ARRIVALS_KEY, JSON.stringify({ accountId: ACCOUNT, keys: [KEY, 4, null] }));
    expect(readClosedArrivals(ACCOUNT)).toEqual(new Set([KEY]));
    rememberClosedArrival(SECOND, ACCOUNT);
    expect(stored()).toEqual({ accountId: ACCOUNT, keys: [KEY, SECOND] });
  });

  it('never throws without storage, and the page still remembers until it reloads', () => {
    // A storage that refuses every call (quota, private mode).
    const refusing = {
      getItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
      setItem: vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError'); }),
      removeItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
    };
    expect(() => rememberClosedArrival(KEY, ACCOUNT, refusing)).not.toThrow();
    expect(readClosedArrivals(ACCOUNT, refusing)).toEqual(new Set([KEY]));
    expect(readClosedArrivals(ACCOUNT, null)).toEqual(new Set([KEY]));
    expect(readClosedArrivals(OTHER_ACCOUNT, null)).toEqual(new Set());
    resetClosedArrivalsForTests();
    expect(readClosedArrivals(ACCOUNT, null)).toEqual(new Set());

    // A browser that throws on the sessionStorage property itself (storage blocked).
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(() => rememberClosedArrival(SECOND, ACCOUNT)).not.toThrow();
    expect(readClosedArrivals(ACCOUNT)).toEqual(new Set([SECOND]));
    expect(() => resetClosedArrivalsForTests()).not.toThrow();
    expect(blocked).toHaveBeenCalled();
  });
});
