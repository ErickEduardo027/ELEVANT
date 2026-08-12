// Mini-semáforo por fila (vigentes · próximas a vencer · vencidas), usado en
// la tabla "Por agente" y en las tarjetas de cobertura. Reutiliza el mismo
// vocabulario visual de punto + color que StatusBadge (no un chip nuevo),
// condensado a tres pares dot+número para que quepa en una celda de tabla.
export default function ExpirationIndicator({ activeCount, expiringSoonCount, expiredCount }) {
  return (
    <span
      className="inline-flex items-center gap-2.5 font-mono text-xs tabular-nums text-ink-900 dark:text-text-primary-dark"
      title={`${activeCount} vigente${activeCount === 1 ? '' : 's'} · ${expiringSoonCount} próxima${expiringSoonCount === 1 ? '' : 's'} a vencer · ${expiredCount} vencida${expiredCount === 1 ? '' : 's'}`}
    >
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-success" />
        {activeCount}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-warning" />
        {expiringSoonCount}
      </span>
      <span className="inline-flex items-center gap-1">
        <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-status-danger" />
        {expiredCount}
      </span>
    </span>
  );
}
