import { Link } from 'react-router-dom';
import { useState } from 'react';
import KpiCard from '../../../components/KpiCard';
import Badge from '../../../components/Badge';
import StatusBadge from '../../../components/StatusBadge';
import ProgressRing from '../../../components/ProgressRing';
import CategoryDonutChart from '../../../components/CategoryDonutChart';
import HorizontalBarList from '../../../components/HorizontalBarList';
import { TONE_HEX } from '../../../components/toneColors';
import { RefreshCwIcon } from '../../shell/components/icons';
import ReportTabs from '../../reports/components/ReportTabs';
import ReportFilterBar from '../../reports/components/ReportFilterBar';
import ExportButton from '../../reports/components/ExportButton';
import ReportTable from '../../reports/components/ReportTable';
import BarChart from '../../reports/components/BarChart';
import ReportSkeleton from '../../reports/components/ReportSkeleton';
import ReportEmptyState from '../../reports/components/ReportEmptyState';
import {
  buildCoverageChartData,
  buildCoverageSummary,
  buildMovementTrend,
  buildStaffShiftItems,
  buildStaffTerminalSegments,
  formatDateKey,
  formatEventDateTime,
  REPORT_TABS,
} from './reportsMappers';
import { useHumanResourcesReportFilters } from './useReportFilters';
import { useHumanResourcesReportsData } from './useReportsData';
import { exportReport as exportHumanResourcesReport } from '../../../services/humanResourcesReportsService';

const REPORT_META = {
  expirations: {
    title: 'Vencimientos',
    description: 'Carnets, licencias y habilitaciones próximas a vencer, ordenadas por urgencia.',
  },
  accountMovements: {
    title: 'Altas y bajas',
    description: 'Movimientos de activación y desactivación de cuentas, con su tendencia por fecha.',
  },
  staffDistribution: {
    title: 'Personal por terminal y turno',
    description: 'Distribución del personal de rampa por terminal y bloque horario.',
  },
  qualificationCoverage: {
    title: 'Cobertura de habilitaciones',
    description: 'Cobertura vigente por tipo de equipo frente a la necesidad operativa.',
  },
};

const STAFF_MOVEMENT_TONES = {
  alta: 'success',
  baja: 'danger',
};

function formatDate(dateISO) {
  if (!dateISO) return '—';
  return new Date(dateISO).toLocaleDateString('es-DO', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function SectionCard({ title, description, children }) {
  return (
    <section className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-4">
        <h2 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{title}</h2>
        {description && <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{description}</p>}
      </div>
      {children}
    </section>
  );
}

function SummaryGrid({ items }) {
  return (
    <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-4">
      {items.map(item => (
        <KpiCard key={item.label} {...item} />
      ))}
    </div>
  );
}

function EmptyReportMessage({ message }) {
  return <ReportEmptyState message={message} />;
}

function ExpirationExpandedRow(row) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div className="space-y-1">
        <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">{row.agentName}</p>
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {row.kindLabel} · {row.documentLabel} · {row.dueLabel}
        </p>
      </div>
      <Link
        to={`${row.modulePath}?agentId=${row.agentId}`}
        className="rounded-lg bg-accent-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-accent-600/90"
      >
        Abrir detalle
      </Link>
    </div>
  );
}

function CoverageExpandedRow(row) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={row.coverageTone === 'success' ? 'success' : row.coverageTone === 'warning' ? 'warning' : row.coverageTone === 'danger' ? 'danger' : 'neutral'} label={`${row.activeCount} vigentes`} />
        <Badge tone="neutral" label={`${row.needCount} necesarios`} />
        <Badge tone="neutral" label={`${row.warningCount} próximas a vencer`} />
        <Badge tone="neutral" label={`${row.expiredCount} vencidas`} />
      </div>
      <div className="grid gap-2 sm:grid-cols-2">
        {row.qualifications.map(qualification => (
          <div key={`${qualification.agentId}-${qualification.equipmentId}`} className="rounded-xl border border-black/5 bg-white/60 p-3 dark:border-white/5 dark:bg-white/[0.02]">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm font-medium text-ink-900 dark:text-text-primary-dark">{qualification.agentName}</p>
              <StatusBadge tone={qualification.statusTone} label={qualification.statusLabel} />
            </div>
            <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">{qualification.dueLabel}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

function buildExpirationSummary(rows) {
  return {
    total: rows.length,
    current: rows.filter(row => row.status === 'current').length,
    expiringSoon: rows.filter(row => row.status === 'expiringSoon').length,
    expired: rows.filter(row => row.status === 'expired').length,
  };
}

function buildMovementSummary(rows) {
  const alta = rows.filter(row => row.movementKind === 'alta').length;
  const baja = rows.filter(row => row.movementKind === 'baja').length;
  return {
    total: rows.length,
    alta,
    baja,
    balance: alta - baja,
  };
}

function buildStaffSummary(rows) {
  const byTerminal = rows.reduce(
    (acc, row) => {
      acc[row.terminal] = (acc[row.terminal] ?? 0) + 1;
      return acc;
    },
    { A: 0, B: 0, FBO: 0 }
  );

  return {
    total: rows.length,
    terminalA: byTerminal.A ?? 0,
    terminalB: byTerminal.B ?? 0,
    fbo: byTerminal.FBO ?? 0,
  };
}

function buildCoverageSegments(summary) {
  return [
    { key: 'healthy', label: 'Cobertura alta', value: summary.active, color: TONE_HEX.success },
    { key: 'warning', label: 'Cobertura media', value: summary.warning, color: TONE_HEX.warning },
    { key: 'critical', label: 'Cobertura baja', value: summary.critical, color: TONE_HEX.danger },
  ];
}

function buildExpirationColumns() {
  return [
    {
      key: 'agent',
      label: 'Agente',
      sortValue: row => row.agentName,
      render: row => (
        <div>
          <div className="font-medium text-ink-900 dark:text-text-primary-dark">{row.agentName}</div>
          <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{row.kindLabel}</div>
        </div>
      ),
    },
    { key: 'document', label: 'Documento / habilitación', sortValue: row => row.documentLabel, render: row => row.documentLabel },
    {
      key: 'terminal',
      label: 'Terminal',
      sortValue: row => row.terminals.join(', '),
      render: row => row.terminals.length > 0 ? row.terminals.map(terminal => `Terminal ${terminal}`).join(' / ') : 'Sin terminal',
    },
    { key: 'dueDate', label: 'Vencimiento', sortValue: row => row.dueDate, render: row => formatDate(row.dueDate) },
    {
      key: 'daysRemaining',
      label: 'Días restantes',
      sortValue: row => row.daysRemaining,
      render: row => <span className="font-mono tabular-nums">{row.daysRemaining}</span>,
    },
    {
      key: 'status',
      label: 'Estado',
      sortValue: row => row.status,
      render: row => <StatusBadge tone={row.statusTone} label={row.statusLabel} />,
    },
  ];
}

function buildMovementColumns() {
  return [
    { key: 'occurredAt', label: 'Fecha', sortValue: row => row.occurredAt, render: row => formatEventDateTime(row.occurredAt) },
    {
      key: 'movement',
      label: 'Movimiento',
      sortValue: row => row.movementKind,
      render: row => <Badge tone={STAFF_MOVEMENT_TONES[row.movementKind] ?? 'default'} label={row.movement} />,
    },
    { key: 'userName', label: 'Usuario', sortValue: row => row.userName, render: row => row.userName },
    { key: 'roleName', label: 'Rol', sortValue: row => row.roleName, render: row => row.roleName },
    { key: 'performedBy', label: 'Realizado por', sortValue: row => row.performedBy, render: row => row.performedBy },
  ];
}

function buildStaffColumns() {
  return [
    { key: 'agentName', label: 'Agente', sortValue: row => row.agentName, render: row => row.agentName },
    {
      key: 'terminal',
      label: 'Terminal',
      sortValue: row => row.terminal,
      render: row => `Terminal ${row.terminal}`,
    },
    {
      key: 'block',
      label: 'Turno',
      sortValue: row => row.block,
      render: row => ({
        morning: 'Mañana',
        afternoon: 'Tarde',
        night: 'Madrugada',
      }[row.block] ?? row.block),
    },
    { key: 'date', label: 'Fecha', sortValue: row => row.date, render: row => formatDateKey(row.date) },
  ];
}

function buildCoverageColumns() {
  return [
    {
      key: 'equipment',
      label: 'Equipo',
      sortValue: row => row.equipmentName,
      render: row => (
        <div>
          <div className="font-medium text-ink-900 dark:text-text-primary-dark">{row.equipmentName}</div>
          <div className="text-xs text-text-secondary-light dark:text-text-secondary-dark">
            {row.terminals.length > 0 ? `Terminal ${row.terminals.join(' / ')}` : 'Sin terminal asignada'}
          </div>
        </div>
      ),
    },
    {
      key: 'needCount',
      label: 'Necesidad operativa',
      sortValue: row => row.needCount,
      render: row => <span className="font-mono tabular-nums">{row.needCount}</span>,
    },
    {
      key: 'activeCount',
      label: 'Vigentes',
      sortValue: row => row.activeCount,
      render: row => <span className="font-mono tabular-nums">{row.activeCount}</span>,
    },
    {
      key: 'coveragePercent',
      label: 'Cobertura',
      sortValue: row => row.coveragePercent ?? -1,
      render: row => (
        <div className="flex items-center gap-2">
          <ProgressRing percent={row.coveragePercent ?? 0} size={44} strokeWidth={5} />
          <span className="font-medium">{row.coveragePercent == null ? 'Sin datos' : `${row.coveragePercent}%`}</span>
        </div>
      ),
    },
    {
      key: 'state',
      label: 'Estado',
      sortValue: row => row.coverageTone,
      render: row => (
        <StatusBadge
          tone={row.coverageTone}
          label={row.coveragePercent == null ? 'Sin cobertura' : row.coveragePercent >= 80 ? 'Cobertura alta' : row.coveragePercent >= 60 ? 'Cobertura media' : 'Cobertura baja'}
        />
      ),
    },
  ];
}

export default function ReportsPage({ forceState = 'default' }) {
  const [refreshToken, setRefreshToken] = useState(0);
  const filters = useHumanResourcesReportFilters();
  const { status, data, error, refresh, exportReport } = useHumanResourcesReportsData(filters.activeReport, filters.resolvedFilters, refreshToken);

  const isLoading = status === 'loading' || forceState === 'loading';
  const isError = (status === 'error' && forceState === 'default') || forceState === 'reportsError';
  const isEmpty = forceState === 'reportsEmpty';

  const activeMeta = REPORT_META[filters.activeReport];

  function handleRetry() {
    setRefreshToken(token => token + 1);
  }

  const expirations = filters.activeReport === 'expirations' ? (isEmpty ? [] : data?.rows ?? []) : [];
  const movements = filters.activeReport === 'accountMovements' ? (isEmpty ? [] : data?.rows ?? []) : [];
  const staff = filters.activeReport === 'staffDistribution' ? (isEmpty ? [] : data?.rows ?? []) : [];
  const coverage = filters.activeReport === 'qualificationCoverage' ? (isEmpty ? [] : data?.coverage ?? []) : [];
  const expirationSummary = buildExpirationSummary(expirations);
  const movementSummary = buildMovementSummary(movements);
  const staffSummary = buildStaffSummary(staff);
  const coverageSummary = buildCoverageSummary(coverage);

  if (isError) {
    return (
      <div
        role="alert"
        className="mx-auto flex max-w-[1440px] flex-col items-start gap-3 rounded-2xl border border-status-danger/30 bg-white/70 p-6 backdrop-blur-md dark:bg-surface-dark-card"
      >
        <p className="text-sm font-semibold text-status-danger">No fue posible cargar los reportes de Gestión Humana.</p>
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

  const reportFilterProps = {
    activeReport: filters.activeReport,
    datePreset: filters.datePreset,
    customRange: filters.customRange,
    onSelectPreset: filters.setDatePreset,
    onCustomDateChange: filters.setCustomDate,
    hasActiveFilters: filters.hasActiveFilters,
    onResetFilters: filters.resetFilters,
    activeChips: filters.activeChips,
    showDatePicker: filters.activeReport !== 'expirations',
  };

  return (
    <div className="mx-auto max-w-[1440px] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
        <div>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Recursos Humanos / Reportes</p>
          <h1 className="text-lg font-semibold text-ink-900 dark:text-text-primary-dark">{activeMeta.title}</h1>
          <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">{activeMeta.description}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            aria-label="Actualizar"
            className="flex items-center gap-1.5 rounded-lg border border-black/10 px-2.5 py-1.5 text-xs font-medium text-ink-900 hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <RefreshCwIcon className="h-3.5 w-3.5" /> Actualizar
          </button>
          <ExportButton reportId={filters.activeReport} exportFn={exportHumanResourcesReport} />
        </div>
      </div>

      <ReportTabs tabs={REPORT_TABS} active={filters.activeReport} onChange={filters.setActiveReport} />

      <ReportFilterBar
        {...reportFilterProps}
        controls={
          filters.activeReport === 'expirations'
            ? filters.expirationControls
            : filters.activeReport === 'accountMovements'
              ? filters.movementControls
              : filters.activeReport === 'staffDistribution'
                ? filters.staffControls
                : filters.coverageControls
        }
      />

      {filters.activeReport === 'expirations' && (
        <SummaryGrid
          items={[
            { label: 'Documentos', value: expirations.length },
            { label: 'Vigentes', value: expirationSummary.current, tone: 'signal' },
            { label: 'Próximas a vencer', value: expirationSummary.expiringSoon, tone: 'warning' },
            { label: 'Vencidas', value: expirationSummary.expired, tone: 'danger', emphasize: true },
          ]}
        />
      )}

      {filters.activeReport === 'accountMovements' && (
        <SummaryGrid
          items={[
            { label: 'Movimientos', value: movements.length },
            { label: 'Altas', value: movementSummary.alta, tone: 'signal' },
            { label: 'Bajas', value: movementSummary.baja, tone: 'danger' },
            { label: 'Balance', value: movementSummary.balance, tone: 'default' },
          ]}
        />
      )}

      {filters.activeReport === 'staffDistribution' && (
        <SummaryGrid
          items={[
            { label: 'Turnos', value: staff.length },
            { label: 'Terminal A', value: staffSummary.terminalA, tone: 'default' },
            { label: 'Terminal B', value: staffSummary.terminalB, tone: 'signal' },
            { label: 'FBO', value: staffSummary.fbo, tone: 'warning' },
          ]}
        />
      )}

      {filters.activeReport === 'qualificationCoverage' && (
        <SummaryGrid
          items={[
            { label: 'Equipos', value: coverage.length },
            {
              label: 'Cobertura media',
              value: coverageSummary.averageCoverage,
              visual: <ProgressRing percent={coverageSummary.averageCoverage} size={64} strokeWidth={7} />,
            },
            { label: 'Cobertura alta', value: coverageSummary.active, tone: 'signal' },
            { label: 'En riesgo', value: coverageSummary.warning, tone: 'warning' },
          ]}
        />
      )}

      {isLoading ? (
        <ReportSkeleton rows={filters.activeReport === 'expirations' ? 5 : 6} />
      ) : filters.activeReport === 'expirations' ? (
        expirations.length === 0 ? (
          <EmptyReportMessage message="No hay vencimientos para los filtros seleccionados." />
        ) : (
          <ReportTable
            columns={buildExpirationColumns()}
            rows={expirations}
            getSearchableText={row => [row.agentName, row.documentLabel, row.kindLabel, row.terminals.join(' '), row.statusLabel].join(' ')}
            searchPlaceholder="Agente, documento, terminal, estado"
            isCriticalRow={row => row.status === 'expired'}
            renderExpanded={ExpirationExpandedRow}
          />
        )
      ) : filters.activeReport === 'accountMovements' ? (
        <div className="space-y-4">
          {movements.length === 0 ? (
            <EmptyReportMessage message="No hay movimientos de cuentas para el período seleccionado." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <BarChart title="Altas / activaciones por fecha" data={buildMovementTrend(movements, 'alta')} />
                <BarChart title="Bajas / desactivaciones por fecha" data={buildMovementTrend(movements, 'baja')} />
              </div>
              <ReportTable
                columns={buildMovementColumns()}
                rows={movements}
                getSearchableText={row => [row.userName, row.movement, row.roleName, row.performedBy].join(' ')}
                searchPlaceholder="Usuario, rol o responsable"
              />
            </>
          )}
        </div>
      ) : filters.activeReport === 'staffDistribution' ? (
        <div className="space-y-4">
          {staff.length === 0 ? (
            <EmptyReportMessage message="No hay turnos para el período seleccionado." />
          ) : (
            <>
              <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
                <SectionCard title="Distribución por terminal" description="Terminal A, Terminal B y FBO según los turnos disponibles.">
                  <CategoryDonutChart segments={buildStaffTerminalSegments(staff)} />
                </SectionCard>
                <SectionCard title="Distribución por turno" description="Cantidad de turnos cubiertos por bloque horario.">
                  <HorizontalBarList items={buildStaffShiftItems(staff)} />
                </SectionCard>
              </div>
              <ReportTable
                columns={buildStaffColumns()}
                rows={staff}
                getSearchableText={row => [row.agentName, row.terminal, row.block, row.date].join(' ')}
                searchPlaceholder="Agente, terminal, turno o fecha"
              />
            </>
          )}
        </div>
      ) : coverage.length === 0 ? (
        <EmptyReportMessage message="No hay cobertura de habilitaciones para el corte seleccionado." />
      ) : (
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
            <BarChart title="Cobertura por tipo de equipo" data={buildCoverageChartData(coverage)} orientation="horizontal" />
            <SectionCard title="Cobertura global" description="Distribución general entre cobertura alta, media y baja.">
              <CategoryDonutChart segments={buildCoverageSegments(coverageSummary)} />
            </SectionCard>
          </div>
          <ReportTable
            columns={buildCoverageColumns()}
            rows={coverage}
            getSearchableText={row => [row.equipmentName, row.terminals.join(' '), row.coveragePercent, row.needCount, row.activeCount].join(' ')}
            searchPlaceholder="Equipo o terminal"
            renderExpanded={CoverageExpandedRow}
            isCriticalRow={row => row.coverageTone === 'danger'}
          />
        </div>
      )}
    </div>
  );
}
