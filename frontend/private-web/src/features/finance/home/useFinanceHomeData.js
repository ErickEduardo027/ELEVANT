import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { readSession } from '../../auth/authService';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { financeHomeMessage } from '../../../services/financeErrors';
import { getFinanceHomeSnapshot, isEmptyFinanceHome } from '../../../services/financeHomeService';
import { abortForEffectCleanup, isAbortError } from '../../../lib/abort';

/** Hints that move an indicator of «Inicio»: approvals and issued invoices, and receipts or card payments. */
const HOME_RESOURCES = ['finance_approved_services', 'finance_receipts'];

const initialState = stationId => ({ status: stationId ? 'loading' : 'no-station', data: null, error: '',
  refreshing: false });

/**
 * «Inicio» of Finance (phase 4, block B, 4-A and 4-N02). `status` is 'no-station' when the session grants no
 * Finance station, 'loading' on the first read, 'success', 'empty' when the template includes none of the modules
 * «Inicio» summarizes, 'forbidden' on a 403 and 'error' (recoverable, `error` says why in Spanish) otherwise.
 * A revalidation (realtime hint, focus, network back or the 25-second fallback) keeps the visible indicators with
 * `refreshing`; when it fails they stay on screen with `error`.
 */
export function useFinanceHomeData(enabled = true) {
  const session = useMemo(() => readSession(), []);
  const stations = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode), [session]);
  const [stationId, setStationId] = useState(stations[0]?.stationId ?? '');
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState(() => initialState(stationId));
  /** The station the visible indicators belong to: another station never shows them while it loads. */
  const shownStation = useRef('');
  const refresh = useCallback(() => setRevision(value => value + 1), []);

  useEffect(() => {
    if (!enabled || !stationId) {
      shownStation.current = '';
      return undefined;
    }
    const controller = new AbortController();
    setState(current => (current.data && shownStation.current === stationId
      ? { ...current, refreshing: true }
      : initialState(stationId)));
    getFinanceHomeSnapshot({ stationId }, { signal: controller.signal })
      .then(data => {
        if (controller.signal.aborted) return;
        shownStation.current = stationId;
        setState({ status: isEmptyFinanceHome(data) ? 'empty' : 'success', data, error: '', refreshing: false });
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        if (error?.status === 403) {
          shownStation.current = '';
          setState({ status: 'forbidden', data: null, error: financeHomeMessage(error), refreshing: false });
          return;
        }
        const message = financeHomeMessage(error);
        setState(current => (current.data && shownStation.current === stationId
          ? { ...current, error: message, refreshing: false }
          : { status: 'error', data: null, error: message, refreshing: false }));
      });
    return () => abortForEffectCleanup(controller);
  }, [enabled, stationId, revision]);

  useEffect(() => {
    if (!enabled || !session?.accountId) return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => HOME_RESOURCES.includes(resource))) refresh();
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

  // Without a Finance station nothing is read: the state is derived, never set from an effect.
  return { ...(stationId ? state : initialState('')), stations, stationId, setStationId, refresh };
}
