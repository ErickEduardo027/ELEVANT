// The geometry and the words of the stand band (OccTimeline): where a visit falls in the time window, the full hours of
// the station on its axis, and the name a bar is read out with. Pure: the window and `now` come from the caller.
import { formatClock, toInstantMs } from './occTime';

/** The states of a visit on the band: planned, the aircraft on its stand, or already gone. */
export const TIMELINE_BAR_STATES = Object.freeze(['planned', 'onStand', 'departed']);

const TIME_KINDS = Object.freeze(['actual', 'estimated', 'scheduled']);
const MINUTE_MS = 60_000;
const QUARTER_MS = 15 * MINUTE_MS;
const minuteFormats = new Map();

// The window as two numbers, or null when it is not a window.
function windowOf(windowStart, windowEnd) {
  const start = toInstantMs(windowStart);
  const end = toInstantMs(windowEnd);
  return Number.isFinite(start) && Number.isFinite(end) && end > start ? { start, end } : null;
}

/** Where `at` falls in the window, from 0 at its start to 1 at its end, held to that range; NaN if anything is invalid. */
export function timeToFraction(at, windowStart, windowEnd) {
  const window = windowOf(windowStart, windowEnd);
  const ms = toInstantMs(at);
  if (window === null || !Number.isFinite(ms)) return Number.NaN;
  return Math.min(1, Math.max(0, (ms - window.start) / (window.end - window.start)));
}

/**
 * Where a visit's bar goes in the window: `{ left, width }` as fractions of the window, plus what was cut. A missing
 * (or unreadable) `startAt` leaves the bar open from the window's start (`openStart`), a missing `endAt` open to its
 * end (`openEnd`); a bar that began before the window is `clippedStart`, one that ends after it `clippedEnd`. `null`
 * for a bar wholly outside the window, one that ends before it starts, or an invalid window.
 */
export function barGeometry(bar, windowStart, windowEnd) {
  const window = windowOf(windowStart, windowEnd);
  if (window === null) return null;
  const startMs = toInstantMs(bar?.startAt);
  const endMs = toInstantMs(bar?.endAt);
  const openStart = !Number.isFinite(startMs);
  const openEnd = !Number.isFinite(endMs);
  const start = openStart ? window.start : startMs;
  const end = openEnd ? window.end : endMs;
  if (end < start || end <= window.start || start >= window.end) return null;
  const span = window.end - window.start;
  const from = Math.max(start, window.start);
  return {
    left: (from - window.start) / span, width: (Math.min(end, window.end) - from) / span, openStart, openEnd,
    clippedStart: !openStart && start < window.start,
    clippedEnd: !openEnd && end > window.end,
  };
}

// The minute of the hour in `timeZone`: 0 on a full hour of the station, whatever its offset from UTC.
function minuteInZone(ms, timeZone) {
  const key = timeZone ?? '';
  let format = minuteFormats.get(key);
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { minute: 'numeric', timeZone });
    minuteFormats.set(key, format);
  }
  return Number(format.format(ms));
}

/**
 * The full hours of the station inside the window, for the band's axis: `[{ at, fraction, label }]`, with `at` in
 * milliseconds and `label` «14:00». Every time zone in use sits a whole number of quarter hours from UTC, so the
 * quarter hours of the window are enough to find its full local hours, also across midnight and a change of offset.
 */
export function hourTicks(windowStart, windowEnd, timeZone, locale) {
  const window = windowOf(windowStart, windowEnd);
  if (window === null) return [];
  const ticks = [];
  for (let at = Math.ceil(window.start / QUARTER_MS) * QUARTER_MS; at <= window.end; at += QUARTER_MS) {
    if (minuteInZone(at, timeZone) !== 0) continue;
    ticks.push({ at, fraction: (at - window.start) / (window.end - window.start), label: formatClock(at, locale, timeZone) });
  }
  return ticks;
}

// «AA904 a AA905», or the one flight there is.
function flightsOf(bar, t) {
  const { arrivalFlight, departureFlight } = bar;
  if (arrivalFlight && departureFlight) return t('timeline.flights', { arrival: arrivalFlight, departure: departureFlight });
  return arrivalFlight || departureFlight || '';
}

// «llega 14:40 estimada»: the time with the word of its kind, the words of the flight strip. A kind it does not know
// is left out rather than read as a key.
function endWords(key, at, kind, { t, locale, timeZone }) {
  const kindWord = TIME_KINDS.includes(kind) ? t(`flightStrip.timeKind.${kind}`) : '';
  return t(key, { time: formatClock(at, locale, timeZone), kind: kindWord }).trim();
}

/**
 * How a bar of the band is read out: «AA904 a AA905, posición A5, llega 14:40 estimada, sale 15:35 programada, en
 * operación». An open end says «sin llegada» or «sin salida»; a visit in operation says so, any other says its state
 * («planificada», «en posición», «salió»); then «demo», «posición estimada» and the conflict's own words when they apply.
 * `row.label` is the stand code; `t` translates occUiMessages. An unknown state throws.
 */
export function timelineBarName(bar, row, { t, locale, timeZone = 'UTC' }) {
  if (!TIMELINE_BAR_STATES.includes(bar?.state)) throw new RangeError(`Unknown OCC timeline bar state: ${String(bar?.state)}`);
  const words = { t, locale, timeZone };
  const parts = [
    flightsOf(bar, t),
    t('timeline.stand', { code: row?.label ?? '' }),
    Number.isFinite(toInstantMs(bar.startAt))
      ? endWords('timeline.arrives', bar.startAt, bar.startKind, words) : t('timeline.noArrival'),
    Number.isFinite(toInstantMs(bar.endAt))
      ? endWords('timeline.departs', bar.endAt, bar.endKind, words) : t('timeline.noDeparture'),
    bar.inOperation ? t('timeline.inOperation') : t(`timeline.state.${bar.state}`),
    bar.demo ? t('timeline.demo') : '',
    bar.estimated ? t('timeline.estimated') : '',
    bar.conflict?.label ?? '',
  ];
  return parts.filter(part => typeof part === 'string' && part.length > 0).join(', ');
}
