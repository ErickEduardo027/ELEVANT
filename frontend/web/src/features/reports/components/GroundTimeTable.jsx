import ReportTable from './ReportTable';
import ReportDetailPanel from './ReportDetailPanel';
import StatusBadge from '../../dashboard/components/StatusBadge';
import { formatSignedMinutes } from '../reportsMappers';

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
  { key: 'aircraftType', label: 'Tipo de aeronave', sortValue: row => row.aircraftType, render: row => row.aircraftType },
  {
    key: 'contractedMinutes',
    label: 'Tiempo contratado',
    sortValue: row => row.contractedMinutes,
    render: row => `${row.contractedMinutes} min`,
  },
  {
    key: 'actualMinutes',
    label: 'Tiempo real',
    sortValue: row => row.actualMinutes,
    render: row => <span className="font-mono">{row.actualMinutes} min</span>,
  },
  {
    key: 'diffMinutes',
    label: 'Diferencia',
    sortValue: row => row.diffMinutes,
    render: row => formatSignedMinutes(row.diffMinutes),
  },
  {
    key: 'status',
    label: 'Estado',
    sortValue: row => row.status,
    render: row => <StatusBadge domain="groundTime" status={row.status} />,
  },
];

function getSearchableText(row) {
  return [row.flight.number, row.flight.airline, row.aircraftType].filter(Boolean).join(' ');
}

export default function GroundTimeTable({ rows }) {
  return (
    <ReportTable
      columns={COLUMNS}
      rows={rows}
      getSearchableText={getSearchableText}
      searchPlaceholder="Vuelo, aerolínea, tipo de aeronave"
      isCriticalRow={row => row.status === 'exceeded'}
      renderExpanded={row => <ReportDetailPanel record={row.detail} />}
    />
  );
}
