export default function ModulePlaceholder({ icon: Icon, label, description }) {
  return (
    <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-center gap-4 rounded-2xl border border-black/5 bg-white/70 px-6 py-20 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-accent-600/10 text-accent-600 dark:bg-accent-600/20">
        <Icon className="h-6 w-6" />
      </span>
      <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        En construcción
      </p>
      <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{label}</h1>
      <p className="max-w-md text-sm text-text-secondary-light dark:text-text-secondary-dark">{description}</p>
    </div>
  );
}
