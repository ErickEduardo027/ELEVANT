export default function ReviewSection({ title, action, children }) {
  return (
    <section className="space-y-2 border-b border-black/5 pb-4 last:border-b-0 last:pb-0 dark:border-white/5">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
          {title}
        </h3>
        {action}
      </div>
      <div className="text-sm text-ink-900 dark:text-text-primary-dark">{children}</div>
    </section>
  );
}
