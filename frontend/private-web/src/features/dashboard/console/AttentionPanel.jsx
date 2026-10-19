import Link from 'next/link';
import { missingResources } from '../dashboardModel';
import ConsolePanel from './ConsolePanel';
import { formatTime } from './format';

const MAX_ITEMS = 6;

function GroupHeading({ children, count }) {
  return (
    <h3 className="flex items-center justify-between px-4 pb-1 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-occ-muted">
      {children}<span className="font-mono text-xs tracking-normal text-occ-text">{count}</span>
    </h3>
  );
}

function Empty({ children }) {
  return <p className="px-4 pb-3 pt-1 text-xs text-occ-muted">{children}</p>;
}

export default function AttentionPanel({ t, locale, timeZone, pendingReviews, isLowerBound, needsResources, className = '' }) {
  const reviewCount = isLowerBound ? `≥${pendingReviews.length}` : pendingReviews.length;
  return (
    <ConsolePanel className={className} title={t('attention.title')} bodyClassName="overflow-y-auto">
      <GroupHeading count={reviewCount}>{t('attention.reviews')}</GroupHeading>
      {pendingReviews.length === 0
        ? <Empty>{t('attention.reviewsEmpty')}</Empty>
        : <ul className="divide-y divide-occ-line">
          {pendingReviews.slice(0, MAX_ITEMS).map(item => (
            <li key={item.submissionId ?? item.operationId}>
              <Link href={`/admin-occ/review?operationId=${item.operationId}`}
                className="flex items-start gap-3 px-4 py-2 hover:bg-occ-panel-muted">
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-signal-500" />
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-mono text-[13px] font-semibold text-occ-text">{item.operationCode}</span>
                    <span className="text-[11px] font-medium text-occ-text">{t(`attention.reviewStatus.${item.status}`)}</span>
                  </span>
                  <span className="block truncate text-xs text-occ-muted">
                    {item.agentName}
                    {item.submittedAt && <> · {t('attention.submitted', { time: formatTime(item.submittedAt, locale, timeZone) })}</>}
                    {item.incidentCount > 0 && <> · <span className="text-occ-warn">{t('attention.incidents', { count: item.incidentCount })}</span></>}
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>}
      {isLowerBound && <Empty>{t('attention.reviewsMore')}</Empty>}

      <div className="mt-1 border-t border-occ-line" />
      <GroupHeading count={needsResources.length}>{t('attention.resources')}</GroupHeading>
      {needsResources.length === 0
        ? <Empty>{t('attention.resourcesEmpty')}</Empty>
        : <ul className="divide-y divide-occ-line pb-1">
          {needsResources.slice(0, MAX_ITEMS).map(item => (
            <li key={item.id}>
              <Link href="/admin-occ/planning" className="flex items-start gap-3 px-4 py-2 hover:bg-occ-panel-muted">
                <span aria-hidden="true" className="mt-1.5 h-2 w-2 shrink-0 rounded-sm bg-occ-warn" />
                <span className="min-w-0 flex-1">
                  <span className="font-mono text-[13px] font-semibold text-occ-text">{item.operationCode}</span>
                  <span className="block truncate text-xs text-occ-muted">
                    {[item.arrival?.flightNumber, item.departure?.flightNumber].filter(Boolean).join(' → ')}
                    {' · '}
                    <span className="text-occ-warn">{missingResources(item).map(key => t(`attention.missing.${key}`)).join(', ')}</span>
                  </span>
                </span>
              </Link>
            </li>
          ))}
        </ul>}
      {needsResources.length > MAX_ITEMS && (
        <p className="px-4 pb-3 text-xs">
          <Link href="/admin-occ/planning" className="font-semibold text-occ-accent hover:underline">{t('attention.openPlanning')}</Link>
        </p>
      )}
    </ConsolePanel>
  );
}
