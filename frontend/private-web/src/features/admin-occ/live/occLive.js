import { LIVE_FRESH_MS, OFFLINE_AFTER_MS, RECONNECT_GRACE_MS } from './occCadence';

// The OCC's live link, as the status bar names it (design C.4): «En vivo», «Reconectando», «Sin tiempo real» and
// «Sin conexión». Everything here is pure: the shell feeds it the observer's reports, the browser's online flag and
// the clock, and keeps what it returns.

export const LIVE_STATES = Object.freeze(['live', 'reconnecting', 'polling', 'offline']);

const isConnected = hub => hub.state === 'Connected';
const isReconnecting = hub => hub.state === 'Reconnecting';
const isConnecting = hub => hub.state === 'Connecting' || hub.state === 'Reconnecting';

// The rules of C.4, evaluated in this order.
function deriveState({ hubs, lastOkAt, failingSince, reconnectingSince, online, now }) {
  // 1. The browser is offline, or ELEVANT has not answered for more than a minute.
  if (!online || (failingSince != null && now - failingSince > OFFLINE_AFTER_MS)) return 'offline';
  // 2. A hub is connected and ELEVANT answered in the last minute.
  const fresh = lastOkAt != null && now - lastOkAt < LIVE_FRESH_MS;
  if (fresh && hubs.some(isConnected)) return 'live';
  // 3. The hubs are (re)connecting, or nothing has answered yet, for less than 30 s.
  const firstResultPending = lastOkAt == null && failingSince == null;
  const withinGrace = reconnectingSince != null && now - reconnectingSince < RECONNECT_GRACE_MS;
  if (withinGrace && (firstResultPending || hubs.some(isConnecting))) return 'reconnecting';
  // 4. No socket, but the HTTP reconciles still answer; 5. otherwise nothing tells us the picture is current.
  return fresh ? 'polling' : 'offline';
}

/**
 * The live state from the observer's last report. A reducer: `since` is the instant the state began, so `previous`
 * (the last result) is returned unchanged while the state holds, and a new state starts at `now`.
 */
export function liveState({ hubs = [], lastOkAt = null, failingSince = null, reconnectingSince = null, online = true,
  now, previous = null }) {
  const state = deriveState({ hubs, lastOkAt, failingSince, reconnectingSince, online, now });
  if (previous?.state === state) return previous;
  return { state, since: now };
}

/** What the shell keeps about its observer, from the moment it starts it. `online` survives a restart. */
export function startLive(now, { online = true, offlineSince = null } = {}) {
  const record = {
    hubs: [], lastOkAt: null, lastErrorAt: null, failingSince: null,
    // Until the first answer the link counts as connecting (rule 3).
    reconnectingSince: now,
    online, offlineSince,
  };
  return { ...record, live: liveState({ ...record, now }) };
}

function withLive(record, now) {
  const live = liveState({ ...record, now, previous: record.live });
  return live === record.live ? record : { ...record, live };
}

/**
 * Events: `{ type: 'restart', now }` (a new observer), `{ type: 'status', status, now }` (its onStatus report),
 * `{ type: 'online', online, now }` (the browser's flag) and `{ type: 'tick', now }` (time alone moves the state).
 * Returns the same record when nothing changed, so a tick re-renders nothing.
 */
export function reduceLive(record, event) {
  const { now } = event;
  if (event.type === 'restart') return startLive(now, record);
  if (event.type === 'status') {
    const { hubs = [], lastOkAt = null, lastErrorAt = null, failingSince = null } = event.status ?? {};
    const hasResult = lastOkAt != null || failingSince != null;
    let { reconnectingSince } = record;
    // A reconnect episode gets its own grace; the hubs' first start, or the poll restarting them, keeps the current one.
    if (hubs.some(isReconnecting)) {
      if (!record.hubs.some(isReconnecting)) reconnectingSince = now;
    } else if (!hubs.some(isConnecting) && hasResult) reconnectingSince = null;
    return withLive({ ...record, hubs, lastOkAt, lastErrorAt, failingSince, reconnectingSince }, now);
  }
  if (event.type === 'online') {
    const online = event.online !== false;
    if (online === record.online) return withLive(record, now);
    return withLive({ ...record, online, offlineSince: online ? null : now }, now);
  }
  if (event.type === 'tick') return withLive(record, now);
  return record;
}

/**
 * The two sources the shell itself reports (sourceHealth): «Operación ELEVANT», whether ELEVANT answers, and
 * «Tiempo real», whether changes arrive at once. `detail` carries the live state for the status bar's words.
 */
export function liveSourceReports({ live, lastOkAt = null, failingSince = null }) {
  const answered = lastOkAt != null;
  const hasResult = answered || failingSince != null;
  let elevant;
  if (live.state === 'offline') elevant = { state: 'offline', at: lastOkAt };
  else elevant = answered ? { state: 'ok', at: lastOkAt } : { state: 'idle', at: null };
  let realtime;
  if (live.state === 'live') realtime = { state: 'ok', at: lastOkAt };
  else if (live.state === 'offline') realtime = { state: 'offline', at: lastOkAt };
  else realtime = hasResult ? { state: 'delayed', at: lastOkAt } : { state: 'idle', at: null };
  return { elevant: { ...elevant, detail: null }, realtime: { ...realtime, detail: live.state } };
}
