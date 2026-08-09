import { useCountUp } from '../hooks/useCountUp';

const TONE_VALUE_CLASSES = {
  default: 'text-ink-900 dark:text-text-primary-dark',
  signal: 'text-signal-500',
  warning: 'text-status-warning',
  danger: 'text-status-danger',
};

// Tarjeta de KPI compartida (mismo trazo visual y animación de conteo
// ascendente que el KpiCard de referencia en feat/adminocc). Se generaliza
// con una acción contextual opcional para soportar KPIs que deben enlazar a
// un módulo (p. ej. "Revisar cuentas"), manteniendo el comportamiento
// existente intacto cuando `action` no se especifica.
export default function KpiCard({ label, value, icon: IconComponent, tone = 'default', loading = false, visual, subtext, action, emphasize = false }) {
  const animatedValue = useCountUp(typeof value === 'number' ? value : 0);

  if (loading) {
    return (
      <div
        data-testid="kpi-skeleton"
        className="h-28 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card"
      />
    );
  }

  return (
    <div
      className={`rounded-2xl border bg-white/70 p-4 shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:bg-surface-dark-card ${
        emphasize
          ? 'border-status-danger/30 ring-1 ring-status-danger/20 dark:border-status-danger/30'
          : 'border-black/5 dark:border-white/5'
      }`}
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-text-secondary-light dark:text-text-secondary-dark">
          {label}
        </span>
        {IconComponent && <IconComponent className="h-4 w-4 text-accent-600" />}
      </div>
      <div className="mt-3">
        {visual ?? (
          <span className={`font-sans text-3xl font-semibold tabular-nums ${TONE_VALUE_CLASSES[tone] ?? TONE_VALUE_CLASSES.default}`}>
            {animatedValue}
          </span>
        )}
      </div>
      {subtext && (
        <p className="mt-1 truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{subtext}</p>
      )}
      {action && (
        <button
          type="button"
          onClick={action.onClick}
          className="mt-3 text-xs font-medium text-accent-600 hover:underline"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
