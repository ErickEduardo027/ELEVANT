import ReviewQueueRow from './ReviewQueueRow';

const COLUMNS = [
  { key: 'select', label: '' },
  { key: 'status', label: 'Estado' },
  { key: 'flight', label: 'Vuelo' },
  { key: 'route', label: 'Ruta' },
  { key: 'date', label: 'Fecha' },
  { key: 'position', label: 'Posición' },
  { key: 'agent', label: 'Agente' },
  { key: 'supervisor', label: 'Supervisor' },
  { key: 'submitted', label: 'Enviado' },
  { key: 'waiting', label: 'Espera' },
  { key: 'incidents', label: 'Incidencias' },
  { key: 'actions', label: '' },
];

export default function ReviewQueueTable({
  operations,
  now,
  selectedIds,
  onToggleSelect,
  onToggleSelectAll,
  onOpenDetail,
  onQuickApprove,
  onQuickReturn,
}) {
  const allVisibleSelected = operations.length > 0 && operations.every(operation => selectedIds.has(operation.id));

  return (
    <div className="overflow-x-auto rounded-2xl border border-black/5 bg-white/70 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <table className="w-full min-w-[1100px] text-left">
        <thead>
          <tr className="border-b border-black/5 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:border-white/5 dark:text-text-secondary-dark">
            {COLUMNS.map(column =>
              column.key === 'select' ? (
                <th key={column.key} className="w-10 px-3 py-2.5">
                  <input
                    type="checkbox"
                    checked={allVisibleSelected}
                    onChange={() => onToggleSelectAll(operations.map(operation => operation.id))}
                    aria-label="Seleccionar todas las operaciones visibles"
                    className="h-4 w-4 rounded border-black/20 text-accent-600 dark:border-white/20"
                  />
                </th>
              ) : (
                <th key={column.key} className="px-3 py-2.5">
                  {column.label}
                </th>
              )
            )}
          </tr>
        </thead>
        <tbody>
          {operations.map(operation => (
            <ReviewQueueRow
              key={operation.id}
              operation={operation}
              now={now}
              selected={selectedIds.has(operation.id)}
              onToggleSelect={onToggleSelect}
              onOpenDetail={onOpenDetail}
              onQuickApprove={onQuickApprove}
              onQuickReturn={onQuickReturn}
            />
          ))}
        </tbody>
      </table>
    </div>
  );
}
