import { getAuditCategoryMeta, getAuditActionMeta } from '../auditMappers';
import AuditEntryItem from './AuditEntryItem';

export default function AuditTimeline({ groups, expandedEntryId, onToggleEntry }) {
  return (
    <div className="space-y-4">
      {groups.map(group => (
        <section key={group.group} className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{group.group}</h2>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
              {group.items.length} movimiento{group.items.length === 1 ? '' : 's'}
            </p>
          </div>

          <div className="space-y-3">
            {group.items.map(entry => {
              const categoryMeta = getAuditCategoryMeta(getAuditActionMeta(entry.actionType).category);
              return (
                <div key={entry.id} className="relative pl-4">
                  <span
                    aria-hidden="true"
                    className={`absolute left-[3px] top-6 h-[calc(100%-0.75rem)] w-px ${
                      entry.critical ? 'bg-status-danger/30' : 'bg-black/10 dark:bg-white/10'
                    }`}
                  />
                  <span
                    aria-hidden="true"
                    className={`absolute left-0 top-5 h-2.5 w-2.5 rounded-full ${
                      categoryMeta.tone === 'success'
                        ? 'bg-status-success'
                        : categoryMeta.tone === 'active'
                          ? 'bg-status-active'
                          : categoryMeta.tone === 'danger'
                            ? 'bg-status-danger'
                            : 'bg-status-warning'
                    }`}
                  />
                  <AuditEntryItem
                    entry={entry}
                    expanded={expandedEntryId === entry.id}
                    onToggle={() => onToggleEntry(entry.id)}
                  />
                </div>
              );
            })}
          </div>
        </section>
      ))}
    </div>
  );
}
