const STATE_BUTTONS = [
  { state: 'default', label: 'Normal' },
  { state: 'loading', label: 'Carga' },
  { state: 'flyAwareError', label: 'FlyAware caído' },
  { state: 'emptyApprovals', label: 'Sin aprobaciones' },
  { state: 'planningEmpty', label: 'Planificación: sin vuelos' },
  { state: 'planningNoResults', label: 'Planificación: sin resultados' },
  { state: 'planningError', label: 'Planificación: error' },
  { state: 'monitoringEmpty', label: 'Monitoreo: sin vuelos' },
  { state: 'monitoringError', label: 'Monitoreo: error' },
  { state: 'monitoringDisconnected', label: 'Monitoreo: FlyAware desconectado' },
  { state: 'reviewEmpty', label: 'Revisión: sin operaciones' },
  { state: 'reviewError', label: 'Revisión: error' },
  { state: 'reportsEmpty', label: 'Reportes: sin datos' },
  { state: 'reportsError', label: 'Reportes: error' },
  { state: 'notificationsEmpty', label: 'Notificaciones: sin datos' },
  { state: 'notificationsError', label: 'Notificaciones: error' },
];

export default function DevPreviewPanel({ theme, forceState, onToggleTheme, onSetForceState }) {
  return (
    <div className="fixed bottom-4 right-4 z-50 w-64 rounded-xl border border-black/10 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
      <p className="mb-2 font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
        Vista previa (solo desarrollo)
      </p>
      <button
        type="button"
        onClick={onToggleTheme}
        className="mb-2 w-full rounded-md border border-black/10 px-2 py-1 text-left dark:border-white/10"
      >
        Tema: {theme === 'light' ? 'claro' : 'oscuro'}
      </button>
      <div className="grid grid-cols-2 gap-1.5">
        {STATE_BUTTONS.map(({ state, label }) => (
          <button
            key={state}
            type="button"
            onClick={() => onSetForceState(state)}
            className={`rounded-md border px-2 py-1 text-left ${
              forceState === state
                ? 'border-accent-600 text-accent-600'
                : 'border-black/10 text-ink-900 dark:border-white/10 dark:text-text-primary-dark'
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
