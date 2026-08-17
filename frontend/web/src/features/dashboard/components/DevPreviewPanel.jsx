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
  { state: 'positionsMapEmpty', label: 'Mapa posiciones: sin posiciones' },
  { state: 'positionsMapError', label: 'Mapa posiciones: error' },
  { state: 'positionsMapDisconnected', label: 'Mapa posiciones: desconectado' },
  { state: 'reviewEmpty', label: 'Revisión: sin operaciones' },
  { state: 'reviewError', label: 'Revisión: error' },
  { state: 'reportsEmpty', label: 'Reportes: sin datos' },
  { state: 'reportsError', label: 'Reportes: error' },
  { state: 'notificationsEmpty', label: 'Notificaciones: sin datos' },
  { state: 'notificationsError', label: 'Notificaciones: error' },
  { state: 'chatEmpty', label: 'Chat: sin conversaciones' },
  { state: 'chatError', label: 'Chat: error' },
  { state: 'chatDisconnected', label: 'Chat: desconectado' },
];

export default function DevPreviewPanel({ theme, forceState, onToggleTheme, onSetForceState, defaultOpen = true }) {
  const [open, setOpen] = useState(() => {
    if (typeof window === 'undefined') return defaultOpen;
    if (defaultOpen) return true;
    const saved = window.sessionStorage.getItem('elevant-dev-preview-open');
    return saved === null ? defaultOpen : saved === 'true';
  });
  const toggle = () => setOpen(current => {
    const next = !current;
    if (!defaultOpen) window.sessionStorage.setItem('elevant-dev-preview-open', String(next));
    return next;
  });

  return (
    <>
    {open && <div className="fixed bottom-20 right-4 z-50 max-h-[calc(100vh-6rem)] w-64 overflow-y-auto rounded-xl border border-black/10 bg-white/95 p-3 text-xs shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card">
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
    </div>}
    <button type="button" onClick={toggle} aria-expanded={open} aria-label={open ? 'Ocultar herramientas de vista previa' : 'Mostrar herramientas de vista previa'} title={open ? 'Ocultar vista previa' : 'Mostrar vista previa'} className="fixed bottom-4 right-4 z-50 flex h-12 w-12 items-center justify-center rounded-full bg-accent-600 text-xl font-bold text-white shadow-lg transition hover:scale-105 focus:outline-none focus:ring-2 focus:ring-accent-600 focus:ring-offset-2">
      {open ? '×' : '⚙'}
    </button>
    </>
  );
}
import { useState } from 'react';
