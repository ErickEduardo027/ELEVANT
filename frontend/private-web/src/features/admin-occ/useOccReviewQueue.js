import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadOccReviewQueue } from '../../services/occReviewService';
import { selectOccStationScopes } from './useOccStation';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A counter that moves each time the account-change feed announces `occ_review` (ADR-0029, 3-N23): a hand-off, a
 * decision, a reopening, an incident or late evidence of the account's stations. The screen re-reads what it shows
 * when it changes, under the permissions it has now; the feed only says that something changed. Zero until the first
 * announcement, so the first read stays the screen's own.
 */
export function useOccReviewChangeVersion() {
  const { session } = useAuth();
  const [version, setVersion] = useState(0);

  useEffect(() => {
    if (!UUID.test(session?.accountId ?? '')) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('occ_review')) setVersion(value => value + 1);
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [session?.accountId]);

  return version;
}

export function useOccReviewQueue() {
  const { session } = useAuth();
  const stationScopes = useMemo(() => selectOccStationScopes(session?.stationScopes)
    .filter(scope => UUID.test(scope.stationId)),
  [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [retry, setRetry] = useState(0);
  const live = useOccReviewChangeVersion();
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!stationScopes.some(scope => scope.stationId === stationId)) {
      setStationId(stationScopes[0]?.stationId ?? '');
    }
  }, [stationId, stationScopes]);

  // A live re-read keeps the current list on screen; only a scope change or retry shows loading.
  useEffect(() => {
    if (live === 0 || !stationId) return undefined;
    const controller = new AbortController();
    loadOccReviewQueue(stationId, { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', data, error: null }); })
      .catch(() => {});
    return () => abortForEffectCleanup(controller);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live]);

  useEffect(() => {
    if (!stationId || !stationScopes.some(scope => scope.stationId === stationId)) {
      setState({ status: 'empty-scope', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });
    loadOccReviewQueue(stationId, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!controller.signal.aborted && !isAbortError(error)) setState({ status: 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [stationId, stationScopes, retry]);

  return {
    stationScopes, stationId, setStationId,
    ...state, refresh: () => setRetry(value => value + 1),
  };
}
