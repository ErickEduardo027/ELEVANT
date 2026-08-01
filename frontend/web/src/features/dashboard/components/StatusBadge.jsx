import { STATUS_COLORS, getStatusMeta } from '../statusMeta';

export default function StatusBadge({ domain, status }) {
  const meta = getStatusMeta(domain, status);
  const dotColor = STATUS_COLORS[meta.color];

  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-900 dark:text-text-primary-dark">
      <span
        data-testid="status-dot"
        aria-hidden="true"
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: dotColor }}
      />
      {meta.label}
    </span>
  );
}
