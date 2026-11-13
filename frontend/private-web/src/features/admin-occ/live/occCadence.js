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
