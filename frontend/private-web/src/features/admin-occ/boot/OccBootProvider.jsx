'use client';

import { useCallback, useEffect, useMemo, useReducer, useSyncExternalStore } from 'react';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { useAuth } from '../../auth/AuthContext';
import { normalizeRole, ROLE_KEYS } from '../../auth/roleRouting';
import { DEFAULT_LANGUAGE, getLanguage, subscribeLanguage } from '../../../i18n/languageStore';
import { OccBootContext, OccBootSignalContext, useOccBootSignal } from './occBootContext';
import {
  initialOccBoot, isOccBootVisible, occBootAnnouncement, occBootProgress, OCC_BOOT_EXIT_MS,
  OCC_BOOT_READY_TIMEOUT_MS, reduceOccBoot,
} from './occBootMachine';
import { occBootMessages } from './occBootMessages';
import { hasSeenOccBoot, markOccBootSeen } from './occBootSession';
import OccBootScreen from './OccBootScreen';

// What OccBootAccessSignal may report through the internal channel.
const SIGNAL_EVENTS = new Set(['sessionChecked', 'accessLoaded', 'accessFailed']);

/**
 * The OCC boot screen (contratos 2.6). RoleLayout mounts it once for the OCC, around the session and access gates, so it
 * survives both loading phases while their plain status screens keep rendering underneath. The server render and the
 * hydration render it hidden; on the client it shows on the first OCC entry after each login, stays until the
 * department access is loaded (no time limit), then until the first screen reports ready (useOccBoot().markReady) or
 * `timeoutMs` pass, and leaves in `exitMs`. The AccessGate error ends it at once.
 */
export function OccBootProvider({ children, timeoutMs = OCC_BOOT_READY_TIMEOUT_MS, exitMs = OCC_BOOT_EXIT_MS }) {
  const { session, ready } = useAuth();
  const [state, dispatch] = useReducer(reduceOccBoot, undefined, initialOccBoot);
  // Above AdminOccLayout's LanguageScope: the stored language, read as AccessGate reads it.
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => DEFAULT_LANGUAGE);
  const { phase } = state;
  const deciding = phase === 'hidden';
  const signedIn = Boolean(ready && session);
  const role = normalizeRole(session?.role);
  const accountId = session?.accountId;

  // The decision, taken once on the client: an OCC account that has not seen the screen in this tab since its login.
  useEffect(() => {
    if (!deciding || !signedIn) return;
    if (role !== ROLE_KEYS.ADMIN_OCC || hasSeenOccBoot(accountId)) {
      dispatch({ type: 'skip' });
      return;
    }
    markOccBootSeen(accountId);
    dispatch({ type: 'show' });
  }, [accountId, deciding, role, signedIn]);

  // The wait for the first screen starts only once the access is loaded.
  useEffect(() => {
    if (phase !== 'waitingReady') return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'timeout' }), timeoutMs);
    return () => window.clearTimeout(timer);
  }, [phase, timeoutMs]);

  // A timer, not transitionend: the exit ends on time even when nothing animates (reduced motion, a hidden tab).
  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const timer = window.setTimeout(() => dispatch({ type: 'exitEnd' }), exitMs);
    return () => window.clearTimeout(timer);
  }, [exitMs, phase]);

  const markReady = useCallback(source => dispatch({ type: 'ready', source }), []);
  const boot = useMemo(() => ({ markReady }), [markReady]);
  const signal = useMemo(() => ({
    report: event => { if (SIGNAL_EVENTS.has(event?.type)) dispatch({ type: event.type }); },
  }), []);

  const announcement = occBootAnnouncement(state);
  const text = occBootMessages[language] ?? occBootMessages[DEFAULT_LANGUAGE];
  return (
    <OccBootContext.Provider value={boot}>
      <OccBootSignalContext.Provider value={signal}>
        {children}
        {isOccBootVisible(state) ? <OccBootScreen phase={phase} progress={occBootProgress(state)} /> : null}
        {/* Outside the screen's aria-hidden tree, and not a second role="status" over the gates' own. */}
        <p data-occ-boot-announcer="" aria-live="polite" lang={language} className="sr-only">
          {announcement ? text[announcement] : ''}
        </p>
      </OccBootSignalContext.Provider>
    </OccBootContext.Provider>
  );
}

/**
 * Mounted by RoleLayout inside the session gate and the access provider, next to AccessGate: being mounted means the
 * session was checked; then it reports the department access, loaded or failed. It renders nothing, and outside
 * OccBootProvider it reports nothing.
 */
export function OccBootAccessSignal() {
  const { status } = useDepartmentAccess();
  const signal = useOccBootSignal();

  useEffect(() => {
    signal?.report({ type: 'sessionChecked' });
  }, [signal]);

  useEffect(() => {
    if (status === 'ready') signal?.report({ type: 'accessLoaded' });
    else if (status === 'error') signal?.report({ type: 'accessFailed' });
  }, [signal, status]);

  return null;
}
