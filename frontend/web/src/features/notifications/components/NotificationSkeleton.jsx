export default function NotificationSkeleton() {
  return (
    <div data-testid="notification-skeleton" className="mx-auto max-w-[800px] space-y-3">
      {Array.from({ length: 6 }, (_, index) => (
        <div
          key={index}
          data-testid="notification-skeleton-row"
          className="h-16 animate-pulse rounded-xl border border-black/5 bg-white/60 dark:border-white/5 dark:bg-surface-dark-card"
        />
      ))}
    </div>
  );
}
