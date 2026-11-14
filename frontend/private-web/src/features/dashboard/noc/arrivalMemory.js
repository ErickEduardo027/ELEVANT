// The new demo arrivals whose pill the person closed (contratos 2.5): «Cerrar», or «Ver y seguir», which closes it too,
// keeps that flight from being announced again for the tab session, when the console opens again, reloads or comes
// back from another module. Only a closed pill is remembered: one nobody acted on comes back while its flight is still
// on its way (newArrivals.js). The keys live in sessionStorage (this tab only) as one JSON object
// `{ accountId, keys }`, so another account signing in in the same tab starts with nothing closed; this page also keeps
// them in memory, for a browser that refuses storage. At most the last OCC_CLOSED_ARRIVALS_LIMIT keys. No function here
// ever throws.

export const OCC_CLOSED_ARRIVALS_KEY = 'elevant-occ-closed-arrivals';

/** How many closed flights a tab remembers: a station has at most 3 active demo flights, and 50 in a day. */
export const OCC_CLOSED_ARRIVALS_LIMIT = 50;

const NO_KEYS = Object.freeze([]);
// The keys this page closed, for when storage is missing or refuses to answer.
let pageMemory = { accountId: '', keys: NO_KEYS };

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

const accountOf = accountId => String(accountId ?? '');
const isKey = value => typeof value === 'string' && value.length > 0;

// The stored record, keeping only its keys; null when storage cannot be read or holds anything else.
function storedRecord(store) {
  if (!store) return null;
  let text;
  try {
    text = store.getItem(OCC_CLOSED_ARRIVALS_KEY);
  } catch {
    return null;
  }
  if (typeof text !== 'string') return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed === null || typeof parsed !== 'object' || typeof parsed.accountId !== 'string'
      || !Array.isArray(parsed.keys)) return null;
    return { accountId: parsed.accountId, keys: parsed.keys.filter(isKey) };
  } catch {
    return null;
  }
}

const keysFor = (record, account) => (record?.accountId === account ? record.keys : NO_KEYS);

// The list with `flightKey` last, once, and no longer than the limit.
const withKey = (keys, flightKey) => [...keys.filter(key => key !== flightKey), flightKey]
  .slice(-OCC_CLOSED_ARRIVALS_LIMIT);

/** The flightKeys whose pill the account closed in this tab, as a Set (empty when nothing is remembered). */
export function readClosedArrivals(accountId, storage) {
  const account = accountOf(accountId);
  return new Set([...keysFor(storedRecord(sessionStore(storage)), account), ...keysFor(pageMemory, account)]);
}

/** Remembers for the tab session that the account closed the pill of `flightKey`. */
export function rememberClosedArrival(flightKey, accountId, storage) {
  if (!isKey(flightKey)) return;
  const account = accountOf(accountId);
  pageMemory = { accountId: account, keys: withKey(keysFor(pageMemory, account), flightKey) };
  const store = sessionStore(storage);
  if (!store) return;
  const keys = withKey(keysFor(storedRecord(store), account), flightKey);
  try {
    store.setItem(OCC_CLOSED_ARRIVALS_KEY, JSON.stringify({ accountId: account, keys }));
  } catch {
    // Full or refused storage: this page still remembers the key until it reloads.
  }
}

/** Forgets every closed arrival of this page and of this tab's storage. For tests. */
export function resetClosedArrivalsForTests() {
  pageMemory = { accountId: '', keys: NO_KEYS };
  try {
    sessionStore()?.removeItem(OCC_CLOSED_ARRIVALS_KEY);
  } catch {
    // Nothing is stored where storage is refused.
  }
}
