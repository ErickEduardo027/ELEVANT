export default function ReviewSkeleton() {
  return (
    <div data-testid="review-skeleton" className="space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-testid="review-skeleton-row"
          className="h-14 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
