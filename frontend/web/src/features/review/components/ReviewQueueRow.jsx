import { useState } from 'react';
import ReviewStatusBadge from './ReviewStatusBadge';
import ReviewPriorityBadge from './ReviewPriorityBadge';
import { canQuickApprove, formatClockTime, formatOperationDate, formatWaitingTime } from '../reviewMappers';
import { MoreVerticalIcon } from './icons';

function RowMenu({ operation, onOpenDetail, onQuickApprove, onQuickReturn }) {
  const [open, setOpen] = useState(false);
  const allowQuickApprove = canQuickApprove(operation);

  function runAndClose(action) {
    setOpen(false);
    action();
  }

  return (
    <div className="relative">
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Acciones para ${operation.flight.number}`}
        onClick={() => setOpen(value => !value)}
        className="rounded-md p-1.5 text-text-secondary-light hover:bg-black/5 dark:text-text-secondary-dark dark:hover:bg-white/5"
      >
        <MoreVerticalIcon className="h-4 w-4" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-30 w-52 rounded-lg border border-black/10 bg-white/95 py-1 shadow-lg backdrop-blur-md dark:border-white/10 dark:bg-surface-dark-card"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onOpenDetail(operation.id))}
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Ver detalle
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={!allowQuickApprove}
            title={allowQuickApprove ? undefined : 'Existen discrepancias críticas: revise el detalle antes de aprobar'}
            onClick={() => allowQuickApprove && runAndClose(() => onQuickApprove(operation.id))}
            className={`block w-full px-3 py-1.5 text-left text-sm ${
              allowQuickApprove
                ? 'text-status-success hover:bg-black/5 dark:hover:bg-white/5'
                : 'cursor-not-allowed text-text-secondary-light/50 dark:text-text-secondary-dark/50'
            }`}
          >
            Aprobar
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onQuickReturn(operation.id))}
            className="block w-full px-3 py-1.5 text-left text-sm text-status-danger hover:bg-black/5 dark:hover:bg-white/5"
          >
            Devolver
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => runAndClose(() => onOpenDetail(operation.id))}
            className="block w-full px-3 py-1.5 text-left text-sm text-ink-900 hover:bg-black/5 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Historial
          </button>
        </div>
      )}
    </div>
  );
}

export default function ReviewQueueRow({ operation, now, selected, onToggleSelect, onOpenDetail, onQuickApprove, onQuickReturn }) {
  const incidentCount = operation.incidents?.length ?? 0;

  return (
    <tr
      data-testid="review-queue-row"
      onClick={() => onOpenDetail(operation.id)}
      className="cursor-pointer border-b border-black/5 last:border-b-0 hover:bg-black/[0.03] dark:border-white/5 dark:hover:bg-white/[0.04]"
    >
      <td className="w-10 px-3 py-2.5" onClick={event => event.stopPropagation()}>
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggleSelect(operation.id)}
          aria-label={`Seleccionar operación ${operation.flight.number}`}
          className="h-4 w-4 rounded border-black/20 text-accent-600 dark:border-white/20"
        />
      </td>
      <td className="whitespace-nowrap px-3 py-2.5">
        <div className="flex flex-col gap-1">
          <ReviewStatusBadge status={operation.status} />
          <ReviewPriorityBadge priority={operation.priority} />
        </div>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm">
        <span className="font-mono font-semibold text-ink-900 dark:text-text-primary-dark">{operation.flight.number}</span>
        <span className="ml-1.5 text-text-secondary-light dark:text-text-secondary-dark">{operation.flight.airline}</span>
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-text-secondary-light dark:text-text-secondary-dark">
        {operation.flight.origin} → {operation.flight.destination}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-text-secondary-light dark:text-text-secondary-dark">
        {formatOperationDate(operation.schedule?.sta)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-sm text-ink-900 dark:text-text-primary-dark">{operation.position}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-ink-900 dark:text-text-primary-dark">{operation.agent?.name ?? 'Sin agente'}</td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm text-ink-900 dark:text-text-primary-dark">{operation.supervisor?.name ?? 'Sin supervisor'}</td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-text-secondary-light dark:text-text-secondary-dark">
        {formatClockTime(operation.submittedAt)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 font-mono text-xs text-ink-900 dark:text-text-primary-dark">
        {formatWaitingTime(operation.submittedAt, now)}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5 text-sm">
        {incidentCount > 0 ? (
          <span className="rounded-full bg-status-warning/10 px-2 py-0.5 text-xs font-medium text-status-warning">
            {incidentCount} incidencia{incidentCount === 1 ? '' : 's'}
          </span>
        ) : (
          <span className="text-xs text-text-secondary-light dark:text-text-secondary-dark">—</span>
        )}
      </td>
      <td className="whitespace-nowrap px-3 py-2.5" onClick={event => event.stopPropagation()}>
        <RowMenu operation={operation} onOpenDetail={onOpenDetail} onQuickApprove={onQuickApprove} onQuickReturn={onQuickReturn} />
      </td>
    </tr>
  );
}
