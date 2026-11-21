import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import ReportFilterBar, { ReportSelectFilter } from '../../../components/reports/ReportFilterBar';
import ServerReportResult from '../../../components/reports/ServerReportResult';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { readSession } from '../../auth/authService';
import { businessToday } from '../../../services/businessDay';
import { FINANCE_CURRENCIES } from '../../../services/financeBookService';
import { getTreasuryOptions } from '../../../services/financeTreasuryService';
import { useServerReport } from '../../reports/useServerReport';
import { createFinanceReportSource } from './financeReportSource';

/** The airlines Finance invoices, for the «Aerolínea» filter; `null` when the account cannot read them. */
function useFinanceAirlines() {
  const [airlines, setAirlines] = useState(null);
  useEffect(() => {
    const controller = new AbortController();
    getTreasuryOptions({ signal: controller.signal })
      .then(options => {
        if (!controller.signal.aborted) setAirlines((options?.airlines ?? []).map(airline => ({ value: airline.id, label: airline.name })));
      })
      .catch(() => { if (!controller.signal.aborted) setAirlines(null); });
    return () => controller.abort();
  }, []);
  return airlines;
}

/**
 * Finanzas › Reportes (4-A, 4-N19, 4-N20; ADR-0048, PR D): the six server reports on the common skin, with the period
 * shortcuts, station, airline and currency, the cut-off reports by their date, the figures with their context, the
 * totals of each column that adds up and the whole period in PDF or Excel.
 */
export default function FinanceReportsPage({ initialStationId }) {
  const { access } = useDepartmentAccess();
  const canExport = Boolean(access?.can('finance.reports.export'));
  const session = readSession();
  const stations = useMemo(() => (session?.stationScopes ?? []).filter(scope => scope?.stationId), [session?.stationScopes]);
  const airlines = useFinanceAirlines();
  const [today] = useState(() => businessToday());
  const source = useMemo(() => createFinanceReportSource(), []);
  const initialValues = useMemo(() => ({ stationId: initialStationId ?? '' }), [initialStationId]);
  const report = useServerReport({
    source, initialKey: 'revenue', today, initialValues, autoGenerate: true,
    describe: query => [
      { label: 'Estación', base: true, value: query.stationId
        ? stations.find(station => station.stationId === query.stationId)?.stationCode ?? 'Elegida' : 'Todas tus estaciones' },
      { label: 'Aerolínea', value: query.airlineId ? airlines?.find(item => item.value === query.airlineId)?.label : '' },
      { label: 'Moneda', value: query.currency ?? '' },
    ],
  });
  const { draft, setValue } = report;

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Reportes financieros"
        description="Reportes calculados en el servidor sobre tus estaciones, con sus filtros y totales, en PDF o en Excel." />
      <ReportFilterBar report={report}>
        {stations.length > 1 && (
          <ReportSelectFilter label="Estación" value={draft.values.stationId} onChange={value => setValue('stationId', value)}
            options={stations.map(station => ({ value: station.stationId, label: station.stationCode }))} />
        )}
        {airlines?.length > 0 && (
          <ReportSelectFilter label="Aerolínea" value={draft.values.airlineId} onChange={value => setValue('airlineId', value)}
            options={airlines} />
        )}
        <ReportSelectFilter label="Moneda" value={draft.values.currency} onChange={value => setValue('currency', value)}
          options={FINANCE_CURRENCIES.map(code => ({ value: code, label: code }))} />
      </ReportFilterBar>
      <ServerReportResult report={report} canExport={canExport} generatedBy={session?.name ?? ''} />
    </div>
  );
}
