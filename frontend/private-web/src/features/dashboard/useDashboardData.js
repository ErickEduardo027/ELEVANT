import { useEffect, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { getDashboardSnapshot } from '../../services/dashboardService';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const DENIED = new Set([401, 403, 404]);

function statusForError(error) {
  if (error?.status === 401) return 'unauthorized';
  return error?.status === 403 || error?.status === 404 ? 'forbidden' : 'error';
}

// Las revalidaciones del mismo alcance conservan los datos visibles
// (`refreshing`) para que la consola no se vacíe cada 25 s. Un cambio de
// cuenta, estación o fecha, o una respuesta 401/403/404, sí los descarta.
export function useDashboardData({ accountId, stationId, stationCode, date,
  refreshToken = 0 }) {
  const scopeKey = `${accountId ?? ''}|${stationId ?? ''}|${stationCode ?? ''}|${date ?? ''}`;
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({
    status: stationId ? 'loading' : 'forbidden', data: null, scopeKey,
    refreshing: false, refreshFailed: false, fetchedAt: null,
  });

  useEffect(() => {
    if (!accountId || !stationId || !stationCode) {
      setState({ status: 'forbidden', data: null, scopeKey, refreshing: false, refreshFailed: false, fetchedAt: null });
      return undefined;
    }
    const controller = new AbortController();
    setState(previous => (previous.scopeKey === scopeKey && previous.data
      ? { ...previous, refreshing: true }
      : { status: 'loading', data: null, scopeKey, refreshing: false, refreshFailed: false, fetchedAt: null }));
    getDashboardSnapshot({ stationId, stationCode, date },
      { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        setState({ status: 'success', data, scopeKey, refreshing: false, refreshFailed: false,
          fetchedAt: new Date().toISOString() });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState(previous => (!DENIED.has(error?.status) && previous.scopeKey === scopeKey && previous.data
          ? { ...previous, refreshing: false, refreshFailed: true }
          : { status: statusForError(error), data: null, scopeKey, refreshing: false, refreshFailed: false, fetchedAt: null }));
      });
    return () => abortForEffectCleanup(controller);
  }, [accountId, stationId, stationCode, date, scopeKey, refreshToken, revision]);

  useEffect(() => {
    if (!accountId || !stationId) return undefined;
    const refresh = () => setRevision(value => value + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('notifications') || resources.includes('occ_planning')) refresh();
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
  if (state.scopeKey !== scopeKey) {
    return { status: accountId && stationId && stationCode ? 'loading' : 'forbidden', data: null,
      refreshing: false, refreshFailed: false, fetchedAt: null };
  }
  return { status: state.status, data: state.data, refreshing: state.refreshing,
    refreshFailed: state.refreshFailed, fetchedAt: state.fetchedAt };
}
