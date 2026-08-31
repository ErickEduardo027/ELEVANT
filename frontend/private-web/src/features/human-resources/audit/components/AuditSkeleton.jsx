export default function AuditSkeleton({ groups = 4, items = 2 }) {
  return (
    <div className="space-y-5">
      {Array.from({ length: groups }, (_, groupIndex) => (
        <div key={groupIndex} className="space-y-3">
          <div className="h-4 w-28 animate-pulse rounded-full bg-black/5 dark:bg-white/10" />
          <div className="space-y-3">
            {Array.from({ length: items }, (_, itemIndex) => (
              <div
                key={itemIndex}
                className="h-28 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
              />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

