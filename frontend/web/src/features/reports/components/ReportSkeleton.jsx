export default function ReportSkeleton({ rows = 6 }) {
  return (
    <div data-testid="report-skeleton" className="space-y-3">
      {Array.from({ length: rows }, (_, index) => (
        <div
          key={index}
          data-testid="report-skeleton-row"
          className="h-12 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
