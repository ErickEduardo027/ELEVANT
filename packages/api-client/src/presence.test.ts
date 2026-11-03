import { afterEach, describe, expect, it, vi } from "vitest";
import { createPresenceLease } from "./presence";

afterEach(() => vi.useRealTimers());

describe("ephemeral presence lease", () => {
  it("does not invent activity, reports input once, pauses and closes monotonically", async () => {
    vi.useFakeTimers();
    let foreground = true;
    const write = vi.fn().mockResolvedValue(undefined);
    const lease = createPresenceLease({ clientId: "10000000-0000-4000-8000-000000000001", write, getForeground: () => foreground });
    lease.start();
    await lease.flush();
    expect(write.mock.calls[0]![0]).toMatchObject({ mode: "foreground", activityObserved: false });
    lease.activity();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(write.mock.lastCall?.[0].activityObserved).toBe(true);
    foreground = false;
    await lease.pause();
    const paused = write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(90_000);
    expect(write).toHaveBeenCalledTimes(paused);
    foreground = true;
    lease.resume();
    await lease.flush();
    await lease.close();
    expect(write.mock.lastCall?.[0].mode).toBe("closed");
    const sequences = write.mock.calls.map(call => call[0].sequence);
    expect(new Set(sequences).size).toBe(sequences.length);
    const closed = write.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(write).toHaveBeenCalledTimes(closed);
  });

  it("retains unacknowledged activity and stops against an unsupported API", async () => {
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce({ status: 404 });
    const lease = createPresenceLease({ clientId: "10000000-0000-4000-8000-000000000001", write, getForeground: () => true });
    lease.activity();
    await lease.flush();
    await lease.flush();
    expect(write.mock.calls[1]![0].activityObserved).toBe(true);
    await lease.flush();
    const count = write.mock.calls.length;
    await lease.flush();
    expect(write).toHaveBeenCalledTimes(count);
  });
  it("expires unacknowledged input during a long offline suspension", async () => {
    vi.useFakeTimers();
    const write = vi.fn().mockRejectedValueOnce(new Error("offline")).mockResolvedValue(undefined);
    const lease = createPresenceLease({ clientId: "10000000-0000-4000-8000-000000000001", write, getForeground: () => true });
    lease.activity();
    await lease.flush();
    expect(write.mock.lastCall?.[0].activityObserved).toBe(true);
    await vi.advanceTimersByTimeAsync(300_001);
    await lease.flush();
    expect(write.mock.lastCall?.[0].activityObserved).toBe(false);
    lease.activity();
    await lease.flush();
    expect(write.mock.lastCall?.[0].activityObserved).toBe(true);
    await lease.close();
  });
});
