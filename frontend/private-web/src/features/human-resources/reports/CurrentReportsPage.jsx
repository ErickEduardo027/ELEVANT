import { useEffect, useMemo, useState } from 'react';
import PageHeader from '../../../components/PageHeader';
import ReportFilterBar, { ReportSelectFilter } from '../../../components/reports/ReportFilterBar';
import ServerReportResult from '../../../components/reports/ServerReportResult';
import { useAuth } from '../../auth/AuthContext';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { businessToday } from '../../../services/businessDay';
import { useServerReport } from '../../reports/useServerReport';
import usePermitTypeCatalog from '../permits/usePermitTypeCatalog';
import { createHrReportSource, DOCUMENT_KIND_OPTIONS, VALIDITY_OPTIONS } from './hrReportSource';

const PAGE_LIMIT = 20;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
// The resources after which a generated report is read again: a revoked access takes its rows off the screen.
const WATCHED_RESOURCES = new Set(['ramp_profiles', 'hr_qualifications', 'hr_permits', 'hr_shifts', 'iam_accounts']);

const labelOf = (options, value) => options.find(option => option.value === value)?.label ?? '';

/**
 * Gestión Humana › Reportes (ADR-0048, PR D): the four server reports on the common skin, by authorized station,
 * with the period shortcuts in AVIAM's calendar, the expiration filters, «Filtros aplicados», «Generado el … por …»
 * and the whole period in PDF or Excel.
 */
function HumanResourcesReports({ session, initialDate }) {
  const permitTypes = usePermitTypeCatalog();
  const stationScopes = session?.stationScopes;
  const scopes = useMemo(() => (Array.isArray(stationScopes) ? stationScopes : [])
    .filter(scope => UUID.test(scope?.stationId ?? '') && typeof scope.stationCode === 'string'), [stationScopes]);
  const [today] = useState(() => businessToday(initialDate));
  const source = useMemo(() => createHrReportSource({ permitNames: permitTypes.names }), [permitTypes.names]);
  const initialValues = useMemo(() => ({ stationId: scopes[0]?.stationId ?? '' }), [scopes]);
  const report = useServerReport({
    source, initialKey: 'expirations', today, initialValues, pageSize: PAGE_LIMIT,
    enabled: scopes.length > 0, autoGenerate: true,
    describe: query => [
      { label: 'Estación', value: scopes.find(scope => scope.stationId === query.stationId)?.stationCode, base: true },
      { label: 'Clase de documento', value: labelOf(DOCUMENT_KIND_OPTIONS, query.documentKind) },
      { label: 'Vigencia', value: labelOf(VALIDITY_OPTIONS, query.validity) },
    ],
  });
  const { draft, setValue, refresh } = report;

  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => WATCHED_RESOURCES.has(resource))) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [refresh]);

  const header = (
    <PageHeader eyebrow="Gestión Humana · consulta autorizada" title="Reportes de personal"
      description="Genera cada reporte por estación autorizada, revísalo en pantalla y descarga el período completo en PDF o en Excel." />
  );
  if (!scopes.length) {
    return (
      <section className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
        {header}
        <p role="alert" className="rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card">
          No tienes una estación autorizada para estos reportes.
        </p>
      </section>
    );
  }
  return (
    <section className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      {header}
      <ReportFilterBar report={report}>
        <ReportSelectFilter label="Estación autorizada" value={draft.values.stationId} allLabel={null}
          options={scopes.map(scope => ({ value: scope.stationId, label: scope.stationCode }))}
          onChange={value => setValue('stationId', value)} />
        {draft.key === 'expirations' && <>
          <ReportSelectFilter label="Clase de documento" value={draft.values.documentKind ?? ''}
            options={DOCUMENT_KIND_OPTIONS} onChange={value => setValue('documentKind', value)} />
          <ReportSelectFilter label="Vigencia" value={draft.values.validity ?? ''} options={VALIDITY_OPTIONS}
            onChange={value => setValue('validity', value)} />
        </>}
      </ReportFilterBar>
      <ServerReportResult report={report} generatedBy={session?.name ?? ''} />
    </section>
  );
}

/** A new session starts a new screen: no row of the previous account survives it. */
export default function CurrentReportsPage({ initialDate = new Date() }) {
  const { session } = useAuth();
  return <HumanResourcesReports key={session?.token ?? 'anonymous'} session={session} initialDate={initialDate} />;
}
