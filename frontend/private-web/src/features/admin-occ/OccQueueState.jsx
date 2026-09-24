export function OccStationPicker({ stationScopes, stationId, onChange }) {
  return <label className="flex items-center gap-2 text-sm font-medium">
    Estación
    <select value={stationId} onChange={event => onChange(event.target.value)}
      className="min-h-11 rounded-lg border border-black/15 bg-white px-3 dark:border-white/15 dark:bg-surface-dark-card">
      {stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>{scope.stationCode}</option>)}
    </select>
  </label>;
}

export function OccQueueState({ queue }) {
  if (queue.status === 'empty-scope') return <p role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">Tu cuenta no tiene una estación OCC autorizada.</p>;
  if (queue.status === 'loading') return <p role="status" className="rounded-xl bg-white/80 p-5 dark:bg-surface-dark-card">Cargando datos operativos…</p>;
  if (queue.status === 'error') return <div role="alert" className="rounded-xl border border-status-danger/30 bg-white/80 p-5 dark:bg-surface-dark-card">
    <p>No se pudieron cargar los datos de la estación.</p>
    <button type="button" onClick={queue.refresh} className="mt-3 min-h-11 rounded-lg bg-accent-600 px-4 py-2 font-semibold text-white">Reintentar</button>
  </div>;
  return null;
}
