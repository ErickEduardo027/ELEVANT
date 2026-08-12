import DataTable from '../../../../components/DataTable';
import Avatar from '../../../../components/Avatar';
import EmptyState from '../../../../components/EmptyState';
import AgentPermitStatusBadge from './AgentPermitStatusBadge';
import PermitStatusBadge from './PermitStatusBadge';
import { IdCardIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

// Celda de documento: el carnet vencido recibe una acentuación adicional
// (borde + fondo + fecha en rojo) que la licencia no recibe en el mismo
// estado — skill.md: "un carnet vencido debe tener mayor peso visual porque
// bloquea el acceso a rampa".
function DocumentCell({ item, emphasizeExpired = false }) {
  if (!item) return <span className="text-sm text-text-secondary-light dark:text-text-secondary-dark">—</span>;

  const isEmphasized = emphasizeExpired && item.status === 'expired';
  return (
    <div className={`flex flex-col gap-1 ${isEmphasized ? 'rounded-lg border-l-2 border-status-danger bg-status-danger/5 py-1 pl-2' : ''}`}>
      <PermitStatusBadge status={item.status} />
      <span className={`text-xs ${isEmphasized ? 'font-semibold text-status-danger' : 'text-text-secondary-light dark:text-text-secondary-dark'}`}>
        {formatDate(item.record.expiresAt)}
      </span>
    </div>
  );
}

// Tabla principal de "Carnets y permisos aeroportuarios" (skill.md
// §"TABLA"). Cada fila resume ambos documentos de un agente; el detalle
// completo y la renovación viven en AgentPermitDrawer, abierto por fila.
export default function AgentPermitsTable({ items, loading, hasActiveFilters, onRowClick }) {
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
      key: 'carnet',
      label: 'Carnet',
      render: agent => <DocumentCell item={agent.carnet} emphasizeExpired />,
    },
    {
      key: 'licencia',
      label: 'Licencia',
      render: agent => <DocumentCell item={agent.licencia} />,
    },
    {
      key: 'status',
      label: 'Estado general',
      className: 'hidden md:table-cell',
      render: agent => <AgentPermitStatusBadge status={agent.overallStatus} />,
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
          icon={IdCardIcon}
          title={hasActiveFilters ? 'No hay agentes que coincidan con los filtros.' : 'No hay agentes con carnets o licencias registrados.'}
          description={hasActiveFilters ? 'Ajusta o limpia los filtros para ver más resultados.' : 'Los documentos de los agentes de rampa aparecerán aquí.'}
        />
      }
    />
  );
}
