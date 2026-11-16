// The one key table of the OCC maps and the handler that applies its rules. Pure: nothing here listens to anything.
// The owner of a map builds a handler and attaches it to `keydown` on the map container (bubble phase), never on
// `document`, so a key typed elsewhere on the page does nothing.

/** `key` is compared with `event.key` without regard to case; `action` names the handler the caller provides. */
export const OCC_SHORTCUTS = Object.freeze([
  { key: '1', action: 'view.region', es: 'Región', en: 'Region' },
  { key: '2', action: 'view.approach', es: 'Aproximación', en: 'Approach' },
  { key: '3', action: 'view.airfield', es: 'Aeródromo', en: 'Airfield' },
  { key: '4', action: 'view.ramp', es: 'Rampa', en: 'Ramp' },
  { key: 'd', action: 'toggle3d', es: '2D/3D', en: '2D/3D' },
  { key: 's', action: 'toggleFollow', es: 'Seguir', en: 'Follow' },
  { key: 'l', action: 'toggleLayers', es: 'Capas', en: 'Layers' },
  { key: 'Escape', action: 'clearSelection', es: 'Limpiar', en: 'Clear' },
].map(Object.freeze));

const ACTION_BY_KEY = new Map(OCC_SHORTCUTS.map(({ key, action }) => [key.toLowerCase(), action]));

// A modal dialog or drawer that is really open. Some drawers stay mounted while closed (to animate their exit):
// those are `inert` or sit inside an `aria-hidden` wrapper, and do not count.
const MODAL_SELECTOR = '[role="dialog"][aria-modal="true"], [role="alertdialog"][aria-modal="true"]';
const CLOSED_SELECTOR = '[inert], [aria-hidden="true"]';

/** The action of the key that was pressed, or `null` when the key is not in the table. */
export function matchOccShortcut(event) {
  const key = event?.key;
  return typeof key === 'string' ? ACTION_BY_KEY.get(key.toLowerCase()) ?? null : null;
}

/** Whether the element takes typed text: a form field or anything inside an editable region. */
export function isEditableTarget(target) {
  if (typeof target?.closest !== 'function') return false;
  if (target.isContentEditable === true || target.closest('input, textarea, select') !== null) return true;
  const editable = target.closest('[contenteditable]');
  return editable !== null && editable.getAttribute('contenteditable').toLowerCase() !== 'false';
}

/** Whether a modal dialog or an open drawer is on screen. */
export function isOverlayOpen(doc = globalThis.document) {
  if (typeof doc?.querySelectorAll !== 'function') return false;
  for (const overlay of doc.querySelectorAll(MODAL_SELECTOR)) {
    if (overlay.closest(CLOSED_SELECTOR) === null) return true;
  }
  return false;
}

/**
 * Builds the `keydown` handler of a map container. `handlers` maps an action of the table to a function; a key
 * whose action has no handler is left alone. The handler returns `true` when it ran an action (and then it has
 * called `preventDefault()`), `false` otherwise. Attach it with `addEventListener` or React's `onKeyDown`, which
 * ignore that result; an `onkeydown` property would read `false` as «cancel the key».
 *
 * It does nothing when another handler already prevented the event, when Ctrl, Meta or Alt is held (those belong
 * to the browser and the system), while a key repeats because it is held down, when the key was typed in an
 * editable field, while a modal dialog or drawer is open, or while `isBlocked()` says the caller has an open
 * drawer that is not a modal dialog.
 */
export function createOccShortcutHandler(handlers, { isBlocked, document: doc } = {}) {
  return function handleOccShortcut(event) {
    if (event.defaultPrevented || event.ctrlKey || event.metaKey || event.altKey || event.repeat) return false;
    if (isEditableTarget(event.target)) return false;

    const action = matchOccShortcut(event);
    const run = action === null ? undefined : handlers?.[action];
    if (typeof run !== 'function') return false;
    if (isOverlayOpen(doc) || isBlocked?.()) return false;

    run();
    event.preventDefault();
    return true;
  };
}
