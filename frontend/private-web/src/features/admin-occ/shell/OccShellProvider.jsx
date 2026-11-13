'use client';

import { useCallback, useEffect, useMemo, useReducer, useRef, useState, useSyncExternalStore } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../../auth/AuthContext';
import { ACCESS_RESOURCES, useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { useToast } from '../../../hooks/useToast';
import { useTranslation } from '../../../i18n/LanguageScope';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import {
  loadOperationalNotifications, setOperationalNotificationRead,
} from '../../../services/operationalCommunicationService';
import {
  isAlertNotification, isMessageNotification, notificationKindLabel, notificationTargetPath,
} from '../../notifications/notificationKinds';
import { NOTIFICATIONS_REFRESH_EVENT } from '../../notifications/useNotificationBadge';
import { LIVE_FRESH_MS } from '../live/occCadence';
import { liveSourceReports, reduceLive, startLive } from '../live/occLive';
import { createSourceHealthStore, summarizeSources } from '../live/sourceHealth';
import { useOccResource } from '../live/useOccResource';
import { ADMIN_OCC_BASE_PATH } from '../navigation';
import { OccShellChannelContext, OccShellContext, OccShellToastContext } from './occShellContext';
import { occShellMessages } from './occShellMessages';

export {
  useOccShell, useOptionalOccShell, useOccShellChannel, useOptionalOccShellChannel,
} from './occShellContext';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const NOTIFICATIONS_PATH = `${ADMIN_OCC_BASE_PATH}/notifications`;
const NOTICES_PERMISSION = 'operations.notifications.read';
const NOTICE_RESOURCES = Object.freeze(['notifications']);
// Without a live socket the state can change with time alone; this re-evaluates it.
const LIVE_TICK_MS = 10_000;
const NO_NOTICES = Object.freeze([]);

const isOnline = () => typeof navigator === 'undefined' || navigator.onLine !== false;
const hasNoNotices = data => (data?.notifications ?? []).length === 0;

/**
 * The unread notices of `items` the account had not seen (`seen`, the ids of the last read). The first read only
 * learns the ids: opening the OCC never replays old alerts.
 */
export function arrivalsSince(seen, items) {
  const ids = new Set(items.map(item => item.id));
  return { seen: ids, arrived: seen ? items.filter(item => !item.readAt && !seen.has(item.id)) : [] };
}

/**
 * The toasts for new notices, as AppShell showed them before the shell owned them: no message toast while the chat
 * is open (it shows them itself), at most three, then one summary; an alert stays 15 s and its action is «Abrir».
 */
export function arrivalToasts(arrived, { pathname = '', t, language = 'es' }) {
  const fresh = pathname.includes('/chat') ? arrived.filter(item => !isMessageNotification(item.kind)) : arrived;
  const toasts = fresh.slice(0, 3).map(item => {
    const alert = isAlertNotification(item.kind);
    return { message: `${notificationKindLabel(item.kind, language)} · ${item.operationCode}`,
      tone: alert ? 'danger' : 'info', durationMs: alert ? 15_000 : 8_000,
      action: { label: t('arrivals.open'), path: notificationTargetPath(item) } };
  });
  if (fresh.length > 3) toasts.push({ message: t('arrivals.more', { count: fresh.length - 3 }), tone: 'info',
    durationMs: 8_000, action: { label: t('arrivals.viewAll'), path: NOTIFICATIONS_PATH } });
  return toasts;
}

/**
 * The OCC tab's single account-change observer, its live link and its source list. Announcements reach the
 * subscribers of their resource only; one that throws does not stop the others.
 */
function OccLiveLayer({ createObserver, observe, children }) {
  const { session } = useAuth();
  const { refresh: refreshAccess } = useDepartmentAccess();
  const accountId = UUID.test(session?.accountId ?? '') ? session.accountId : null;
  const observing = Boolean(observe && accountId);
  const channels = useRef(new Map());
  const [store] = useState(createSourceHealthStore);
  const sourceItems = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
  const [record, dispatch] = useReducer(reduceLive, undefined, () => startLive(Date.now(), { online: isOnline() }));

  const subscribe = useCallback((resources, onChange) => {
    const entry = { onChange };
    const keys = [...new Set(resources)];
    for (const key of keys) {
      if (!channels.current.has(key)) channels.current.set(key, new Set());
      channels.current.get(key).add(entry);
    }
    return () => {
      for (const key of keys) {
        const entries = channels.current.get(key);
        entries?.delete(entry);
        if (entries?.size === 0) channels.current.delete(key);
      }
    };
  }, []);

  const deliver = useCallback(resources => {
    // Each subscriber hears once per page, with the resources of it that it listens to.
    const due = new Map();
    for (const resource of resources) {
      for (const entry of channels.current.get(resource) ?? []) {
        if (!due.has(entry)) due.set(entry, []);
        due.get(entry).push(resource);
      }
    }
    for (const [entry, matched] of due) {
      try { entry.onChange(matched); } catch { /* One failing subscriber must not starve the others. */ }
    }
  }, []);

  useEffect(() => {
    if (!observing) return undefined;
    dispatch({ type: 'restart', now: Date.now() });
    const observer = createObserver(deliver, {
      onStatus: status => dispatch({ type: 'status', status, now: Date.now() }),
    });
    void Promise.resolve(observer.start()).catch(() => {});
    return () => { void Promise.resolve(observer.stop()).catch(() => {}); };
  }, [accountId, createObserver, deliver, observing]);

  useEffect(() => {
    const update = () => dispatch({ type: 'online', online: isOnline(), now: Date.now() });
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => {
      window.removeEventListener('online', update);
      window.removeEventListener('offline', update);
    };
  }, []);

  // Time alone moves the state: every 10 s while not live (without an observer it ends «offline» once the grace is
  // over), and once when a live answer grows stale.
  const currentState = record.live.state;
  const { lastOkAt } = record;
  useEffect(() => {
    const tick = () => dispatch({ type: 'tick', now: Date.now() });
    if (currentState !== 'live') {
      const timer = window.setInterval(tick, LIVE_TICK_MS);
      return () => window.clearInterval(timer);
    }
    const timer = window.setTimeout(tick, Math.max(0, (lastOkAt ?? 0) + LIVE_FRESH_MS - Date.now()) + 1);
    return () => window.clearTimeout(timer);
  }, [currentState, lastOkAt]);

  useEffect(() => {
    const reports = liveSourceReports(record);
    store.report('elevant', reports.elevant);
    store.report('realtime', reports.realtime);
  }, [record, store]);

  // A change to the account's users or access requests can change what it may do (DepartmentAccessProvider leaves
  // its own observer off in the OCC and listens here).
  useEffect(() => subscribe(ACCESS_RESOURCES, () => { void refreshAccess(); }), [refreshAccess, subscribe]);

  const channel = useMemo(() => ({ subscribe, sources: { report: store.report, remove: store.remove } }),
    [store, subscribe]);
  const summary = useMemo(() => summarizeSources(sourceItems), [sourceItems]);
  const live = useMemo(() => ({
    live: { state: record.live.state, since: record.live.since, lastOkAt: record.lastOkAt },
    subscribe,
    sources: { items: sourceItems, summary, report: store.report, remove: store.remove },
  }), [record.live, record.lastOkAt, sourceItems, store, subscribe, summary]);

  return (
    <OccShellChannelContext.Provider value={channel}>
      <OccNoticesLayer live={live}>{children}</OccNoticesLayer>
    </OccShellChannelContext.Provider>
  );
}

/**
 * The operational notices, read once for the whole frame on the live layer's observer, and their arrival toasts.
 */
function OccNoticesLayer({ live, children }) {
  const { session } = useAuth();
  const router = useRouter();
  const pathname = usePathname();
  const { t, language } = useTranslation(occShellMessages);
  const { toasts, showToast, dismissToast } = useToast();
  const seen = useRef(null);
  const context = useRef({ pathname, t, language });
  useEffect(() => { context.current = { pathname, t, language }; }, [language, pathname, t]);
  const accountId = session?.accountId ?? '';
  // A new account learns its notices again before any toast.
  useEffect(() => { seen.current = null; }, [accountId]);

  const load = useCallback(async ({ signal }) => {
    const data = await loadOperationalNotifications({ signal });
    if (!signal.aborted) {
      const { seen: ids, arrived } = arrivalsSince(seen.current, data.notifications ?? []);
      seen.current = ids;
      for (const toast of arrivalToasts(arrived, context.current)) {
        showToast(toast.message, toast.tone, toast.durationMs,
          { label: toast.action.label, onClick: () => router.push(toast.action.path) });
      }
    }
    return data;
  }, [router, showToast]);

  const notices = useOccResource({
    key: 'notices', load, permission: NOTICES_PERMISSION, resources: NOTICE_RESOURCES, scopeKey: accountId,
    isEmpty: hasNoNotices,
  });
  const { refresh, retry, setData } = notices;

  // Other modules ask for a new read of the bell after they change a notice.
  useEffect(() => {
    const onRefresh = () => refresh();
    window.addEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh);
    return () => window.removeEventListener(NOTIFICATIONS_REFRESH_EVENT, onRefresh);
  }, [refresh]);

  // «Recibido» is the per-account read receipt; the server's answer replaces the notice.
  const markRead = useCallback(async id => {
    const updated = await setOperationalNotificationRead(id, true);
    setData(data => ({ ...data, notifications: (data.notifications ?? []).map(item => (item.id === id ? updated : item)) }));
    return updated;
  }, [setData]);

  const items = notices.data?.notifications ?? NO_NOTICES;
  const noticesValue = useMemo(() => ({
    status: notices.status, items, hasMore: Boolean(notices.data?.hasMore),
    unreadCount: items.filter(item => !item.readAt).length,
    fetchedAt: notices.fetchedAt, refreshFailed: notices.refreshFailed, refresh, retry, markRead,
  }), [items, markRead, notices.data?.hasMore, notices.fetchedAt, notices.refreshFailed, notices.status, refresh, retry]);

  const value = useMemo(() => ({ ...live, notices: noticesValue }), [live, noticesValue]);
  const toastValue = useMemo(() => ({ toasts, dismissToast }), [dismissToast, toasts]);

  return (
    <OccShellContext.Provider value={value}>
      <OccShellToastContext.Provider value={toastValue}>{children}</OccShellToastContext.Provider>
    </OccShellContext.Provider>
  );
}

/**
 * The OCC frame's provider (design C.1, contracts 2.7): one account-change observer per tab, the live link, the
 * sources' health and the operational notices. `useOccShell()` exposes `{ live, subscribe, notices, sources }`.
 * `createObserver` must be stable; `observe` is off in tests unless a test turns it on.
 */
export function OccShellProvider({ children, createObserver = createPrivateWebAccountChangeObserver,
  observe = process.env.NODE_ENV !== 'test' }) {
  return <OccLiveLayer createObserver={createObserver} observe={observe}>{children}</OccLiveLayer>;
}

export default OccShellProvider;
