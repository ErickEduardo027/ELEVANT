export default function PlanningSkeleton() {
  return (
    <div data-testid="planning-skeleton" role="status" aria-label="Cargando planificación operativa" className="space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-testid="planning-skeleton-row"
          className="h-16 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
