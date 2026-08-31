import { useState } from 'react';
import DataTable from '../../../../components/DataTable';
import Avatar from '../../../../components/Avatar';
import StatusBadge from '../../../../components/StatusBadge';
import EmptyState from '../../../../components/EmptyState';
import { ChecklistIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';
import { AVAILABILITY_REQUEST_STATUS_META, AVAILABILITY_REQUEST_TYPE_META } from '../statusMeta';

const STATUS_WEIGHT = { pending: 0, approved: 1, rejected: 2 };

function sortByStatusThenDate(requests) {
  return [...requests].sort((a, b) => {
    const byStatus = STATUS_WEIGHT[a.status] - STATUS_WEIGHT[b.status];
    if (byStatus !== 0) return byStatus;
    return new Date(a.date) - new Date(b.date);
  });
}

// Tabla de "Solicitudes de disponibilidad" (skill.md §"SOLICITUDES DE
// DISPONIBILIDAD"): agente, fecha/turno solicitado, motivo, estado y
// aprobar/rechazar. Pendientes primero — son las que requieren acción.
export default function AvailabilityRequestsPanel({ requests, loading, onApprove, onReject }) {
  const [resolvingId, setResolvingId] = useState(null);

  async function handleResolve(request, action) {
    if (resolvingId) return;
    setResolvingId(request.id);
    try {
      await action(request.id);
    } finally {
      setResolvingId(null);
    }
  }

  const columns = [
    {
      key: 'agent',
      label: 'Agente',
      render: request => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={request.agentName} size="sm" />
          <span className="truncate text-sm font-medium text-ink-900 dark:text-text-primary-dark">{request.agentName}</span>
        </div>
      ),
    },
    {
      key: 'date',
      label: 'Fecha / turno solicitado',
      render: request => (
        <div>
          <p className="text-sm text-ink-900 dark:text-text-primary-dark">{formatDate(request.date)}</p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {AVAILABILITY_REQUEST_TYPE_META[request.type]?.label ?? request.type}
          </p>
        </div>
      ),
    },
    {
      key: 'reason',
      label: 'Motivo',
      className: 'max-w-[280px]',
      render: request => <span className="line-clamp-2 text-sm text-text-secondary-light dark:text-text-secondary-dark">{request.reason}</span>,
    },
    {
      key: 'status',
      label: 'Estado',
      render: request => {
        const meta = AVAILABILITY_REQUEST_STATUS_META[request.status];
        return <StatusBadge tone={meta.tone} label={meta.label} />;
      },
    },
    {
      key: 'actions',
      label: 'Acciones',
      className: 'text-right',
      render: request =>
        request.status === 'pending' ? (
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={() => handleResolve(request, onApprove)}
              disabled={resolvingId === request.id}
              className="rounded-lg border border-status-success/30 px-2.5 py-1 text-xs font-medium text-status-success hover:bg-status-success/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Aprobar
            </button>
            <button
              type="button"
              onClick={() => handleResolve(request, onReject)}
              disabled={resolvingId === request.id}
              className="rounded-lg border border-status-danger/30 px-2.5 py-1 text-xs font-medium text-status-danger hover:bg-status-danger/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Rechazar
            </button>
          </div>
        ) : (
          <p className="text-right text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {request.resolvedBy ? `Resuelta por ${request.resolvedBy}` : '—'}
          </p>
        ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={sortByStatusThenDate(requests)}
      getRowId={request => request.id}
      loading={loading}
      emptyState={
        <EmptyState
          icon={ChecklistIcon}
          title="No hay solicitudes de disponibilidad."
          description="Las solicitudes de cambio o restricción de horario de los agentes aparecerán aquí."
        />
      }
    />
  );
}
