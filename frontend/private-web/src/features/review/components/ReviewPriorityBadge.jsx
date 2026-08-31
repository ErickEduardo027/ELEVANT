const PRIORITY_META = {
  HIGH: { label: 'Prioridad alta', className: 'bg-status-warning/10 text-status-warning' },
  CRITICAL: { label: 'Prioridad crítica', className: 'bg-status-danger/10 text-status-danger' },
};

export default function ReviewPriorityBadge({ priority }) {
  const meta = PRIORITY_META[priority];
  if (!meta) return null;

  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ${meta.className}`}>
      {meta.label}
    </span>
  );
}
