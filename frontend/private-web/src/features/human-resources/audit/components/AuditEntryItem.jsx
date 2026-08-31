import { ChevronDownIcon } from '../../../shell/components/icons';
import Badge from '../../../../components/Badge';
import { formatAuditDateTime, getAuditActionMeta } from '../auditMappers';
import AuditEntryDetail from './AuditEntryDetail';

export default function AuditEntryItem({ entry, expanded, onToggle }) {
  const meta = getAuditActionMeta(entry.actionType);

  return (
    <article
      className={`rounded-2xl border bg-white/70 p-4 backdrop-blur-md transition-shadow dark:bg-surface-dark-card ${
        entry.critical ? 'border-status-danger/25 ring-1 ring-status-danger/10' : 'border-black/5 dark:border-white/5'
      }`}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={expanded}
        className="flex w-full items-start gap-3 text-left"
      >
        <span
          aria-hidden="true"
          className={`mt-1 h-2.5 w-2.5 shrink-0 rounded-full ${
            meta.tone === 'success'
              ? 'bg-status-success'
              : meta.tone === 'active'
                ? 'bg-status-active'
                : meta.tone === 'danger'
                  ? 'bg-status-danger'
                  : meta.tone === 'warning'
                    ? 'bg-status-warning'
                    : 'bg-status-info'
          }`}
        />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{entry.actionLabel}</h3>
                <Badge tone={meta.tone} label={meta.label} />
                {entry.critical && (
                  <Badge tone="danger" label="Crítica" />
                )}
              </div>
              <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Afectado: <span className="font-medium">{entry.affectedUserName}</span> · Ejecutó: <span className="font-medium">{entry.executorName}</span>
              </p>
            </div>

            <div className="flex items-center gap-3 text-right">
              <div>
                <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{formatAuditDateTime(entry.occurredAt)}</p>
              </div>
              <ChevronDownIcon className={`h-4 w-4 shrink-0 text-text-secondary-light transition-transform dark:text-text-secondary-dark ${expanded ? 'rotate-180' : ''}`} />
            </div>
          </div>
        </div>
      </button>

      {expanded && <AuditEntryDetail entry={entry} />}
    </article>
  );
}

