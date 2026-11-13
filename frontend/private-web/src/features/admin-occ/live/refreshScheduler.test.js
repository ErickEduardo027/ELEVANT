import { describe, expect, it } from 'vitest';
import { OCC_COALESCE_MS } from './occCadence';
import { createRefreshScheduler } from './refreshScheduler';

// A manual clock: the scheduler's timers run only when the test moves time.
function harness({ latencyMs = 100 } = {}) {
  let now = 0;
  let hidden = false;
  let nextId = 1;
  const timers = new Map();
  const reads = [];
  const schedule = (callback, ms) => {
    const id = nextId++;
    timers.set(id, { at: now + ms, callback });
    return id;
  };
  const cancel = id => { timers.delete(id); };
  const advanceTo = target => {
    for (;;) {
      const due = [...timers.entries()].filter(([, timer]) => timer.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
      if (!due) break;
      timers.delete(due[0]);
      now = due[1].at;
      due[1].callback();
    }
    now = target;
  };
  // Each read takes `latencyMs` and frames itself with started()/settled(), as useOccResource's reads do.
  const scheduler = createRefreshScheduler({
    coalesceMs: OCC_COALESCE_MS, now: () => now, schedule, cancel, isHidden: () => hidden,
    run: () => {
      reads.push(now);
      scheduler.started();
      schedule(() => scheduler.settled(), latencyMs);
    },
  });
  return {
    scheduler, reads, advanceTo, timers,
    at: (ms, action) => { advanceTo(ms); action(); },
    hide: () => { hidden = true; },
    show: () => { hidden = false; scheduler.becameVisible(); },
  };
}

describe('refresh scheduler', () => {
  it('runs the first request at once and coalesces a burst into one trailing read after 3 s', () => {
    const h = harness();
    h.at(0, h.scheduler.request);
    for (const ms of [200, 400, 600, 800]) h.at(ms, h.scheduler.request);
    h.advanceTo(10_000);
    expect(h.reads).toEqual([0, 3_000]);

    // A request after the window reads at once again.
    h.at(10_000, h.scheduler.request);
    h.advanceTo(20_000);
    expect(h.reads).toEqual([0, 3_000, 10_000]);
  });

  it('joins requests that arrive during a read into one read after it', () => {
    const slow = harness({ latencyMs: 5_000 });
    slow.at(0, slow.scheduler.request);
    for (const ms of [500, 1_000, 1_500]) slow.at(ms, slow.scheduler.request);
    slow.advanceTo(20_000);
    // The read settled after the window, so the joined read goes at once.
    expect(slow.reads).toEqual([0, 5_000]);

    const quick = harness({ latencyMs: 1_800 });
    quick.at(0, quick.scheduler.request);
    quick.at(1_000, quick.scheduler.request);
    quick.at(1_500, quick.scheduler.request);
    quick.advanceTo(20_000);
    // Settled inside the window: the joined read waits for its end.
    expect(quick.reads).toEqual([0, 3_000]);

    // A read the resource started on its own (a poll, a manual refresh) satisfies a waiting trailing read.
    const polled = harness();
    polled.at(0, polled.scheduler.request);
    polled.at(500, polled.scheduler.request);
    polled.at(1_000, () => { polled.reads.push(1_000); polled.scheduler.started(); polled.scheduler.settled(); });
    polled.advanceTo(20_000);
    expect(polled.reads).toEqual([0, 1_000]);
  });

  it('defers requests while hidden and reads once when visible', () => {
    const h = harness();
    h.hide();
    for (const ms of [0, 5_000, 9_000]) h.at(ms, h.scheduler.request);
    h.advanceTo(30_000);
    expect(h.reads).toEqual([]);
    h.at(30_000, h.show);
    h.advanceTo(40_000);
    expect(h.reads).toEqual([30_000]);

    // Becoming visible with nothing waiting reads nothing; a trailing read that falls due while hidden waits too.
    h.at(40_000, h.show);
    h.at(41_000, h.scheduler.request);
    h.at(42_000, h.scheduler.request);
    h.hide();
    h.advanceTo(50_000);
    expect(h.reads).toEqual([30_000, 41_000]);
    h.at(50_000, h.show);
    h.advanceTo(60_000);
    expect(h.reads).toEqual([30_000, 41_000, 50_000]);
  });

  it('reads nothing after dispose', () => {
    const h = harness();
    h.at(0, h.scheduler.request);
    h.at(1_000, h.scheduler.request);
    h.scheduler.dispose();
    h.advanceTo(10_000);
    h.scheduler.request();
    h.scheduler.becameVisible();
    expect(h.reads).toEqual([0]);
    expect(h.timers.size).toBe(0);
  });
});
