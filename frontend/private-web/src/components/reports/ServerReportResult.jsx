import DataTable from '../DataTable';
import EmptyState from '../EmptyState';
import { BarChartIcon } from '../../features/shell/components/icons';
import {
  filtersSummary, formatGeneratedAt, formatReportValue, isNumericType, rowsCountText,
} from '../../features/reports/reportModel';

const CARD = 'rounded-2xl border border-black/5 bg-white/70 p-5 dark:border-white/5 dark:bg-surface-dark-card';
const SECONDARY = 'text-text-secondary-light dark:text-text-secondary-dark';
const OUTLINE = 'min-h-[40px] rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600 '
  + 'disabled:opacity-50';

export const PDF_TOO_LARGE = 'El PDF admite hasta 5 000 filas: descarga el Excel o acota el período y los filtros.';

/** The sentence of a failed download: an oversized PDF points to Excel; anything else is the service's message. */
export function exportErrorText(error) {
  if (!error) return '';
  if (error.format === 'pdf' && error.code === 'report_too_large') return PDF_TOO_LARGE;
  return `No se pudo descargar el ${error.format === 'pdf' ? 'PDF' : 'Excel'}: ${error.message}`;
}

/** The summary figures with their context («3» «de 40 decisiones (7.5 %)»): never a cold number (G3). */
export function ReportMetrics({ metrics }) {
  if (!metrics?.length) return null;
  return (
    <dl aria-label="Resumen del reporte" className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(metric => (
        <div key={metric.label} className="rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark">
          <dt className={`text-xs font-semibold ${SECONDARY}`}>{metric.label}</dt>
          <dd className="mt-1 text-xl font-bold tabular-nums text-ink-900 dark:text-text-primary-dark">{metric.value}</dd>
          {metric.context && <dd className={`mt-0.5 text-xs ${SECONDARY}`}>{metric.context}</dd>}
        </div>
      ))}
    </dl>
  );
}

function cellText(row, column, index) {
  return formatReportValue(row[index], column.type, { currency: column.currencyOf?.(row) ?? '' });
}

/**
 * The result of a department report (ADR-0048, PR D): title, description, «Generado el … por …» and «Filtros
 * aplicados», the two downloads side by side («Descargar PDF», «Descargar Excel»), the figures with context, the table
 * with its row count and totals, and its pages. Before the first «Generar», while it loads and when it fails, the same
 * place says so; a refusal (403) offers no retry.
 */
export default function ServerReportResult({ report, canExport = true, generatedBy = '', idleText }) {
  const { applied, catalog, failure, report: state, totals } = report;
  if (catalog.status === 'error') {
    return (
      <div role="alert" className={CARD}>
        <p className="font-semibold text-status-danger">{catalog.error.message || 'No se pudo leer la lista de reportes.'}</p>
        {catalog.error.retryable && (
          <button type="button" onClick={report.retryCatalog} className="mt-3 text-sm font-semibold text-accent-600 underline">
            Reintentar
          </button>
        )}
      </div>
    );
  }
  if (catalog.status === 'loading') return <p role="status" className={CARD}>Cargando reportes…</p>;
  if (!applied) {
    return (
      <div className={CARD}>
        <EmptyState icon={BarChartIcon} title="Elige el reporte y los filtros, y pulsa «Generar»."
          description={idleText ?? 'El reporte se calcula en el servidor y se descarga en PDF o en Excel.'} />
      </div>
    );
  }
  if (state.status === 'loading' && !state.data) return <p role="status" className={CARD}>Generando reporte…</p>;
  if (state.status === 'error') {
    return (
      <div role="alert" className={CARD}>
        <p className="font-semibold text-status-danger">{failure.message || 'No se pudo generar el reporte.'}</p>
        {failure.retryable && (
          <button type="button" onClick={report.retry} className="mt-3 text-sm font-semibold text-accent-600 underline">
            Reintentar
          </button>
        )}
      </div>
    );
  }

  const data = state.data;
  if (!data) return null;
  const tableColumns = data.columns.map((column, index) => ({
    key: String(index), label: column.label,
    className: isNumericType(column.type) ? 'text-right tabular-nums' : '',
    render: row => cellText(row.cells, column, index),
  }));
  const rows = data.rows.map((cells, index) => ({ id: index, cells }));
  const footer = totals ? [{ id: 'totals', cells: totals.cells.map((cell, index) => (index === 0 && cell === totals.label
    ? cell : cell === '' ? '' : formatReportValue(cell, data.columns[index]?.type,
      { currency: data.columns[index]?.currencyOf?.(data.rows[0] ?? []) ?? '' }))) }] : null;
  const count = rowsCountText({ rows: data.rows.length, totalRows: data.totalRows ?? null, page: data.page ?? 1,
    paged: report.paged });
  const summary = filtersSummary(report.summary);
  const empty = data.rows.length === 0;
  const exportMessage = exportErrorText(report.exportError);

  return (
    <section aria-label={data.title} className={`${CARD} space-y-4`}>
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-black/5 pb-4 dark:border-white/10">
        <div className="min-w-0 max-w-3xl space-y-1">
          <h2 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{data.title}</h2>
          {(data.description ?? applied.definition.description) && (
            <p className={`text-sm ${SECONDARY}`}>{data.description ?? applied.definition.description}</p>
          )}
          <p className={`text-xs ${SECONDARY}`}>{formatGeneratedAt(data.asOf, { by: data.generatedBy || generatedBy })}</p>
          {summary && <p className="text-xs font-medium text-ink-900 dark:text-text-primary-dark">{summary}</p>}
          {count && <p className={`text-xs ${SECONDARY}`}>{count}</p>}
        </div>
        {canExport && (
          <div role="group" aria-label="Descargas del reporte" className="flex flex-wrap gap-2">
            <button type="button" className={OUTLINE} disabled={Boolean(report.exporting) || empty}
              aria-busy={report.exporting === 'pdf' || undefined} onClick={() => void report.exportAs('pdf')}>
              {report.exporting === 'pdf' ? 'Preparando PDF…' : 'Descargar PDF'}
            </button>
            <button type="button" disabled={Boolean(report.exporting) || empty}
              aria-busy={report.exporting === 'xlsx' || undefined} onClick={() => void report.exportAs('xlsx')}
              className="min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">
              {report.exporting === 'xlsx' ? 'Preparando Excel…' : 'Descargar Excel'}
            </button>
          </div>
        )}
      </div>
      {exportMessage && <p role="alert" className="text-sm text-status-danger">{exportMessage}</p>}
      <ReportMetrics metrics={data.summary} />
      <DataTable caption={data.title} columns={tableColumns} rows={rows} getRowId={row => row.id}
        pageSize={Math.max(rows.length, 1)} loading={state.status === 'loading'} footerRows={footer}
        emptyState={<EmptyState icon={BarChartIcon} title="No hay datos para estos filtros."
          description="Prueba otro período, otra estación u otros filtros." />} />
      {report.paged && (data.page > 1 || data.hasMore) && (
        <nav aria-label="Páginas del reporte" className="flex items-center justify-between gap-4 text-sm">
          <button type="button" disabled={data.page <= 1 || state.status === 'loading'} onClick={() => report.turnPage(-1)}
            className="rounded-lg border border-black/10 px-3 py-2 font-semibold disabled:opacity-50 dark:border-white/10">
            Página anterior
          </button>
          <span>Página {data.page}</span>
          <button type="button" disabled={!data.hasMore || state.status === 'loading'} onClick={() => report.turnPage(1)}
            className="rounded-lg border border-black/10 px-3 py-2 font-semibold disabled:opacity-50 dark:border-white/10">
            Página siguiente
          </button>
        </nav>
      )}
      {data.notes?.map(note => <p key={note} className={`text-xs ${SECONDARY}`}>{note}</p>)}
    </section>
  );
}
