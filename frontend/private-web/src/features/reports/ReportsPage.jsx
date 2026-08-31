import { useState } from 'react';
import ReportsHeader from './components/ReportsHeader';
import ReportTabs from './components/ReportTabs';
import ReportFilterBar from './components/ReportFilterBar';
import ReportKpiGrid from './components/ReportKpiGrid';
import DailyClosureTable from './components/DailyClosureTable';
import ReconciliationSummaryTable from './components/ReconciliationSummaryTable';
import GroundTimeTable from './components/GroundTimeTable';
import OperationalOverviewCharts from './components/OperationalOverviewCharts';
import ReportSkeleton from './components/ReportSkeleton';
import ReportEmptyState from './components/ReportEmptyState';
import ReviewToastStack from '../review/components/ReviewToast';
import { useReviewToasts } from '../review/useReviewToasts';
import { useReportFilters } from './useReportFilters';
import { useReportFilterOptions, useReportsData } from './useReportsData';
import { computeSummaryKpis, formatPeriodLabel } from './reportsMappers';

const EMPTY_OPTIONS = { airlines: [], agents: [], terminals: [], positions: [] };

export default function ReportsPage({ stationCode = 'PUJ', forceState = 'default' }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const filters = useReportFilters();
  const { toasts, pushToast, dismissToast } = useReviewToasts();

  const { status, data, error } = useReportsData(stationCode, filters.activeReport, filters.resolvedFilters, refreshToken);
  const { options, status: optionsStatus } = useReportFilterOptions(stationCode, refreshToken);

  const isLoading = status === 'loading' || optionsStatus === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'reportsError';
  const isEmpty = forceState === 'reportsEmpty';

  function handleExported(result) {
    pushToast(`Reporte generado correctamente (${result.format.toUpperCase()}).`, 'success');
  }

  function handleExportError() {
    pushToast('No se pudo generar el reporte. Intente nuevamente.', 'error');
  }

  function handleRetry() {
    setRefreshToken(token => token + 1);
  }

  if (isError) {
    return (
      <div
        role="alert"
        className="flex flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No se pudo cargar el reporte solicitado.</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {error?.message ?? 'Verifique la conexión e intente nuevamente.'}
        </p>
        <button
          type="button"
          onClick={handleRetry}
          className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
        >
          Reintentar
        </button>
      </div>
    );
  }

  const rows = isEmpty ? [] : data?.rows ?? [];
  const records = isEmpty ? [] : data?.records ?? [];
  const summaryKpis = computeSummaryKpis(records);

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <ReportsHeader
        periodLabel={formatPeriodLabel(filters.dateRange.from, filters.dateRange.to)}
        activeReport={filters.activeReport}
        onExported={handleExported}
        onExportError={handleExportError}
      />

      <ReportTabs active={filters.activeReport} onChange={filters.setActiveReport} />

      <ReportFilterBar
        activeReport={filters.activeReport}
        datePreset={filters.datePreset}
        customRange={filters.customRange}
        onSelectPreset={filters.setDatePreset}
        onCustomDateChange={filters.setCustomDate}
        facets={filters.facets}
        onFacetChange={filters.setFacet}
        options={options ?? EMPTY_OPTIONS}
        hasActiveFilters={filters.hasActiveFilters}
        onResetFilters={filters.resetFilters}
      />

      {filters.activeReport === 'summary' && <ReportKpiGrid kpis={summaryKpis} loading={isLoading} />}

      {isLoading ? (
        <ReportSkeleton rows={filters.activeReport === 'summary' ? 4 : 6} />
      ) : filters.activeReport === 'summary' ? (
        records.length === 0 ? (
          <ReportEmptyState />
        ) : (
          <OperationalOverviewCharts records={records} />
        )
      ) : filters.activeReport === 'closure' ? (
        <DailyClosureTable rows={rows} />
      ) : filters.activeReport === 'reconciliation' ? (
        <ReconciliationSummaryTable rows={rows} />
      ) : (
        <GroundTimeTable rows={rows} />
      )}

      <ReviewToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
