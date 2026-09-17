import { useCallback, useEffect, useRef, useState } from 'react';
import { assignPlanningOperation } from '../../services/planningService';

const IDLE_STATE = {
  status: 'idle',
  data: null,
  error: null,
  reason: null,
  refreshRequired: false,
};
const ASSIGNMENT_TIMEOUT_MS = 20_000;

export function usePlanningAssignment() {
  const [state, setState] = useState(IDLE_STATE);
  const activeControllerRef = useRef(null);
  const pendingPromiseRef = useRef(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const reset = useCallback(() => {
    if (pendingPromiseRef.current) return false;
    activeControllerRef.current = null;
    setState(IDLE_STATE);
    return true;
  }, []);

  const assign = useCallback(({ turnaroundId, agentId, etag }) => {
    if (pendingPromiseRef.current) return pendingPromiseRef.current;

    const controller = new AbortController();
    activeControllerRef.current = controller;
    const timeoutId = globalThis.setTimeout(() => controller.abort(), ASSIGNMENT_TIMEOUT_MS);
    setState({
      status: 'submitting',
      data: null,
      error: null,
      reason: null,
      refreshRequired: false,
    });

    const pendingPromise = assignPlanningOperation(turnaroundId, agentId, etag, {
      signal: controller.signal,
    })
      .then(data => {
        if (!mountedRef.current) return { ok: true, data, detached: true };

        setState({
          status: 'success',
          data,
          error: null,
          reason: null,
          refreshRequired: false,
        });
        return { ok: true, data };
      })
      .catch(error => {
        const reason = typeof error?.code === 'string' ? error.code : 'unknown-outcome';
        const refreshRequired =
          error?.refreshRequired === true || reason === 'unknown-outcome';
        if (!mountedRef.current) {
          return { ok: false, error, reason, refreshRequired, detached: true };
        }
        setState({
          status: 'error',
          data: null,
          error,
          reason,
          refreshRequired,
        });
        return { ok: false, error, reason, refreshRequired };
      })
      .finally(() => {
        globalThis.clearTimeout(timeoutId);
        if (pendingPromiseRef.current === pendingPromise) {
          pendingPromiseRef.current = null;
        }
        if (activeControllerRef.current === controller) {
          activeControllerRef.current = null;
        }
      });

    pendingPromiseRef.current = pendingPromise;
    return pendingPromise;
  }, []);

  return { ...state, assign, reset };
}
