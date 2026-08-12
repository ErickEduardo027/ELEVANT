import ProgressRing from '../../../../components/ProgressRing';
import Badge from '../../../../components/Badge';
import EmptyState from '../../../../components/EmptyState';
import ExpirationIndicator from './ExpirationIndicator';
import { ShieldCheckIcon } from '../../../shell/components/icons';

function SkeletonCard() {
  return <div className="h-36 animate-pulse rounded-2xl border border-black/5 bg-white/60 dark:bg-surface-dark-card" />;
}

function CoverageCard({ coverage, onClick }) {
  const hasAgents = coverage.totalAgents > 0;

  return (
    <button
      type="button"
      onClick={() => onClick(coverage)}
      className="flex items-center gap-4 rounded-2xl border border-black/5 bg-white/70 p-4 text-left shadow-sm backdrop-blur-md transition-shadow hover:shadow-md dark:border-white/5 dark:bg-surface-dark-card"
    >
      {hasAgents ? (
        <ProgressRing percent={coverage.coveragePercent} size={64} strokeWidth={7} />
      ) : (
        <span className="flex h-16 w-16 shrink-0 items-center justify-center rounded-full bg-black/5 text-xs font-medium text-text-secondary-light dark:bg-white/5 dark:text-text-secondary-dark">
          Sin datos
        </span>
      )}

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <p className="truncate text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{coverage.equipmentName}</p>
          {coverage.limitedCoverage && <Badge tone="neutral" label="Cobertura limitada" />}
        </div>
        <p className="mt-0.5 text-xs text-text-secondary-light dark:text-text-secondary-dark">
          {coverage.terminals.length > 0 ? `Terminal ${coverage.terminals.join(' / ')}` : 'Sin terminal asignada'} · {coverage.totalAgents} agente{coverage.totalAgents === 1 ? '' : 's'} habilitado{coverage.totalAgents === 1 ? '' : 's'}
        </p>
        <div className="mt-2">
          <ExpirationIndicator activeCount={coverage.activeCount} expiringSoonCount={coverage.expiringSoonCount} expiredCount={coverage.expiredCount} />
        </div>
      </div>
    </button>
  );
}

// Vista "Por tipo de equipo" (skill.md §"VISTA POR TIPO DE EQUIPO"): tarjetas
// de cobertura operativa, una por equipo del catálogo. El énfasis en
// "cobertura limitada" es deliberadamente sutil (Badge neutral, no rojo) —
// el skill pide evitar colores agresivos innecesarios.
export default function EquipmentCoverageView({ coverage, loading, onSelectEquipment }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 6 }, (_, index) => <SkeletonCard key={index} />)}
      </div>
    );
  }

  if (coverage.length === 0) {
    return (
      <EmptyState
        icon={ShieldCheckIcon}
        title="No hay tipos de equipo registrados."
        description="El catálogo de equipos aparecerá aquí una vez configurado."
      />
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {coverage.map(item => (
        <CoverageCard key={item.equipmentId} coverage={item} onClick={onSelectEquipment} />
      ))}
    </div>
  );
}
