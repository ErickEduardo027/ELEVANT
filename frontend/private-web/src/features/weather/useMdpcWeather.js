import { useCallback, useEffect, useState } from 'react';
import { loadCurrentObservation } from '../../services/weatherService';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';

const POLL_MS = 10 * 60_000;
// El METAR rutinario de MDPC es horario: pasados 75 minutos falta al menos un reporte. Es un
// criterio de frescura del dato, no un umbral meteorológico ni operacional.
export const STALE_AFTER_MINUTES = 75;

export function observationAgeMinutes(observedAt, now = Date.now()) {
  const time = Date.parse(observedAt ?? '');
  return Number.isNaN(time) ? null : Math.max(0, Math.floor((now - time) / 60_000));
}

export function isObservationStale(observedAt, now = Date.now()) {
  const age = observationAgeMinutes(observedAt, now);
  return age == null || age > STALE_AFTER_MINUTES;
}

// Conserva la última observación válida si una revalidación falla y lo indica con
// `refreshFailed`; nunca sustituye datos ausentes por valores supuestos.
export function useMdpcWeather({ enabled = true } = {}) {
  const [revision, setRevision] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null, fetchedAt: null, refreshFailed: false, refreshing: false });
  const refresh = useCallback(() => {
    setState(previous => (previous.data ? { ...previous, refreshing: true } : { ...previous, status: 'loading' }));
    setRevision(value => value + 1);
  }, []);

  useEffect(() => {
    if (!enabled) return undefined;
    const controller = new AbortController();
    loadCurrentObservation({ signal: controller.signal })
      .then(data => {
        if (!controller.signal.aborted) {
          setState({ status: 'success', data, fetchedAt: new Date().toISOString(), refreshFailed: false, refreshing: false });
        }
      })
      .catch(error => {
        if (controller.signal.aborted || isAbortError(error)) return;
        setState(previous => (previous.data
          ? { ...previous, refreshing: false, refreshFailed: true }
          : { status: 'error', data: null, fetchedAt: null, refreshFailed: false, refreshing: false }));
      });
    return () => abortForEffectCleanup(controller);
  }, [enabled, revision]);

  useEffect(() => {
    if (!enabled) return undefined;
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, POLL_MS);
    window.addEventListener('online', refresh);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('online', refresh);
    };
  }, [enabled, refresh]);

  return { ...state, refresh };
}
