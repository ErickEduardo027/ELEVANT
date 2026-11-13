// The OCC boot screen (contratos 2.6) as facts and a phase. Everything here is pure: OccBootProvider.jsx feeds it the
// client's decision, what RoleLayout's two gates report (the session was checked, the department access loaded or
// failed), the first screen that reports ready and its two timers, and keeps what this returns.
//
// The facts are kept in every phase, because React runs the effects of a child (the access signal, a screen) before
// those of its parent (the provider's decision): a fact can arrive while the screen is still hidden.

/** Once the access is loaded, the longest wait for the first screen; the access itself has no time limit. */
export const OCC_BOOT_READY_TIMEOUT_MS = 6_000;

/** How long the screen takes to leave once it starts going; it lets clicks through during that time. */
export const OCC_BOOT_EXIT_MS = 400;

/** The screens that may end the wait: the console's first data and the map engine's first frame. */
export const OCC_BOOT_SOURCES = Object.freeze(['console', 'map']);

export const OCC_BOOT_PHASES = Object.freeze(['hidden', 'waitingAccess', 'waitingReady', 'leaving', 'done']);

const VISIBLE_PHASES = new Set(['waitingAccess', 'waitingReady', 'leaving']);

/** Hidden, with nothing known: the server render and the hydration render never show the screen. */
export function initialOccBoot() {
  return { phase: 'hidden', session: false, access: 'pending', readyFrom: null };
}

// The phase the screen shows in, from the facts known at that moment.
function shownPhase({ access, readyFrom }) {
  if (access === 'failed') return 'done';
  if (access === 'loaded') return readyFrom === null ? 'waitingReady' : 'leaving';
  return 'waitingAccess';
}

/**
 * Events: `show` and `skip` (the client's decision, once), `sessionChecked`, `accessLoaded` and `accessFailed` (the
 * gates), `ready` with `source` (a screen of OCC_BOOT_SOURCES; the first one counts), `timeout` and `exitEnd` (the
 * provider's timers). Returns the same state when nothing changes, so a repeated report re-renders nothing.
 */
export function reduceOccBoot(state, event) {
  const { phase } = state;
  switch (event?.type) {
    case 'show':
      return phase === 'hidden' ? { ...state, phase: shownPhase(state) } : state;
    case 'skip':
      return phase === 'hidden' ? { ...state, phase: 'done' } : state;
    case 'sessionChecked':
      return state.session ? state : { ...state, session: true };
    case 'accessLoaded': {
      if (state.access === 'loaded') return state;
      // The access is read inside the session gate, so it also proves the session.
      const next = { ...state, session: true, access: 'loaded' };
      return phase === 'waitingAccess' ? { ...next, phase: shownPhase(next) } : next;
    }
    case 'accessFailed':
      // The AccessGate error takes the screen at once: no exit transition.
      if (VISIBLE_PHASES.has(phase)) return { ...state, access: 'failed', phase: 'done' };
      return state.access === 'failed' ? state : { ...state, access: 'failed' };
    case 'ready': {
      if (!OCC_BOOT_SOURCES.includes(event.source) || state.readyFrom !== null) return state;
      if (phase === 'leaving' || phase === 'done') return state;
      return { ...state, readyFrom: event.source, phase: phase === 'waitingReady' ? 'leaving' : phase };
    }
    case 'timeout':
      return phase === 'waitingReady' ? { ...state, phase: 'leaving' } : state;
    case 'exitEnd':
      return phase === 'leaving' ? { ...state, phase: 'done' } : state;
    default:
      return state;
  }
}

/** Whether the screen is on the page: while it waits and while it leaves. */
export function isOccBootVisible(state) {
  return VISIBLE_PHASES.has(state.phase);
}

/** What the progress line has reached: the session check, the access, the first screen, or the end. */
export function occBootProgress(state) {
  if (state.phase === 'leaving' || state.phase === 'done') return 'complete';
  if (state.access === 'loaded') return 'screen';
  return state.session ? 'access' : 'session';
}

/**
 * What screen readers hear: `preparing` while the screen waits, `ready` while it leaves, nothing otherwise. An access
 * error ends it without an announcement: the AccessGate's alert speaks for itself.
 */
export function occBootAnnouncement(state) {
  if (state.phase === 'waitingAccess' || state.phase === 'waitingReady') return 'preparing';
  return state.phase === 'leaving' ? 'ready' : null;
}
