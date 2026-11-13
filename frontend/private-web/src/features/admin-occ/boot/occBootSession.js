// Whether this tab already showed the OCC boot screen to the signed-in account (contratos 2.6): it shows on the first
// OCC entry after each login, and not again while moving between modules or reloading the page. The flag lives in
// sessionStorage (this tab only) and holds the account id, so another account signing in in the same tab sees the
// screen again; authService forgets it at every login, logout and expiry. No function here ever throws: without
// storage the screen simply shows again.

export const OCC_BOOT_SEEN_KEY = 'elevant-occ-boot-seen';

// `storage` given by the caller (tests), else the tab's sessionStorage; null when the browser refuses it.
function sessionStore(storage) {
  if (storage !== undefined) return storage;
  if (typeof window === 'undefined') return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    return null;
  }
}

const flagFor = accountId => String(accountId ?? '');

/** True only when this tab marked the screen as seen for this same account. */
export function hasSeenOccBoot(accountId, storage) {
  const store = sessionStore(storage);
  if (!store) return false;
  try {
    return store.getItem(OCC_BOOT_SEEN_KEY) === flagFor(accountId);
  } catch {
    return false;
  }
}

export function markOccBootSeen(accountId, storage) {
  const store = sessionStore(storage);
  if (!store) return;
  try {
    store.setItem(OCC_BOOT_SEEN_KEY, flagFor(accountId));
  } catch {
    // Without storage the screen shows again on the next entry; nothing else depends on the flag.
  }
}

export function clearOccBootSeen(storage) {
  const store = sessionStore(storage);
  if (!store) return;
  try {
    store.removeItem(OCC_BOOT_SEEN_KEY);
  } catch {
    // There is no flag to forget when browser storage is unavailable.
  }
}
