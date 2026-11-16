export default function FlightMonitoringSkeleton() {
  return (
    <div data-testid="flight-monitoring-skeleton" className="grid flex-1 grid-cols-1 gap-4 xl:grid-cols-[3fr_7fr]">
      <div className="space-y-2 rounded-2xl border border-black/5 bg-white/70 p-3 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        {Array.from({ length: 6 }).map((_, index) => (
          <div key={index} className="h-16 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />
        ))}
      </div>
      <div className="min-h-[420px] animate-pulse rounded-2xl bg-black/5 dark:bg-white/5" />
    </div>
  );
}
