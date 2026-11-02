import { useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import ServiceClosurePanel from '../contracts/catalog/ServiceClosurePanel';
import { useTranslation } from '../../i18n/LanguageScope';
import { notificationKindLabel, notificationTargetPath } from './notificationKinds';
import { notificationsMessages } from './notificationsMessages';
import useOperationalNotifications from './useOperationalNotifications';
import { NotificationOpenAction, useOperationalNotificationCenter } from '../admin-occ/notifications/OperationalNotificationCenter';
import { occUiMessages } from '../admin-occ/ui/occUiMessages';
import layouts from '../admin-occ/ui/OccModuleLayouts.module.css';

function formatInstant(value, locale) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : date.toLocaleString(locale);
}

export default function CanonicalNotificationsRoute() {
  const center = useOperationalNotificationCenter();
  return center ? <NotificationHistory center={center} /> : <StandaloneHistory />;
}

// Keeps the route usable in isolated consumers/tests without mounting a second feed in OCC.
function StandaloneHistory() {
  const { session } = useAuth();
  const center = useOperationalNotifications({ accountId: session?.accountId });
  return <NotificationHistory center={center} />;
}

function NotificationHistory({ center }) {
  const { t, language, locale } = useTranslation(notificationsMessages);
  const { t: ui } = useTranslation(occUiMessages);
  const [busyId, setBusyId] = useState(null);
  const [writeError, setWriteError] = useState('');
  const [section, setSection] = useState('notices');
  const toggleRead = async item => {
    setBusyId(item.id); setWriteError('');
    try { await center.markRead(item.id, !item.readAt); }
    catch { setWriteError(ui('writeError')); }
    finally { setBusyId(null); }
  };
  return <section className="mx-auto max-w-[1100px] space-y-5 text-ink-900 dark:text-text-primary-dark">
    <header data-occ-header className="flex flex-wrap items-center justify-between gap-3">
      <div><h1 className="text-xl font-semibold">{t('title')}</h1><p className="mt-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">{t('subtitle')}</p></div>
      <button type="button" onClick={center.refresh} className="min-h-11 rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600">{t('refresh')}</button>
    </header>
    <div className={layouts.notificationLayout}>
    <aside className={layouts.notificationRail}>
    <nav data-occ-tabs aria-label={t('sections')} className="flex flex-wrap gap-2">
      <button type="button" onClick={() => setSection('notices')} aria-current={section === 'notices' ? 'page' : undefined} className="min-h-11 rounded-lg px-4 text-sm">{t('notices')}</button>
      <button type="button" onClick={() => setSection('services')} aria-current={section === 'services' ? 'page' : undefined} className="min-h-11 rounded-lg px-4 text-sm">{t('services')}</button>
    </nav>
    {center.status === 'success' && <p role="status" className="text-sm text-occ-muted"><strong className="font-mono text-occ-text">{center.count}</strong>{t('unread', { count: center.items.length })}{center.hasMore && <span className="mt-2 block text-xs">{ui('partial')}</span>}</p>}
    </aside>
    <div className={layouts.notificationBody}>
    {section === 'services' ? <ServiceClosurePanel mode="occ" /> : <>
      {center.status === 'loading' && <p role="status" data-occ-surface>{t('loading')}</p>}
      {(center.status === 'error' || center.status === 'forbidden') && <div role="alert" data-occ-surface><p>{center.status === 'forbidden' ? ui('forbidden') : t('error')}</p>{center.status !== 'forbidden' && <button type="button" onClick={center.refresh} className="min-h-11 text-accent-600">{t('retry')}</button>}</div>}
      {center.status === 'success' && <>
        {writeError && <p role="alert" className="text-status-danger">{writeError}</p>}
        {center.items.length === 0 ? <p data-occ-surface>{t('empty')}</p> :
          <ul data-occ-notice-list>{center.items.map(item => {
            const target = center.targetPath ? center.targetPath(item) : notificationTargetPath(item);
            return <li key={item.id} data-occ-surface data-unread={!item.readAt} className="flex flex-wrap items-center justify-between gap-4">
              <div><strong>{notificationKindLabel(item.kind, language)}</strong><p className="mt-1 text-sm">{item.operationCode} · {item.stationCode}</p>
                <time dateTime={item.occurredAt} className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{formatInstant(item.occurredAt, locale)}</time></div>
              <div className="flex flex-wrap gap-2">{target && <NotificationOpenAction item={item} center={{ ...center, targetPath: center.targetPath ?? notificationTargetPath }} className="inline-flex min-h-11 items-center rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white" />}
                <button type="button" disabled={busyId === item.id} onClick={() => void toggleRead(item)} className="min-h-11 rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600 disabled:opacity-50">{item.readAt ? t('markUnread') : t('markRead')}</button></div>
            </li>;
          })}</ul>}
      </>}
    </>}
    </div></div>
  </section>;
}
