import { staleAfterSeconds } from './situationModel';

// The trails of the aircraft on the map (design E5, contracts 2.7), kept outside React: the points of every air
// picture, the short trail the first one brings (`trails=short`) and the track of the chosen aircraft, per hex. A trail
// is never joined across a gap: two points further apart than the break, or a read that comes after more than the break
// without reads (a hidden tab), start a new part. Bounded for long sessions: 600 points for an ELEVANT flight or the
// chosen aircraft, 60 for other traffic, whose trail the map shows for 2 minutes at most.
//
// Points are `{ at, lon, lat, altM, onGround }` (the map model's units, situationModel.js). The store publishes a new
// frozen snapshot on every change, for useSyncExternalStore; trailFeatures() draws one.

const MIN_BREAK_MS = 60_000;

/** The longest time between two points of one part of a trail: max(60 s, 3 × refreshAfterSeconds). */
export function trailBreakMs(refreshAfterSeconds) {
  const refresh = Number.isFinite(refreshAfterSeconds) && refreshAfterSeconds > 0 ? refreshAfterSeconds : 0;
  return Math.max(MIN_BREAK_MS, 3 * refresh * 1_000);
}

const finite = value => typeof value === 'number' && Number.isFinite(value);
const isPoint = point => point != null && finite(point.at) && finite(point.lon) && finite(point.lat);

function asPoint(point, breakBefore = false) {
  return Object.freeze({ at: point.at, lon: point.lon, lat: point.lat, altM: finite(point.altM) ? point.altM : null,
    onGround: point.onGround === true, breakBefore: breakBefore || point.breakBefore === true });
}

/**
 * The points of `existing` and `incoming` in time order, one per instant (the first one recorded wins). With
 * `gapBefore`, the first incoming point newer than every existing one starts a new part.
 */
function mergePoints(existing, incoming, { gapBefore = false } = {}) {
  const latest = existing.length > 0 ? existing[existing.length - 1].at : -Infinity;
  const byInstant = new Map(existing.map(point => [point.at, point]));
  let flagged = false;
  for (const point of [...incoming].filter(isPoint).sort((left, right) => left.at - right.at)) {
    if (byInstant.has(point.at)) continue;
    const opens = gapBefore && !flagged && point.at > latest;
    if (opens) flagged = true;
    byInstant.set(point.at, asPoint(point, opens));
  }
  return [...byInstant.values()].sort((left, right) => left.at - right.at);
}

/** The parts of a trail: a new one at each break mark and wherever two points are more than `breakMs` apart. */
function splitParts(points, breakMs) {
  const parts = [];
  let part = [];
  for (const point of points) {
    const previous = part[part.length - 1];
    if (previous && (point.breakBefore || point.at - previous.at > breakMs)) {
      parts.push(part);
      part = [];
    }
    part.push(point);
  }
  if (part.length > 0) parts.push(part);
  return parts;
}

const EMPTY_HEXES = new Set();

/**
 * The trails a map draws, from a store snapshot: one LineString per part of two or more points, with `{ id, hex, kind,
 * quality, selected, dimmed }`. The ELEVANT flights' trails (`aviamHexes`) and the chosen aircraft's (`selectedHex`) are drawn
 * whole; other traffic only with `includeOther` («Estelas de todo el tráfico») and only its last 2 minutes. `quality` is
 * `stale` when the aircraft's newest point is older than the picture's stale limit at `nowMs`, else `live` (every point
 * here was observed; estimated parts come with PR M6). `dimmed` (CN-29) marks every trail but the chosen aircraft's
 * while something is chosen (`selectionActive`, or a `selectedHex`): the layers hide the other ELEVANT trails and draw
 * the other traffic's, shown only when the layers menu asks for them, fainter.
 */
export function trailFeatures(snapshot, { includeOther = false, selectedHex = null, aviamHexes = EMPTY_HEXES,
  nowMs, selectionActive = false } = {}) {
  const now = finite(nowMs) ? nowMs : (snapshot.lastIngestAt ?? 0);
  const aviam = aviamHexes instanceof Set ? aviamHexes : new Set(aviamHexes ?? []);
  const selected = selectedHex == null ? null : String(selectedHex).toLowerCase();
  const features = [];
  for (const entry of snapshot.entries.values()) {
    const isAviam = aviam.has(entry.hex);
    const isSelected = entry.hex === selected;
    if (!isAviam && !isSelected && !includeOther) continue;
    const newest = entry.points[entry.points.length - 1];
    if (!newest) continue;
    const points = isAviam || isSelected
      ? entry.points : entry.points.filter(point => point.at >= now - snapshot.otherWindowMs);
    const quality = now - newest.at > snapshot.staleMs ? 'stale' : 'live';
    for (const part of splitParts(points, snapshot.breakMs)) {
      if (part.length < 2) continue;
      features.push({
        type: 'Feature',
        properties: { id: `${entry.hex}:${part[0].at}`, hex: entry.hex, kind: isAviam ? 'aviam' : 'other', quality,
          selected: isSelected, dimmed: (selectionActive === true || selected !== null) && !isSelected },
        geometry: { type: 'LineString', coordinates: part.map(point => [point.lon, point.lat]) },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}

/**
 * A trail store for one map:
 * - `ingestPicture(picture, { nowMs })`: each aircraft of an air picture model adds its fix and its short trail; `nowMs`
 *   (by default the picture's `serverTime`) is when it was read. An aircraft absent for longer than the break is
 *   forgotten.
 * - `ingestTrack(hex, points)`: the server's track of one aircraft replaces the part of its trail up to the track's
 *   last point; that aircraft keeps 600 points from then on.
 * - `segmentsOf(hex)`, `features(options)` (trailFeatures), `forget(hexes)`, `clear()`.
 * - `subscribe(listener)` and `getSnapshot()` for useSyncExternalStore.
 * An aircraft whose picture entry names a flight (`matchedFlightKey`) keeps up to `maxAviam` points; other traffic
 * `maxOther`, within its last `otherWindowMs`.
 */
export function createTrailStore({ maxAviam = 600, maxOther = 60, otherWindowMs = 120_000 } = {}) {
  const listeners = new Set();
  let entries = new Map();
  let breakMs = trailBreakMs(0);
  let staleMs = staleAfterSeconds(0) * 1_000;
  let lastIngestAt = null;
  let snapshot = Object.freeze({ version: 0, entries: new Map(), breakMs, staleMs, otherWindowMs, lastIngestAt });

  function publish() {
    snapshot = Object.freeze({ version: snapshot.version + 1, entries: new Map(entries), breakMs, staleMs, otherWindowMs,
      lastIngestAt });
    listeners.forEach(listener => listener());
  }

  // The points an entry keeps: the newest ones up to its size, and for other traffic only its last window.
  function bounded(points, { aviam, pinned }, nowMs) {
    const wide = aviam || pinned;
    const kept = wide ? points : points.filter(point => point.at >= nowMs - otherWindowMs);
    const capacity = wide ? maxAviam : maxOther;
    return Object.freeze(kept.length > capacity ? kept.slice(kept.length - capacity) : kept);
  }

  return Object.freeze({
    ingestPicture(picture, { nowMs = picture?.serverTime } = {}) {
      if (!picture || !finite(nowMs)) return;
      breakMs = trailBreakMs(picture.refreshAfterSeconds);
      staleMs = staleAfterSeconds(picture.refreshAfterSeconds) * 1_000;
      const gap = lastIngestAt !== null && nowMs - lastIngestAt > breakMs;
      lastIngestAt = lastIngestAt === null ? nowMs : Math.max(lastIngestAt, nowMs);
      const next = new Map(entries);
      const present = new Set();
      for (const fix of picture.aircraft ?? []) {
        if (typeof fix?.hex !== 'string' || fix.hex === '') continue;
        present.add(fix.hex);
        const previous = next.get(fix.hex);
        const flags = { aviam: previous?.aviam === true || fix.matchedFlightKey != null, pinned: previous?.pinned === true };
        const incoming = [...(fix.trail ?? []),
          { at: fix.positionAt, lon: fix.lon, lat: fix.lat, altM: fix.altM, onGround: fix.onGround }];
        const points = mergePoints(previous?.points ?? [], incoming, { gapBefore: gap && previous !== undefined });
        next.set(fix.hex, Object.freeze({ hex: fix.hex, ...flags, lastSeenAt: nowMs, points: bounded(points, flags, nowMs) }));
      }
      for (const [hex, entry] of next) {
        if (!present.has(hex) && nowMs - entry.lastSeenAt > breakMs) next.delete(hex);
      }
      entries = next;
      publish();
    },
    ingestTrack(hex, points) {
      const address = typeof hex === 'string' ? hex.toLowerCase() : '';
      const track = mergePoints([], points ?? []);
      if (address === '' || track.length === 0) return;
      const lastTrackAt = track[track.length - 1].at;
      const previous = entries.get(address);
      const newer = (previous?.points ?? []).filter(point => point.at > lastTrackAt);
      const flags = { aviam: previous?.aviam === true, pinned: true };
      entries = new Map(entries).set(address, Object.freeze({ hex: address, ...flags,
        lastSeenAt: previous?.lastSeenAt ?? lastTrackAt,
        points: bounded(mergePoints(track, newer), flags, lastIngestAt ?? lastTrackAt) }));
      publish();
    },
    segmentsOf(hex) {
      const entry = entries.get(typeof hex === 'string' ? hex.toLowerCase() : hex);
      return entry ? splitParts(entry.points, breakMs) : [];
    },
    features(options) {
      return trailFeatures(snapshot, options);
    },
    forget(hexes = []) {
      const next = new Map(entries);
      for (const hex of hexes) next.delete(hex);
      if (next.size === entries.size) return;
      entries = next;
      publish();
    },
    clear() {
      if (entries.size === 0 && lastIngestAt === null) return;
      entries = new Map();
      lastIngestAt = null;
      publish();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => { listeners.delete(listener); };
    },
    getSnapshot: () => snapshot,
  });
}
