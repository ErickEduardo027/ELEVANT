import { useEffect, useMemo, useState } from 'react';
import Tabs from '../../../../components/Tabs';
import StatusBadge from '../../../../components/StatusBadge';
import EmptyState from '../../../../components/EmptyState';
import { AlertTriangleIcon } from '../../../shell/components/icons';
import { buildCoverageForDate, groupCoverageByBlock, filterShiftsByWeek, indexShiftsByDate } from '../mappers';
import { COVERAGE_STATUS_META } from '../statusMeta';

function PositionRow({ entry }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1 text-xs">
      <span className="truncate text-text-secondary-light dark:text-text-secondary-dark">{entry.positionName}</span>
      <span className="font-mono font-medium tabular-nums text-ink-900 dark:text-text-primary-dark">
        {entry.assignedCount}/{entry.requiredCount}
      </span>
    </div>
  );
}

function TerminalCard({ terminal, entries }) {
  const worstStatus = entries.some(entry => entry.status === 'critical')
    ? 'critical'
    : entries.some(entry => entry.status === 'at_risk')
      ? 'at_risk'
      : 'complete';
  const meta = COVERAGE_STATUS_META[worstStatus];

  return (
    <div className="min-w-[220px] flex-1 rounded-xl border border-black/5 bg-white/70 p-3 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h4 className="text-xs font-semibold text-ink-900 dark:text-text-primary-dark">Terminal {terminal}</h4>
        <StatusBadge tone={meta.tone} label={meta.label} />
      </div>
      {entries.length === 0 ? (
        <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Sin posiciones requeridas.</p>
      ) : (
        <div className="divide-y divide-black/5 dark:divide-white/5">
          {entries.map(entry => (
            <PositionRow key={entry.key} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

function BlockSection({ group }) {
  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">
          {group.block.label} · {group.block.startTime}–{group.block.endTime}
        </h3>
        {group.combinedRisk && (
          <span className="flex items-center gap-1.5 rounded-full bg-status-warning/10 px-2 py-0.5 text-[11px] font-medium text-status-warning">
            <AlertTriangleIcon className="h-3 w-3" /> Pocos agentes cubren ambos terminales
          </span>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <TerminalCard terminal="A" entries={group.byTerminal.A} />
        <TerminalCard terminal="B" entries={group.byTerminal.B} />
      </div>
    </div>
  );
}

function SkeletonGrid() {
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className="h-48 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card" />
      ))}
    </div>
  );
}

// Vista "Cobertura por posición" (skill.md §"COBERTURA POR POSICIÓN"): por
// franja horaria, agentes disponibles vs. posiciones requeridas por
// Terminal A/B. Un selector de día (Tabs) acota la grilla a una sola fecha
// de la semana visible — la demanda cambia durante el día, así que mezclar
// los 7 días en una sola vista ocultaría justo los déficits puntuales que
// el skill pide poder detectar.
export default function CoverageByPositionView({ weekDays, shifts, coverageRequirements, positionsById, shiftBlocks, loading }) {
  const [selectedDateKey, setSelectedDateKey] = useState(() => weekDays.find(day => day.isToday)?.dateKey ?? weekDays[0]?.dateKey);

  useEffect(() => {
    if (!weekDays.some(day => day.dateKey === selectedDateKey)) {
      setSelectedDateKey(weekDays.find(day => day.isToday)?.dateKey ?? weekDays[0]?.dateKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [weekDays]);

  const shiftsByDate = useMemo(() => indexShiftsByDate(filterShiftsByWeek(shifts, weekDays)), [shifts, weekDays]);

  if (loading) return <SkeletonGrid />;

  if (coverageRequirements.length === 0) {
    return (
      <EmptyState
        icon={AlertTriangleIcon}
        title="No hay requisitos de cobertura configurados."
        description="Los requisitos por posición y terminal aparecerán aquí una vez configurados."
      />
    );
  }

  const dayTabs = weekDays.map(day => ({ id: day.dateKey, label: `${day.weekdayLabel} ${day.dayLabel}` }));
  const entries = buildCoverageForDate(shiftsByDate.get(selectedDateKey) ?? [], coverageRequirements, positionsById);
  const groups = groupCoverageByBlock(entries, shiftBlocks);

  return (
    <div className="space-y-4">
      <Tabs tabs={dayTabs} activeId={selectedDateKey} onChange={setSelectedDateKey} />
      <div key={selectedDateKey} className="grid animate-fade-in grid-cols-1 gap-4 lg:grid-cols-3">
        {groups.map(group => (
          <BlockSection key={group.block.id} group={group} />
        ))}
      </div>
    </div>
  );
}
