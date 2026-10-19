import Link from 'next/link';
import { notificationKindLabel, notificationTargetPath } from '../../notifications/notificationKinds';
import ConsolePanel, { PanelLink } from './ConsolePanel';
import { formatTime } from './format';

const MAX_ITEMS = 5;

export default function RecentNotices({ t, language, locale, timeZone, notices, hasMore, className = '' }) {
  return (
    <ConsolePanel className={className} title={t('notices.title')}
      actions={<PanelLink href="/admin-occ/notifications">{t('notices.open')}</PanelLink>}
      bodyClassName="overflow-y-auto">
      {notices.length === 0
        ? <p className="px-4 py-4 text-xs text-occ-muted">{t('notices.empty')}</p>
        : <ul className="divide-y divide-occ-line">
          {notices.slice(0, MAX_ITEMS).map(item => (
            <li key={item.id}>
              <Link href={notificationTargetPath(item)} className="flex items-start gap-3 px-4 py-2 hover:bg-occ-panel-muted">
                <span className={`relative mt-1.5 h-2 w-2 shrink-0 rounded-full ${item.readAt == null ? 'bg-occ-accent' : 'bg-transparent ring-1 ring-occ-line-strong'}`}>
                  {item.readAt == null && <span className="sr-only">{t('notices.unread')}</span>}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] text-occ-text">{notificationKindLabel(item.kind, language)}</span>
                  <span className="block font-mono text-[11px] text-occ-muted">
                    {item.operationCode} · <time dateTime={item.occurredAt}>{formatTime(item.occurredAt, locale, timeZone)}</time>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>}
      {hasMore && <p className="border-t border-occ-line px-4 py-2 text-[11px] text-occ-muted">{t('notices.more')}</p>}
    </ConsolePanel>
  );
}
