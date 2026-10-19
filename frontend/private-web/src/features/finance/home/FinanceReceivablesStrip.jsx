import { useEffect, useState } from 'react';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { formatMoney, getFinanceReport, listContractApprovals } from '../../../services/financeBookService';

const today = () => new Date().toISOString().slice(0, 10);

/**
 * Receivables, overdue balance and contracts awaiting Finance, read from the
 * server's receivables report and approval queue. Each figure shows only when
 * the account holds the permission behind it.
 */
export default function FinanceReceivablesStrip({ stationId, onNavigate, revision }) {
  const access = useOptionalDepartmentAccess();
  const canReports = Boolean(access?.can('finance.reports.read'));
  const canApprovals = Boolean(access?.can('finance.contract_approvals.read'));
  const [metrics, setMetrics] = useState(null);
  const [pending, setPending] = useState(null);

  useEffect(() => {
    if (!canReports || !stationId) return undefined;
    let active = true;
    getFinanceReport('receivables', { from: today(), to: today(), stationId, currency: '' })
      .then(report => active && setMetrics(report.summary.filter(metric =>
        metric.label.startsWith('Por cobrar') || metric.label.startsWith('Vencido'))))
      .catch(() => active && setMetrics([]));
    return () => { active = false; };
  }, [canReports, stationId, revision]);

  useEffect(() => {
    if (!canApprovals) return undefined;
    let active = true;
    listContractApprovals(true).then(items => active && setPending(items.length)).catch(() => active && setPending(null));
    return () => { active = false; };
  }, [canApprovals, revision]);

  if (!canReports && !canApprovals) return null;
  return (
    <section aria-label="Cuentas por cobrar" className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {canReports && (metrics ?? []).map(metric => (
        <button key={metric.label} type="button" onClick={() => onNavigate('finance-reconciliation')}
          className="rounded-xl border border-black/5 bg-white p-4 text-left hover:border-accent-600/40 dark:border-white/5 dark:bg-surface-dark-card">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{metric.label}</span>
          <span className={`mt-1 block text-xl font-bold tabular-nums ${metric.label.startsWith('Vencido') && Number(metric.value) > 0 ? 'text-status-danger' : 'text-accent-600'}`}>
            {formatMoney(metric.value, metric.currencyCode)}
          </span>
        </button>
      ))}
      {canReports && metrics === null && <p role="status" className="text-sm">Calculando cuentas por cobrar…</p>}
      {canApprovals && pending !== null && (
        <button type="button" onClick={() => onNavigate('finance-contract-approvals')}
          className="rounded-xl border border-black/5 bg-white p-4 text-left hover:border-accent-600/40 dark:border-white/5 dark:bg-surface-dark-card">
          <span className="block text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">Contratos por aprobar</span>
          <span className={`mt-1 block text-xl font-bold tabular-nums ${pending > 0 ? 'text-status-warning' : 'text-accent-600'}`}>{pending}</span>
        </button>
      )}
    </section>
  );
}
