import DataTable from '../../../../components/DataTable';
import Avatar from '../../../../components/Avatar';
import EmptyState from '../../../../components/EmptyState';
import AgentStatusBadge from './AgentStatusBadge';
import ExpirationIndicator from './ExpirationIndicator';
import { ShieldCheckIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

// Tabla principal de la vista "Por agente" (skill.md §"VISTA POR AGENTE").
// Cada fila resume las habilitaciones de un agente; el detalle completo
// vive en AgentQualificationDrawer, abierto por fila (click) o por acción.
export default function AgentQualificationsTable({ items, loading, hasActiveFilters, onRowClick }) {
  const columns = [
    {
      key: 'agent',
      label: 'Agente',
      render: agent => (
        <div className="flex min-w-0 items-center gap-2.5">
          <Avatar name={agent.agentName} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-sm font-medium text-ink-900 dark:text-text-primary-dark">{agent.agentName}</p>
            <p className="truncate text-xs text-text-secondary-light dark:text-text-secondary-dark">{agent.employeeNumber}</p>
          </div>
        </div>
      ),
    },
    {
      key: 'terminal',
      label: 'Terminal',
      className: 'hidden sm:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: agent => agent.terminals.join(' / '),
    },
    {
      key: 'qualifications',
      label: 'Habilitaciones',
      render: agent => <ExpirationIndicator activeCount={agent.activeCount} expiringSoonCount={agent.expiringSoonCount} expiredCount={agent.expiredCount} />,
    },
    {
      key: 'nextExpiration',
      label: 'Próxima expiración',
      className: 'hidden md:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: agent => formatDate(agent.nextExpirationAt),
    },
    {
      key: 'status',
      label: 'Estado general',
      render: agent => <AgentStatusBadge status={agent.overallStatus} />,
    },
    {
      key: 'updatedAt',
      label: 'Última actualización',
      className: 'hidden lg:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: agent => formatDate(agent.updatedAt),
    },
    {
      key: 'actions',
      label: 'Acciones',
      className: 'text-right',
      render: agent => (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={event => {
              event.stopPropagation();
              onRowClick(agent);
            }}
            className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Ver detalle
          </button>
        </div>
      ),
    },
  ];

  return (
    <DataTable
      columns={columns}
      rows={items}
      getRowId={agent => agent.agentId}
      loading={loading}
      onRowClick={onRowClick}
      emptyState={
        <EmptyState
          icon={ShieldCheckIcon}
          title={hasActiveFilters ? 'No hay agentes que coincidan con los filtros.' : 'No hay agentes con habilitaciones registradas.'}
          description={hasActiveFilters ? 'Ajusta o limpia los filtros para ver más resultados.' : 'Registra la primera habilitación para comenzar.'}
        />
      }
    />
  );
}
