const DOT_TONE_CLASSES = {
  info: 'bg-status-info',
  active: 'bg-status-active',
  success: 'bg-status-success',
  warning: 'bg-status-warning',
  danger: 'bg-status-danger',
  neutral: 'bg-status-neutral',
};

// Presentacional puro: recibe tono + etiqueta ya resueltos. Cada feature
// mantiene su propia tabla de significado (ver statusMeta.js de cada
// dominio) para no acoplar este componente compartido a un vocabulario de
// estados específico (vuelos, habilitaciones, cuentas, etc.).
export default function StatusBadge({ tone = 'info', label }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-ink-900 dark:text-text-primary-dark">
      <span
        data-testid="status-dot"
        aria-hidden="true"
        className={`h-1.5 w-1.5 rounded-full ${DOT_TONE_CLASSES[tone] ?? DOT_TONE_CLASSES.info}`}
      />
      {label}
    </span>
  );
}
