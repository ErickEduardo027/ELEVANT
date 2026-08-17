import ReportTable from './ReportTable';
import ReportDetailPanel from './ReportDetailPanel';
import StatusBadge from '../../../components/StatusBadge';
import { getStatusMeta } from '../../dashboard/statusMeta';
import { formatDateKey } from '../reportsMappers';

const COLUMNS = [
  { key: 'airline', label: 'Aerolínea', sortValue: row => row.airline, render: row => row.airline },
  { key: 'flight', label: 'Vuelo', sortValue: row => row.flight, render: row => <span className="font-mono">{row.flight}</span> },
  { key: 'period', label: 'Período', sortValue: row => row.period, render: row => formatDateKey(row.period) },
  { key: 'service', label: 'Servicio', sortValue: row => row.service, render: row => row.service },
  { key: 'contractedQty', label: 'Contratado', sortValue: row => row.contractedQty, render: row => row.contractedQty },
  { key: 'executedQty', label: 'Ejecutado', sortValue: row => row.executedQty, render: row => <span className="font-mono">{row.executedQty}</span> },
  {
    key: 'diff',
    label: 'Diferencia',
    sortValue: row => row.diff,
    render: row => (row.diff === 0 ? '0' : `${row.diff > 0 ? '+' : ''}${row.diff}`),
  },
  {
    key: 'status',
    label: 'Estado',
    sortValue: row => row.status,
    render: row => {
      const meta = getStatusMeta('reconciliation', row.status);
      return <StatusBadge tone={meta.color} label={meta.label} />;
    },
  },
];

function getSearchableText(row) {
  return [row.airline, row.flight, row.service].filter(Boolean).join(' ');
}

export default function ReconciliationSummaryTable({ rows }) {
  return (
    <ReportTable
      columns={COLUMNS}
      rows={rows}
      getSearchableText={getSearchableText}
      searchPlaceholder="Aerolínea, vuelo, servicio"
      isCriticalRow={row => row.status === 'no_ejecutado'}
      renderExpanded={row => <ReportDetailPanel record={row.detail} />}
    />
  );
}
