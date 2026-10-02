import { useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { getDashboardSnapshot } from '../../services/dashboardService';

export function useDashboardData({ accountId, stationId, stationCode, date,
  refreshToken = 0 }) {
  const scopeKey = `${accountId ?? ''}|${stationId ?? ''}|${stationCode ?? ''}|${date ?? ''}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    status: stationId ? 'loading' : 'forbidden', data: null, scopeKey,
  });

  useEffect(() => {
    if (!accountId || !stationId || !stationCode) {
      setState({ status: 'forbidden', data: null, scopeKey });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null, scopeKey });
    getDashboardSnapshot({ stationId, stationCode, date },
      { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) setState({ status: 'success', data, scopeKey });
      })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: error?.status === 401 ? 'unauthorized' :
          error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error',
        data: null, scopeKey });
      });
    return () => controller.abort();
  }, [accountId, stationId, stationCode, date, scopeKey, refreshToken, revision]);

  useEffect(() => {
    if (!accountId || !stationId) return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('notifications')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 25_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [accountId, stationId]);

  // Effects run after render: never expose a previous account/station's data even for one frame.
  return state.scopeKey === scopeKey
    ? { status: state.status, data: state.data }
    : { status: accountId && stationId && stationCode ? 'loading' : 'forbidden', data: null };
}
