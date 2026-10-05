import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { readAttendanceDraft, saveOccAttendanceDraft } from '../../../services/attendanceDraftService';

const POLL_MS = 25_000;

export function useAttendanceDraft({ operationId, assignmentId, enabled = true }) {
  const contextKey = `${operationId ?? ''}|${assignmentId ?? ''}|${enabled}`;
  const [state, setState] = useState({
    key: contextKey, status: 'idle', snapshot: null, error: null,
    attempted: null, conflict: false, pending: false,
  });
  const generationRef = useRef(0);
  const abortRef = useRef(null);
  const pendingRef = useRef(null);

  const reload = useCallback(async ({ initial = false } = {}) => {
    if (!enabled || !operationId || !assignmentId) return null;
    const generation = ++generationRef.current;
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    if (initial) setState(current => ({ ...current, key: contextKey,
      status: 'loading', snapshot: null, error: null,
      attempted: null, conflict: false, pending: false }));
    try {
      const snapshot = await readAttendanceDraft(operationId, assignmentId,
        { signal: controller.signal });
      if (generation === generationRef.current && !controller.signal.aborted) {
        setState(current => ({ ...current, key: contextKey, status: 'ready',
          snapshot, error: null }));
      }
      return snapshot;
    } catch (error) {
      if (generation === generationRef.current && !controller.signal.aborted &&
        error?.name !== 'AbortError') {
        setState(current => ({ ...current, key: contextKey,
          status: error?.code === 'forbidden' || error?.code === 'unauthorized'
            ? error.code : 'error', error }));
      }
      return null;
    }
  }, [operationId, assignmentId, enabled, contextKey]);

  useEffect(() => {
    pendingRef.current = null;
    if (!enabled || !operationId || !assignmentId) return undefined;
    void reload({ initial: true });
    const refresh = () => { void reload(); };
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('attendance_draft')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh();
    };
    document.addEventListener('visibilitychange', onVisibility);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    return () => {
      generationRef.current += 1;
      abortRef.current?.abort();
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      document.removeEventListener('visibilitychange', onVisibility);
      void observer.stop();
      pendingRef.current = null;
    };
  }, [reload, enabled, operationId, assignmentId]);

  const send = useCallback(async (intent) => {
    try {
      const receipt = await saveOccAttendanceDraft(operationId, assignmentId,
        intent.request, intent.key);
      if (intent !== pendingRef.current) return null;
      pendingRef.current = null;
      setState(current => ({ ...current, key: contextKey, status: 'ready',
        snapshot: current.snapshot ? { ...current.snapshot, occ: receipt.contribution } : null,
        attempted: null, conflict: false, pending: false, error: null }));
      void reload();
      return receipt;
    } catch (error) {
      if (intent !== pendingRef.current) return null;
      const unknown = error?.code === 'unknown-outcome';
      if (!unknown) pendingRef.current = null;
      setState(current => ({ ...current, key: contextKey,
        attempted: intent.request,
        conflict: error?.code === 'stale-revision',
        pending: unknown,
        error,
      }));
      if (error?.code === 'stale-revision') void reload();
      return null;
    }
  }, [operationId, assignmentId, contextKey, reload]);

  const save = useCallback(async (fields) => {
    if (pendingRef.current) return null;
    const current = state.key === contextKey ? state : null;
    if (!current?.snapshot) return null;
    const intent = {
      key: crypto.randomUUID(),
      request: { expectedRevision: current.snapshot.occ?.revision ?? 0,
        observedStartAt: fields.observedStartAt ?? null,
        observedEndAt: fields.observedEndAt ?? null,
        incidentNote: fields.incidentNote ?? null },
    };
    pendingRef.current = intent;
    setState(previous => ({ ...previous, key: contextKey, pending: false,
      conflict: false, error: null, attempted: intent.request }));
    return send(intent);
  }, [state, contextKey, send]);

  const retryPending = useCallback(async () => pendingRef.current
    ? send(pendingRef.current) : null, [send]);

  const visible = state.key === contextKey ? state : {
    key: contextKey, status: 'loading', snapshot: null, error: null,
    attempted: null, conflict: false, pending: false,
  };
  return { ...visible, save, reload, retryPending };
}
