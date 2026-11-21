import { useCallback, useEffect, useMemo, useState } from 'react';
import DataTable from '../../../components/DataTable';
import EmptyState from '../../../components/EmptyState';
import PageHeader from '../../../components/PageHeader';
import ReportFilterBar from '../../../components/reports/ReportFilterBar';
import ServerReportResult, { ReportMetrics } from '../../../components/reports/ServerReportResult';
import { useCommercialRevalidation } from '../../../hooks/useCommercialRevalidation';
import { readSession } from '../../auth/authService';
import { businessToday } from '../../../services/businessDay';
import {
  contractReportsAvailable, createContractReportSource, EXPIRING_DAYS, getContractsReportIndicators,
} from '../../../services/contractsReportsService';
import { formatIsoDate } from '../../reports/reportModel';
import { useServerReport } from '../../reports/useServerReport';
import { contractCodeLabel } from '../requests/requestLabels';
import { ContractIcon } from '../components/icons';

const CARD = 'rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card';
const SECONDARY = 'text-text-secondary-light dark:text-text-secondary-dark';

const share = (part, whole) => (whole ? ` (${(Math.round((part / whole) * 1000) / 10).toFixed(1)} %)` : '');
const plural = (count, one, many) => `${count} ${count === 1 ? one : many}`;

/** The figures of the indicators, each with what it is counted against (G3). */
export function contractMetrics(data) {
  return [
    { label: 'Contratos activos', value: String(data.active),
      context: `de ${plural(data.contracts, 'contrato registrado', 'contratos registrados')}${share(data.active, data.contracts)}` },
    { label: `Por vencer en ${EXPIRING_DAYS} días`, value: String(data.expiring.length),
      context: `de ${plural(data.active, 'activo', 'activos')}, hasta el ${formatIsoDate(data.limit)}` },
    { label: 'Borradores por activar', value: data.drafts >= 100 ? '100 o más' : String(data.drafts),
      context: 'versiones en revisión antes de la firma' },
    { label: 'Solicitudes pendientes', value: String(data.requests.pending),
      context: `de ${plural(data.requests.total, 'solicitud', 'solicitudes')} (${data.requests.approved} aprobadas)` },
  ];
}

/** The indicators read from the contracts, drafts and requests themselves, with real totals (not one page). */
function ContractIndicators() {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => {
    setState(current => ({ ...current, status: current.data ? 'refreshing' : 'loading' }));
    setRevision(value => value + 1);
  }, []);
  useCommercialRevalidation(refresh);
  useEffect(() => {
    let active = true;
    getContractsReportIndicators().then(data => { if (active) setState({ status: 'success', data, error: null }); })
      .catch(error => { if (active) setState({ status: 'error', data: null, error }); });
    return () => { active = false; };
  }, [revision]);

  if (state.status === 'loading') return <p role="status" className={CARD}>Calculando indicadores contractuales…</p>;
  if (state.status === 'error') {
    const refused = state.error?.status === 401 || state.error?.status === 403;
    return (
      <div role="alert" className={CARD}>
        <p className="font-semibold text-status-danger">{state.error?.status === 401 ? 'La sesión expiró. Vuelve a iniciar sesión.'
          : state.error?.status === 403 ? 'No tienes permiso para consultar los contratos, borradores o solicitudes.'
            : 'No se pudieron calcular los indicadores. Revisa la conexión e inténtalo de nuevo.'}</p>
        {!refused && <button type="button" onClick={refresh} className="mt-3 text-sm font-semibold text-accent-600 underline">Reintentar</button>}
      </div>
    );
  }
  const { data } = state;
  const columns = [
    { key: 'airline', label: 'Aerolínea', render: row => row.airline },
    { key: 'code', label: 'Contrato', render: row => { const code = contractCodeLabel(row.code); return <span title={code.title}>{code.text}</span>; } },
    { key: 'validTo', label: 'Vence', render: row => formatIsoDate(row.validTo) },
    { key: 'daysLeft', label: 'Días restantes', className: 'text-right tabular-nums',
      render: row => (row.daysLeft === 0 ? 'Hoy' : String(row.daysLeft)) },
  ];
  return (
    <section aria-label="Indicadores contractuales" className={`${CARD} space-y-4`}>
      <div className="space-y-1">
        <h2 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">Indicadores contractuales</h2>
        <p className={`text-xs ${SECONDARY}`}>
          Calculados el {formatIsoDate(data.today)} sobre todos los contratos, borradores y solicitudes registrados.
          {!data.complete && ' La lista de contratos es muy larga: los totales cuentan los primeros 2 000.'}
        </p>
      </div>
      <ReportMetrics metrics={contractMetrics(data)} />
      <div className="space-y-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          Contratos activos que vencen en los próximos {EXPIRING_DAYS} días
        </h3>
        <DataTable caption="Contratos por vencer" columns={columns} rows={data.expiring} getRowId={row => row.id}
          pageSize={Math.max(data.expiring.length, 1)} minWidthClassName="min-w-[560px]"
          emptyState={<EmptyState icon={ContractIcon} title={`Ningún contrato activo vence en los próximos ${EXPIRING_DAYS} días.`} />} />
      </div>
    </section>
  );
}

/** The server's Contratos reports on the common skin, once the API client has them. */
function ContractServerReports() {
  const [today] = useState(() => businessToday());
  const source = useMemo(() => createContractReportSource(), []);
  const report = useServerReport({ source, initialKey: 'agreements', today, initialValues: {} });
  return (
    <>
      <ReportFilterBar report={report} />
      <ServerReportResult report={report} generatedBy={readSession()?.name ?? ''} />
    </>
  );
}

/**
 * Contratos › Reportes (ADR-0048, PR D): the indicators with their context and real totals, and the server's reports
 * with filters and PDF and Excel downloads as soon as the API offers them.
 */
export default function ContractsReportsPage() {
  const [available] = useState(() => contractReportsAvailable());
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Gestión contractual" title="Reportes contractuales"
        description="Contratos, vigencias, borradores y solicitudes con sus totales reales." />
      <ContractIndicators />
      {available && <ContractServerReports />}
    </div>
  );
}
