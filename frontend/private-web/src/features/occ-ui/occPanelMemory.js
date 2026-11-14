// Which floating panels of the console the user folded (contratos 2.5): each panel remembers its own fold for the tab
// session, so moving between modules or reloading the page keeps the console as it was left. The folds live in
// sessionStorage (this tab only) as one JSON object, `{ [panelId]: boolean }`. This page also keeps them in memory, so
// a panel still folds when the browser refuses storage, and starts from its default on the next load. No function
// here ever throws.

export const OCC_PANEL_FOLDS_KEY = 'elevant-occ-panel-folds';

const listeners = new Set();
// The folds of this page, for when storage is missing or refuses to answer.
const pageFolds = new Map();

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

const isPanelId = panelId => typeof panelId === 'string' && panelId.length > 0;

// The stored folds, keeping only the booleans; null when storage cannot be read. A value that is not a JSON object
// reads as no fold at all, so the next fold replaces it.
function storedFolds(store) {
  if (!store) return null;
  let text;
  try {
    text = store.getItem(OCC_PANEL_FOLDS_KEY);
  } catch {
    return null;
  }
  try {
    const parsed = JSON.parse(text ?? '{}');
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(Object.entries(parsed).filter(([, folded]) => typeof folded === 'boolean'));
  } catch {
    return {};
  }
}

/** The fold this tab remembers for the panel: `true` folded, `false` open, `null` when nothing is remembered. */
export function readPanelFolded(panelId, storage) {
  if (!isPanelId(panelId)) return null;
  const stored = storedFolds(sessionStore(storage))?.[panelId];
  if (typeof stored === 'boolean') return stored;
  return pageFolds.has(panelId) ? pageFolds.get(panelId) : null;
}

/** Remembers the panel's fold for the tab session and tells the panels of this page. */
export function writePanelFolded(panelId, folded, storage) {
  if (!isPanelId(panelId)) return;
  const value = Boolean(folded);
  pageFolds.set(panelId, value);
  const store = sessionStore(storage);
  const folds = storedFolds(store);
  if (store && folds) {
    try {
      store.setItem(OCC_PANEL_FOLDS_KEY, JSON.stringify({ ...folds, [panelId]: value }));
    } catch {
      // Full or refused storage: this page still remembers the fold until it reloads.
    }
  }
  listeners.forEach(listener => listener());
}

/** Calls `listener` after every fold remembered in this tab; returns the function that stops it. */
export function subscribePanelFolds(listener) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}

/** Forgets every fold of this page and of this tab's storage. For tests. */
export function resetPanelFoldsForTests() {
  pageFolds.clear();
  try {
    sessionStore()?.removeItem(OCC_PANEL_FOLDS_KEY);
  } catch {
    // Nothing is stored where storage is refused.
  }
  listeners.forEach(listener => listener());
}
