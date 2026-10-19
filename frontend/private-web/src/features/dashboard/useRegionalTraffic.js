import { useCallback, useEffect, useState } from 'react';
import { loadRegionalTraffic } from '../../services/trafficService';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const POLL_MS = 120_000;

export function useRegionalTraffic({ stationId, enabled = true } = {}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null });
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !stationId) return undefined;
    const controller = new AbortController();
    loadRegionalTraffic(stationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error))
          setState({ status: error.code === 'forbidden' || error.code === 'unauthorized'
            ? error.code : 'error', data: null });
      });
    return () => abortForEffectCleanup(controller);
  }, [enabled, revision, stationId]);

  useEffect(() => {
    if (!enabled || !stationId) return undefined;
    const onVisible = () => { if (document.visibilityState === 'visible') refresh(); };
    const poll = window.setInterval(onVisible, POLL_MS);
    window.addEventListener('online', onVisible);
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('online', onVisible);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [enabled, refresh, stationId]);

  return { ...state, refresh };
}
