import { useEffect, useMemo, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { loadOccReviewQueue } from '../../services/occReviewService';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function useOccReviewQueue() {
  const { session } = useAuth();
  const stationScopes = useMemo(() => (Array.isArray(session?.stationScopes) ? session.stationScopes : [])
    .filter(scope => UUID.test(scope?.stationId ?? '') && typeof scope.stationCode === 'string'),
  [session?.stationScopes]);
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [retry, setRetry] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    if (!stationScopes.some(scope => scope.stationId === stationId)) {
      setStationId(stationScopes[0]?.stationId ?? '');
    }
  }, [stationId, stationScopes]);

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
        if (!controller.signal.aborted) setState({ status: 'error', data: null, error });
      });
    return () => controller.abort();
  }, [stationId, stationScopes, retry]);

  return {
    stationScopes, stationId, setStationId,
    ...state, refresh: () => setRetry(value => value + 1),
  };
}
