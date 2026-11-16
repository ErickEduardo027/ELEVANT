import { afterEach, expect, it } from "vitest";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";

import { useLiveSnapshot } from "@/components/portal/useLiveSnapshot";

afterEach(() => { cleanup(); });

/** A read whose every call waits until the test settles it. */
function deferredReads<T>() {
  const calls: Array<{ resolve: (value: T) => void; reject: (error: unknown) => void; signal: AbortSignal }> = [];
  const read = (signal: AbortSignal) => new Promise<T>((resolve, reject) => { calls.push({ resolve, reject, signal }); });
  return { calls, read };
}

it("keeps the last snapshot while the same scope is read again (4-N25)", async () => {
  const { calls, read } = deferredReads<string[]>();
  const view = renderHook(({ revision }) => useLiveSnapshot("invoices", revision, read), { initialProps: { revision: 0 } });
  expect(view.result.current).toMatchObject({ data: null, refreshing: true, failed: false });
  await act(async () => calls[0].resolve(["E310000000001"]));
  expect(view.result.current).toMatchObject({ data: ["E310000000001"], refreshing: false, failed: false });

  view.rerender({ revision: 1 });
  await waitFor(() => expect(calls).toHaveLength(2));
  // The previous list stays on screen while it is read again.
  expect(view.result.current).toMatchObject({ data: ["E310000000001"], refreshing: true, failed: false });
  await act(async () => calls[1].resolve(["E310000000001", "E310000000002"]));
  expect(view.result.current).toMatchObject({ data: ["E310000000001", "E310000000002"], refreshing: false });
});

it("keeps the data after a failed read and reads again on retry (4-N25)", async () => {
  const { calls, read } = deferredReads<string>();
  const view = renderHook(({ revision }) => useLiveSnapshot("statement", revision, read), { initialProps: { revision: 0 } });
  await act(async () => calls[0].resolve("corte 1"));
  view.rerender({ revision: 1 });
  await waitFor(() => expect(calls).toHaveLength(2));
  const failure = new Error("offline");
  await act(async () => calls[1].reject(failure));
  expect(view.result.current).toMatchObject({ data: "corte 1", refreshing: false, failed: true, error: failure });

  act(() => view.result.current.retry());
  await waitFor(() => expect(calls).toHaveLength(3));
  expect(view.result.current).toMatchObject({ data: "corte 1", refreshing: true, failed: false, error: null });
  await act(async () => calls[2].resolve("corte 2"));
  expect(view.result.current).toMatchObject({ data: "corte 2", refreshing: false, failed: false });
});

it("never shows the data of another scope and aborts the read it no longer needs", async () => {
  const { calls, read } = deferredReads<string>();
  const view = renderHook(({ scope }) => useLiveSnapshot<string>(scope, 0, read), {
    initialProps: { scope: "invoice-a" as string | null } });
  await act(async () => calls[0].resolve("factura A"));
  view.rerender({ scope: "invoice-b" });
  expect(view.result.current).toMatchObject({ data: null, refreshing: true });
  await waitFor(() => expect(calls).toHaveLength(2));
  view.rerender({ scope: null });
  expect(calls[1].signal.aborted).toBe(true);
  expect(view.result.current).toMatchObject({ data: null, refreshing: false, failed: false });
  // A read that answers after its scope was left changes nothing.
  await act(async () => calls[1].resolve("factura B"));
  expect(view.result.current.data).toBeNull();
});

it("shows a first failure without data as such, so the view keeps its own error state", async () => {
  const { calls, read } = deferredReads<string>();
  const view = renderHook(() => useLiveSnapshot("documents", 0, read));
  await act(async () => calls[0].reject(undefined));
  expect(view.result.current).toMatchObject({ data: null, refreshing: false, failed: true });
});
