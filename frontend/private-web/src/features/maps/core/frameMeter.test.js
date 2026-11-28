import { describe, expect, it } from 'vitest';
import { FRAME_METER, createFrameMeter, frameStats, quantile } from './frameMeter';

describe('frame meter (PR M2)', () => {
  it('quantile is the nearest rank, 0 for none', () => {
    expect(quantile([], 0.95)).toBe(0);
    expect(quantile([3, 1, 2], 0.5)).toBe(2);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10);
    expect(quantile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.9)).toBe(9);
  });

  it('frameStats: fps over the span, p50 and p95 of the gaps, share over 33.3 ms', () => {
    // 50 frames at 16 ms, then 5 of 40 ms, over one second: 54 gaps, 5 of them slow.
    const times = [];
    let at = 0;
    for (let i = 0; i < 50; i += 1) times.push((at += 16));
    for (let i = 0; i < 5; i += 1) times.push((at += 40));
    const stats = frameStats(times, 1_000);
    expect(stats.frames).toBe(55);
    expect(stats.fps).toBe(55);
    expect(stats.p50Ms).toBe(16);
    expect(stats.p95Ms).toBe(40);
    expect(stats.overBudgetShare).toBeCloseTo(5 / 54, 3);
  });

  it('a gap over restGapMs is the map resting, not a slow frame', () => {
    const stats = frameStats([0, 16, 32, 2_000, 2_016], 2_016);
    expect(stats.p95Ms).toBe(16);
    expect(stats.overBudgetShare).toBe(0);
    expect(FRAME_METER.restGapMs).toBe(250);
  });

  it('the meter reads the last window only, and its span is the time since the first frame while shorter', () => {
    const meter = createFrameMeter({ windowMs: 1_000 });
    expect(meter.read(0)).toEqual({ frames: 0, fps: 0, p50Ms: 0, p95Ms: 0, overBudgetShare: 0 });
    for (let at = 0; at <= 500; at += 20) meter.frame(at);
    // 26 frames in 500 ms.
    expect(meter.read(500).fps).toBe(52);
    for (let at = 520; at <= 3_000; at += 50) meter.frame(at);
    const late = meter.read(3_000);
    expect(late.fps).toBe(20);
    expect(late.p50Ms).toBe(50);
    expect(late.overBudgetShare).toBe(1);
    meter.frame(Number.NaN);
    meter.reset();
    expect(meter.read(3_000).frames).toBe(0);
  });
});
