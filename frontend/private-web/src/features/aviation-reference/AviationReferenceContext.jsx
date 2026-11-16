'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { abortForEffectCleanup, isAbortError } from '../../lib/abort';
import { aviationReferenceService } from '../../services/aviationReferenceService';

// The source of the AeroDataBox reference reads for the components under it (ADR-0028, note of 15 November 2026): the
// page passes services/aviationReferenceService.js (or the lab and the tests a simulated adapter). Without a provider
// the components show nothing and send nothing, so a map or a card mounted elsewhere never reaches the API by itself.

const AviationReferenceContext = createContext(null);

export function AviationReferenceProvider({ service, children }) {
  return <AviationReferenceContext.Provider value={service ?? null}>{children}</AviationReferenceContext.Provider>;
}

/** The adapter of the nearest provider, or null. */
export function useAviationReferenceService() {
  return useContext(AviationReferenceContext);
}

const IDLE = Object.freeze({ status: 'idle', data: null, error: null });

/**
 * One reference read while `key` names it (null sends nothing): `{ status, data, error }` with status `idle`, `loading`,
 * `success`, `error` or `forbidden`. `load({ signal })` asks the adapter; it is asked again when `key` changes. With
 * `keep`, a re-read of the same subject (a refresh) keeps the last value on screen until the new one comes.
 */
export function useAviationReferenceRead(key, load, { keep = false } = {}) {
  const [state, setState] = useState(IDLE);
  useEffect(() => {
    if (key === null || typeof load !== 'function') {
      setState(IDLE);
      return undefined;
    }
    const controller = new AbortController();
    setState(current => ({ status: 'loading', data: keep ? current.data : null, error: null }));
    load({ signal: controller.signal }).then(data => {
      if (!controller.signal.aborted) setState({ status: 'success', data, error: null });
    }, error => {
      if (controller.signal.aborted || isAbortError(error)) return;
      const refused = error?.status === 401 || error?.status === 403;
      setState({ status: refused ? 'forbidden' : 'error', data: null, error });
    });
    return () => abortForEffectCleanup(controller);
    // The key names the read: `load` is a new function on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  return state;
}

/**
 * The provider of a department shell (Contratos, Superadministración) over the API's adapter. Under the unit tests the
 * shells mount without it reading anything, as their account-change observers do (`observeNotifications`).
 */
export function ShellAviationReferenceProvider({ children }) {
  return (
    <AviationReferenceProvider service={process.env.NODE_ENV === 'test' ? null : aviationReferenceService}>
      {children}
    </AviationReferenceProvider>
  );
}
