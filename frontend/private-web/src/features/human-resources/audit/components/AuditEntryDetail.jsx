export default function AuditEntryDetail({ entry }) {
  return (
    <div className="space-y-4 border-t border-black/5 pt-4 dark:border-white/5">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Detalle
          </p>
          <p className="mt-1 text-sm text-ink-900 dark:text-text-primary-dark">{entry.detail}</p>
        </div>
        <div className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
          <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
            Información de origen
          </p>
          <div className="mt-2 space-y-1 text-sm text-ink-900 dark:text-text-primary-dark">
            <p>
              Usuario afectado: <span className="font-medium">{entry.affectedUserName}</span>
            </p>
            <p>
              Ejecutado por: <span className="font-medium">{entry.executorName}</span>
            </p>
            <p>
              Fecha y hora: <span className="font-medium">{new Date(entry.occurredAt).toLocaleString('es-DO', { dateStyle: 'medium', timeStyle: 'short', hour12: false })}</span>
            </p>
          </div>
        </div>
      </div>

      <div className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
        <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
          Campos modificados
        </p>
        <div className="mt-3 space-y-2">
          {entry.changes.map(change => (
            <div
              key={`${entry.id}-${change.field}`}
              className="grid gap-2 rounded-lg border border-black/5 bg-white/80 p-3 text-sm dark:border-white/5 dark:bg-surface-dark-card sm:grid-cols-[180px_minmax(0,1fr)_minmax(0,1fr)]"
            >
              <p className="font-medium text-ink-900 dark:text-text-primary-dark">{change.field}</p>
              <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Anterior: <span className="text-ink-900 dark:text-text-primary-dark">{change.previousValue}</span>
              </p>
              <p className="font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
                Nuevo: <span className="text-ink-900 dark:text-text-primary-dark">{change.nextValue}</span>
              </p>
            </div>
          ))}
        </div>
      </div>

      {(entry.ipAddress || entry.device) && (
        <div className="grid gap-3 md:grid-cols-2">
          {entry.ipAddress && (
            <div className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
                IP
              </p>
              <p className="mt-1 font-mono text-sm text-ink-900 dark:text-text-primary-dark">{entry.ipAddress}</p>
            </div>
          )}
          {entry.device && (
            <div className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
              <p className="text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
                Dispositivo
              </p>
              <p className="mt-1 text-sm text-ink-900 dark:text-text-primary-dark">{entry.device}</p>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

