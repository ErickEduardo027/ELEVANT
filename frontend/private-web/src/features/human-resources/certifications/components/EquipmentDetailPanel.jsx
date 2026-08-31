import Drawer from '../../../../components/Drawer';
import DataTable from '../../../../components/DataTable';
import EmptyState from '../../../../components/EmptyState';
import Badge from '../../../../components/Badge';
import QualificationStatusBadge from './QualificationStatusBadge';
import { ShieldCheckIcon } from '../../../shell/components/icons';
import { formatDate } from '../mappers';

// Detalle de un tipo de equipo (skill.md §"DETALLE DE EQUIPO"): lista
// filtrada de agentes habilitados para ese equipo, con acceso directo al
// detalle completo del agente.
export default function EquipmentDetailPanel({ open, onClose, coverage, onOpenAgent }) {
  if (!coverage) {
    return <Drawer open={open} onClose={onClose} title="" widthClassName="lg:w-[520px]" />;
  }

  const columns = [
    {
      key: 'agent',
      label: 'Agente',
      render: item => (
        <div>
          <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">{item.agentName}</p>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{item.employeeNumber}</p>
        </div>
      ),
    },
    { key: 'terminal', label: 'Terminal', render: item => item.terminals.join(' / ') },
    { key: 'status', label: 'Estado', render: item => <QualificationStatusBadge status={item.status} /> },
    {
      key: 'expiresAt',
      label: 'Fecha de vencimiento',
      className: 'text-text-secondary-light dark:text-text-secondary-dark',
      render: item => formatDate(item.record.expiresAt),
    },
    {
      key: 'renewedAt',
      label: 'Última renovación',
      className: 'hidden sm:table-cell text-text-secondary-light dark:text-text-secondary-dark',
      render: item => formatDate(item.record.obtainedAt),
    },
    {
      key: 'actions',
      label: 'Acciones',
      className: 'text-right',
      render: item => (
        <div className="flex justify-end">
          <button
            type="button"
            onClick={() => onOpenAgent(item.agentId)}
            className="rounded-lg border border-black/10 px-2.5 py-1 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            Ver agente
          </button>
        </div>
      ),
    },
  ];

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={coverage.equipmentName}
      description={coverage.terminals.length > 0 ? `Terminal ${coverage.terminals.join(' / ')}` : 'Sin terminal asignada'}
      widthClassName="lg:w-[560px]"
    >
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone="success" label={`${coverage.activeCount} vigentes`} />
        <Badge tone="warning" label={`${coverage.expiringSoonCount} próximas a vencer`} />
        <Badge tone="danger" label={`${coverage.expiredCount} vencidas`} />
        {coverage.limitedCoverage && <Badge tone="neutral" label="Cobertura limitada" />}
      </div>

      <DataTable
        columns={columns}
        rows={coverage.qualifications}
        getRowId={item => item.id}
        emptyState={
          <EmptyState
            icon={ShieldCheckIcon}
            title="Sin agentes habilitados"
            description="Ningún agente tiene actualmente una habilitación registrada para este equipo."
          />
        }
      />
    </Drawer>
  );
}
