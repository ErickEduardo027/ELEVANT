import { useCallback, useEffect, useMemo, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { getFinanceHomeSnapshot } from '../../../services/financeHomeService';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';

function lastThirtyDays() {
  const to = new Date();
  const from = new Date(to);
  from.setUTCDate(from.getUTCDate() - 29);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

export function useFinanceHomeData(enabled = true) {
  const session = useMemo(() => readSession(), []);
  const stations = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(stations[0]?.stationId ?? '');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: stationId ? 'loading' : 'forbidden',
    data: null, error: null });
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled) return undefined;
    if (!stationId) {
      setState({ status: 'forbidden', data: null, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ status: 'loading', data: null, error: null });
    getFinanceHomeSnapshot({ stationId, ...lastThirtyDays() }, { signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted)
          setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState({ status: error?.status === 403 || error?.status === 404
          ? 'forbidden' : 'error', data: null, error });
      });
    return () => abortForEffectCleanup(controller);
  }, [enabled, stationId, revision]);

  useEffect(() => {
    if (!enabled || !session?.accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('finance_approved_services') ||
        resources.includes('finance_preinvoices')) refresh();
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
  }, [enabled, session?.accountId, refresh]);

  return { ...state, stations, stationId, setStationId, refresh };
}
