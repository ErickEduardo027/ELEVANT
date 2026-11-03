'use client';

import { createContext, useCallback, useContext, useEffect, useId, useLayoutEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '../../auth/AuthContext';
import useOperationalNotifications from '../../notifications/useOperationalNotifications';
import { notificationKindLabel, notificationTargetPath } from '../../notifications/notificationKinds';
import { BellIcon, XIcon } from '../../shell/components/icons';
import { useTranslation } from '../../../i18n/LanguageScope';
import { occUiMessages } from '../ui/occUiMessages';
import styles from '../ui/OccWorkspace.module.css';

const OperationalContext = createContext(null);
export const useOperationalNotificationCenter = () => useContext(OperationalContext);

export function OperationalNotificationProvider({ enabled, navigation, children }) {
  const { session } = useAuth();
  const scope = `${session?.accountId ?? ''}|${enabled}`;
  const [arrivals, setArrivals] = useState({ scope, items: [] });
  const currentScope = useRef(scope);
  useLayoutEffect(() => {
    currentScope.current = scope;
    return () => { currentScope.current = null; };
  }, [scope]);
  // Discard the old account's queue instead of making it reappear on a later return.
  if (arrivals.scope !== scope) setArrivals({ scope, items: [] });
  const onArrive = useCallback(items => setArrivals(previous => ({ scope,
    items: [...(previous.scope === scope ? previous.items : []), ...items],
  })), [scope]);
  const state = useOperationalNotifications({ accountId: session?.accountId, enabled, onArrive });
  if (state.status === 'forbidden' && arrivals.items.length) setArrivals({ scope, items: [] });
  const dismiss = useCallback(ids => setArrivals(previous => previous.scope !== scope ? previous : ({ ...previous,
    items: previous.items.filter(item => !ids.includes(item.id)),
  })), [scope]);
  const markRead = async (id, read = true) => {
    const updated = await state.markRead(id, read);
    if (read) dismiss([id]);
    return updated;
  };
  const targetPath = item => {
    if (!item.operationId) return null;
    const path = notificationTargetPath(item);
    return navigation.some(entry => entry.path === path.split('?')[0]) ? path : null;
  };
  const pending = enabled && state.status !== 'forbidden' && arrivals.scope === scope ? arrivals.items : [];
  const activate = async item => {
    const path = targetPath(item);
    if (!path) return null;
    if (!item.readAt) await markRead(item.id, true);
    return currentScope.current === scope ? path : null;
  };
  const actions = { targetPath, activate };
  const center = { ...state, markRead, ...actions, ui: <OperationalToasts items={pending} dismiss={dismiss} targetPath={targetPath} actions={actions} /> };
  return <OperationalContext.Provider value={center}>{children}</OperationalContext.Provider>;
}

function Instant({ value }) {
  const { locale } = useTranslation(occUiMessages);
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : <time dateTime={value}>{date.toLocaleString(locale, { dateStyle: 'short', timeStyle: 'short' })}</time>;
}

/** A read receipt is confirmed before navigation; failures leave the pending item visible. */
export function NotificationOpenAction({ item, center, onOpened, className }) {
  const router = useRouter();
  const { t } = useTranslation(occUiMessages);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const lock = useRef(false);
  const target = center.targetPath?.(item);
  if (!target) return <span className="text-xs text-occ-muted">{t('destinationUnavailable')}</span>;
  const open = async () => {
    if (lock.current) return;
    lock.current = true; setBusy(true); setError(false);
    try {
      let path;
      if (center.activate) path = await center.activate(item);
      else { if (!item.readAt) await center.markRead(item.id, true); path = target; }
      if (path) { onOpened?.(); router.push(path); }
    } catch { setError(true); }
    finally { lock.current = false; setBusy(false); }
  };
  return <><button type="button" className={className} disabled={busy} aria-busy={busy} onClick={() => void open()}>{t('open')}</button>{error && <span role="alert" className="text-xs text-status-danger">{t('writeError')}</span>}</>;
}

export function OccNotificationBell({ center }) {
  const { t, language } = useTranslation(occUiMessages);
  const [open, setOpen] = useState(false);
  const [busyIds, setBusyIds] = useState(() => new Set());
  const [writeError, setWriteError] = useState(false);
  const anchor = useRef(null);
  const trigger = useRef(null);
  const panel = useRef(null);
  const id = useId();
  const unreadItems = center.items.filter(item => !item.readAt);
  const close = useCallback(() => { setOpen(false); trigger.current?.focus(); }, []);
  useEffect(() => {
    if (!open) return undefined;
    panel.current?.querySelector('button, a')?.focus();
    const outside = event => { if (!anchor.current?.contains(event.target)) setOpen(false); };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); close(); } };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', key); };
  }, [close, open]);
  async function mark(item) {
    setBusyIds(previous => new Set(previous).add(item.id)); setWriteError(false);
    try {
      await center.markRead(item.id, true);
      requestAnimationFrame(() => {
        if (panel.current && document.activeElement === document.body) panel.current.querySelector('button, a')?.focus();
      });
    }
    catch { setWriteError(true); }
    finally { setBusyIds(previous => new Set([...previous].filter(id => id !== item.id))); }
  }
  return <div ref={anchor} className="relative">
    <button ref={trigger} type="button" aria-label={center.status === 'success' ? `${t('notifications')}, ${t('recentUnread', { count: center.count })}` : t('notifications')}
      aria-expanded={open} aria-haspopup="dialog" aria-controls={open ? id : undefined} onClick={() => setOpen(value => !value)}
      className="relative flex h-9 w-9 items-center justify-center rounded-md text-occ-text hover:bg-occ-panel-muted">
      <BellIcon className="h-[18px] w-[18px]" />
      {center.count > 0 && <span data-testid="notifications-badge" aria-hidden="true" className="absolute right-0 top-0 flex h-4 min-w-4 items-center justify-center rounded-full bg-signal-500 px-1 font-mono text-[10px] font-semibold text-ink-900">{center.count > 99 ? '99+' : center.count}</span>}
    </button>
    {open && <section ref={panel} id={id} role="dialog" data-occ-floating aria-label={t('notifications')} className={`${styles.floating} ${styles.popover}`}>
      <header className={styles.noticeHeader}><div><h2>{t('notifications')}</h2>{center.status === 'success' && <p className={styles.noticeMeta}>{t('recentUnread', { count: center.count })}</p>}</div>
        <button type="button" onClick={close} aria-label={t('close')} className={styles.close}><XIcon className="h-4 w-4" /></button></header>
      {center.status === 'loading' && <p role="status" className={styles.state}>{t('loadingNotices')}</p>}
      {(center.status === 'error' || center.status === 'forbidden') && <div role="alert" className={styles.state}><p>{t(center.status === 'forbidden' ? 'forbidden' : 'error')}</p>{center.status !== 'forbidden' && <button type="button" onClick={center.refresh} className="mt-2 font-semibold text-occ-accent">{t('retry')}</button>}</div>}
      {center.status === 'success' && !unreadItems.length && <p className={styles.state}>{t('empty')}</p>}
      {center.status === 'success' && <ul className={styles.noticeList}>{unreadItems.slice(0, 8).map(item => {
        return <li key={item.id} className={styles.notice} data-unread={!item.readAt}>
          <h3>{notificationKindLabel(item.kind, language)}</h3><p className="mt-1 text-sm">{item.operationCode} · {item.stationCode}</p>
          <p className={styles.noticeMeta}><Instant value={item.occurredAt} /></p>
          <div className={styles.noticeActions}><NotificationOpenAction item={item} center={center} onOpened={() => setOpen(false)} />
            <button type="button" disabled={busyIds.has(item.id)} aria-busy={busyIds.has(item.id)} onClick={() => void mark(item)}>{t('read')}</button></div>
        </li>;
      })}</ul>}
      {writeError && <p role="alert" className="px-4 py-2 text-sm text-status-danger">{t('writeError')}</p>}
      <footer className="border-t border-occ-line p-4"><Link href="/admin-occ/notifications" onClick={() => setOpen(false)} className="text-sm font-semibold text-occ-accent">{t('notificationHistory')}</Link>
        {center.hasMore && <p className={`${styles.noticeMeta} mt-2`}>{t('partial')}</p>}</footer>
    </section>}
  </div>;
}

function ArrivalToast({ item, overflow, ids, dismiss, targetPath, actions }) {
  const { t, language } = useTranslation(occUiMessages);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(8000);
  const dismissRef = useRef(() => dismiss(ids));
  useEffect(() => { dismissRef.current = () => dismiss(ids); }, [dismiss, ids]);
  useEffect(() => {
    if (hovered || focused) return undefined;
    const started = Date.now();
    const timer = window.setTimeout(() => dismissRef.current(), remaining.current);
    return () => { window.clearTimeout(timer); remaining.current = Math.max(0, remaining.current - (Date.now() - started)); };
  }, [hovered, focused]);
  const path = item ? targetPath(item) : '/admin-occ/notifications';
  return <div role="status" data-occ-floating className={`${styles.floating} ${styles.toast}`} onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusCapture={() => setFocused(true)} onBlurCapture={event => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false); }}>
    <button type="button" aria-label={t('close')} className={`${styles.close} ${styles.closeToast}`} onClick={() => dismiss(ids)}><XIcon className="h-4 w-4" /></button>
    <p className="pr-7 text-sm font-semibold">{item ? notificationKindLabel(item.kind, language) : t('more', { count: overflow })}</p>
    {item && <><p className="mt-1 text-sm">{item.operationCode} · {item.stationCode}</p><p className={styles.noticeMeta}><Instant value={item.occurredAt} /></p></>}
    {path && <div className={styles.noticeActions}>{item ? <NotificationOpenAction item={item} center={actions} onOpened={() => dismiss(ids)} /> : <Link href={path} onClick={() => dismiss(ids)}>{t('view')}</Link>}</div>}
  </div>;
}

function OperationalToasts({ items, dismiss, targetPath, actions }) {
  if (!items.length) return null;
  const visible = items.length > 3 ? items.slice(0, 2) : items;
  const rest = items.slice(visible.length);
  return <div className={styles.toastStack} aria-live="polite" aria-relevant="additions">
    {visible.map(item => <ArrivalToast key={item.id} item={item} ids={[item.id]} dismiss={dismiss} targetPath={targetPath} actions={actions} />)}
    {rest.length > 0 && <ArrivalToast key={`more-${rest[0].id}`} overflow={rest.length} ids={rest.map(item => item.id)} dismiss={dismiss} targetPath={targetPath} />}
  </div>;
}
