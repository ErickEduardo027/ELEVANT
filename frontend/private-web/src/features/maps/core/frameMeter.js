// The frame meter of an OCC map (PR M2, 2026-11-28): the frames MapLibre really drew (its `render` event), never the
// browser's animation callbacks, over the last `windowMs`. It answers the frames per second, the median and 95th
// percentile of the frame time and the share of frames over 33.3 ms (under 30 frames a second), for the hidden meter
// Ctrl+Alt+F shows on the map (ui/FrameMeter.jsx) and for the visual suite's perf runs. A gap over `restGapMs` is the
// map resting (nothing moves, so nothing is drawn), not a slow frame: it counts in no frame time. No clock, no DOM.

export const FRAME_METER = Object.freeze({ windowMs: 2_000, restGapMs: 250, slowFrameMs: 1_000 / 30 });

/** The value at quantile `q` (0..1) of `values`, nearest rank; 0 for none. */
export function quantile(values, q) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1))];
}

/**
 * The frames per second, frame times and slow share of the render instants `times` (milliseconds, ascending) seen over
 * `spanMs`: `{ frames, fps, p50Ms, p95Ms, overBudgetShare }`. The frame times are the gaps between two renders, without
 * those over `restGapMs`.
 */
export function frameStats(times, spanMs, { restGapMs = FRAME_METER.restGapMs, slowFrameMs = FRAME_METER.slowFrameMs } = {}) {
  const gaps = [];
  for (let i = 1; i < times.length; i += 1) {
    const gap = times[i] - times[i - 1];
    if (gap >= 0 && gap <= restGapMs) gaps.push(gap);
  }
  const fps = spanMs > 0 ? (times.length * 1_000) / spanMs : 0;
  const slow = gaps.filter(gap => gap > slowFrameMs).length;
  return {
    frames: times.length,
    fps: Math.round(fps * 10) / 10,
    p50Ms: Math.round(quantile(gaps, 0.5) * 10) / 10,
    p95Ms: Math.round(quantile(gaps, 0.95) * 10) / 10,
    overBudgetShare: gaps.length === 0 ? 0 : Math.round((slow / gaps.length) * 1_000) / 1_000,
  };
}

/**
 * A meter of the last `windowMs` of renders: `frame(atMs)` at every render, `read(atMs)` the frameStats of the window
 * that ends at `atMs` (its span is the window, or the time since the first render when shorter), `reset()`.
 */
export function createFrameMeter({ windowMs = FRAME_METER.windowMs, restGapMs, slowFrameMs } = {}) {
  let times = [];
  let firstAt = null;
  const trim = atMs => {
    const from = atMs - windowMs;
    let drop = 0;
    while (drop < times.length && times[drop] < from) drop += 1;
    if (drop > 0) times = times.slice(drop);
  };
  return {
    frame(atMs) {
      if (!Number.isFinite(atMs)) return;
      if (firstAt === null) firstAt = atMs;
      times.push(atMs);
      if (times.length > 512) trim(atMs);
    },
    read(atMs) {
      trim(atMs);
      const span = firstAt === null ? 0 : Math.min(windowMs, atMs - firstAt);
      return frameStats(times, span, { restGapMs, slowFrameMs });
    },
    reset() {
      times = [];
      firstAt = null;
    },
  };
}
