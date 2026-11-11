"use client";

import { useCallback, useEffect, useState } from "react";

/** What a portal view shows for one scope: the last data read, whether a read is running and how the last one ended. */
export interface LiveSnapshot<T> {
  /** The last data read for the scope. It stays on screen while the scope is read again and after a failed read. */
  data: T | null;
  /** A read of the scope is running: with data on screen it is a revalidation, without it the first load. */
  refreshing: boolean;
  /** The latest read of the scope failed. With data on screen the view keeps the data and offers «Reintentar». */
  failed: boolean;
  /** Why the latest read failed (an `ElevantApiError` with its status), or null. */
  error: unknown;
  /** Reads the scope again now. */
  retry: () => void;
}

type Entry<T> = { scope: string; key: string; data: T | null; failed: boolean; error: unknown };

const EMPTY: Entry<never> = { scope: "", key: "", data: null, failed: false, error: null };

/**
 * 4-N25: reads a portal view and keeps its last snapshot on screen while it is read again (a live notice, the focus,
 * «Reintentar»), so a list never empties to «Cargando…» nor is replaced by an error once it was shown.
 *
 * `scope` names what the data is about (the invoice, the cut-off date, the station): the data of another scope is never
 * shown, and `null` reads nothing. `revision` asks for a new read of the same scope. `read` must stay the same function
 * for a scope (a `useCallback`), or every render would read again.
 */
export function useLiveSnapshot<T>(scope: string | null, revision: string | number,
  read: (signal: AbortSignal) => Promise<T>): LiveSnapshot<T> {
  const [attempt, setAttempt] = useState(0);
  const [entry, setEntry] = useState<Entry<T>>(EMPTY);
  const key = `${revision}|${attempt}`;
  useEffect(() => {
    if (scope === null) return;
    const controller = new AbortController();
    let active = true;
    read(controller.signal).then(
      data => { if (active) setEntry({ scope, key, data, failed: false, error: null }); },
      (error: unknown) => {
        // A failed read keeps what the view already showed for this scope.
        if (active) setEntry(current => ({ scope, key, data: current.scope === scope ? current.data : null, failed: true,
          error }));
      });
    return () => { active = false; controller.abort(); };
  }, [key, read, scope]);
  const retry = useCallback(() => setAttempt(value => value + 1), []);
  const current = scope !== null && entry.scope === scope;
  const settled = current && entry.key === key;
  return {
    data: current ? entry.data : null,
    refreshing: scope !== null && !settled,
    failed: settled && entry.failed,
    error: settled ? entry.error : null,
    retry,
  };
}
