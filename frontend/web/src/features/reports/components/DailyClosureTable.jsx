import ReportTable from './ReportTable';
import ReportDetailPanel from './ReportDetailPanel';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';
import { formatClockTime } from '../../review/reviewMappers';
import { formatLeadTime } from '../reportsMappers';

const COLUMNS = [
  {
    key: 'flight',
    label: 'Vuelo',
    sortValue: row => row.flight.number,
    render: row => (
      <div>
        <div className="font-mono font-semibold">{row.flight.number}</div>
        <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.flight.airline}</div>
      </div>
    ),
  },
  { key: 'initialPosition', label: 'Posición inicial', sortValue: row => row.initialPosition, render: row => row.initialPosition },
  { key: 'finalPosition', label: 'Posición final', sortValue: row => row.finalPosition, render: row => row.finalPosition },
  {
    key: 'changeReceivedAt',
    label: 'Cambio recibido',
    sortValue: row => row.changeReceivedAt,
    render: row => formatClockTime(row.changeReceivedAt),
  },
  {
    key: 'actualBlockAt',
    label: 'Bloqueo real',
    sortValue: row => row.actualBlockAt,
    render: row => formatClockTime(row.actualBlockAt),
  },
  {
    key: 'leadTimeMinutes',
    label: 'Anticipación',
    sortValue: row => row.leadTimeMinutes,
    render: row => <span className="font-mono">{formatLeadTime(row.leadTimeMinutes)}</span>,
  },
  { key: 'agent', label: 'Agente', sortValue: row => row.agent?.name, render: row => row.agent?.name ?? 'Sin asignar' },
  {
    key: 'severity',
    label: 'Estado',
    sortValue: row => row.severity,
    render: row => {
      const meta = getStatusMeta('closure', row.severity);
      return <StatusBadge tone={meta.color} label={meta.label} />;
    },
  },
];

function getSearchableText(row) {
  return [row.flight.number, row.flight.airline, row.agent?.name, row.initialPosition, row.finalPosition].filter(Boolean).join(' ');
}

export default function DailyClosureTable({ rows }) {
  return (
    <ReportTable
      columns={COLUMNS}
      rows={rows}
      getSearchableText={getSearchableText}
      searchPlaceholder="Vuelo, aerolínea, agente, posición"
      isCriticalRow={row => row.severity === 'critical'}
      renderExpanded={row => <ReportDetailPanel record={row.detail} />}
    />
  );
}
