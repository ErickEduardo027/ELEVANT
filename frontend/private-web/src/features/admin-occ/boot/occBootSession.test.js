import { afterEach, describe, expect, it, vi } from 'vitest';
import { clearOccBootSeen, hasSeenOccBoot, markOccBootSeen, OCC_BOOT_SEEN_KEY } from './occBootSession';

const ACCOUNT = '30000000-0000-4000-8000-000000000001';
const OTHER_ACCOUNT = '30000000-0000-4000-8000-000000000002';

afterEach(() => {
  vi.restoreAllMocks();
  window.sessionStorage.clear();
  window.localStorage.clear();
});

describe('occBootSession', () => {
  it('a first entry has not seen it; once marked the same account has', () => {
    expect(OCC_BOOT_SEEN_KEY).toBe('elevant-occ-boot-seen');
    expect(hasSeenOccBoot(ACCOUNT)).toBe(false);
    markOccBootSeen(ACCOUNT);
    expect(hasSeenOccBoot(ACCOUNT)).toBe(true);
    // This tab only: the flag lives in sessionStorage and holds the account id.
    expect(window.sessionStorage.getItem(OCC_BOOT_SEEN_KEY)).toBe(ACCOUNT);
    expect(window.localStorage.getItem(OCC_BOOT_SEEN_KEY)).toBeNull();
    // A session without an account id still gets one showing.
    window.sessionStorage.clear();
    expect(hasSeenOccBoot(undefined)).toBe(false);
    markOccBootSeen(undefined);
    expect(hasSeenOccBoot(undefined)).toBe(true);
  });

  it('another account in the same tab sees it again', () => {
    markOccBootSeen(ACCOUNT);
    expect(hasSeenOccBoot(OTHER_ACCOUNT)).toBe(false);
    markOccBootSeen(OTHER_ACCOUNT);
    expect(hasSeenOccBoot(OTHER_ACCOUNT)).toBe(true);
    // One flag per tab: the last account that saw it.
    expect(hasSeenOccBoot(ACCOUNT)).toBe(false);
  });

  it('clearing forgets it', () => {
    markOccBootSeen(ACCOUNT);
    clearOccBootSeen();
    expect(hasSeenOccBoot(ACCOUNT)).toBe(false);
    expect(window.sessionStorage.getItem(OCC_BOOT_SEEN_KEY)).toBeNull();
    // Clearing twice is harmless.
    expect(() => clearOccBootSeen()).not.toThrow();
  });

  it('never throws when sessionStorage is unavailable', () => {
    // No storage at all.
    expect(hasSeenOccBoot(ACCOUNT, null)).toBe(false);
    expect(() => markOccBootSeen(ACCOUNT, null)).not.toThrow();
    expect(() => clearOccBootSeen(null)).not.toThrow();

    // A storage that refuses every call (quota, private mode).
    const refusing = {
      getItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
      setItem: vi.fn(() => { throw new DOMException('Full', 'QuotaExceededError'); }),
      removeItem: vi.fn(() => { throw new DOMException('Denied', 'SecurityError'); }),
    };
    expect(hasSeenOccBoot(ACCOUNT, refusing)).toBe(false);
    expect(() => markOccBootSeen(ACCOUNT, refusing)).not.toThrow();
    expect(() => clearOccBootSeen(refusing)).not.toThrow();
    expect(refusing.setItem).toHaveBeenCalledWith(OCC_BOOT_SEEN_KEY, ACCOUNT);

    // A browser that throws on the sessionStorage property itself (storage blocked): the screen shows again.
    markOccBootSeen(ACCOUNT);
    const blocked = vi.spyOn(window, 'sessionStorage', 'get').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    expect(hasSeenOccBoot(ACCOUNT)).toBe(false);
    expect(() => markOccBootSeen(ACCOUNT)).not.toThrow();
    expect(() => clearOccBootSeen()).not.toThrow();
    expect(blocked).toHaveBeenCalledTimes(3);
  });
});
