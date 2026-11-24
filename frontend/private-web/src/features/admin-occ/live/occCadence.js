// The OCC's request pace (contracts 2.7) and the thresholds of its live link (design C.4), in one place: the shell,
// useOccResource and the request-budget test read these numbers, so a change here changes all three.

/** An announced resource is re-read at most once in this window; the last announcement gets a trailing read. */
export const OCC_COALESCE_MS = 3_000;

/** Every OCC read also re-reads on its own after this long, counted from its last finished read. */
export const OCC_SAFETY_POLL_MS = 60_000;

/** A read that takes longer is abandoned and reported, never left loading. */
export const OCC_READ_TIMEOUT_MS = 20_000;

/** The account-change observer's own HTTP poll (its default in src/services/accountChangeObserver.js). */
export const OCC_OBSERVER_POLL_MS = 25_000;

/** «En vivo» needs a hub connected and an answer from ELEVANT newer than this. */
export const LIVE_FRESH_MS = 60_000;

/** A reconnecting hub counts as «Reconectando» for this long; after it the link is judged on what it does. */
export const RECONNECT_GRACE_MS = 30_000;

/** Failing reconciles for longer than this mean «Sin conexión». */
export const OFFLINE_AFTER_MS = 60_000;

/**
 * The shell's observer reads the account-change cursor at once for a hint after a quiet window, and at most once more
 * in this window for the hints that follow (services/accountChangeObserver.js: `hintCoalesceMs`). The two hubs and a
 * batch of the server's dispatcher then cost one cursor read, and a demo flight that changes every 5 s at most one
 * every this long, with every re-read it announces.
 */
export const OCC_HINT_COALESCE_MS = 10_000;
