import CategoryDonutChart from '../../../../components/CategoryDonutChart';
import HorizontalBarList from '../../../../components/HorizontalBarList';
import { TONE_HEX } from '../../../../components/toneColors';

const TERMINAL_SEGMENTS = [
  { key: 'terminalA', label: 'Terminal A', color: TONE_HEX.info },
  { key: 'terminalB', label: 'Terminal B', color: TONE_HEX.active },
  { key: 'fbo', label: 'FBO / Aviación local', color: TONE_HEX.success },
  { key: 'unassigned', label: 'Sin asignación', color: TONE_HEX.warning },
];

const SHIFT_ITEMS = [
  { key: 'morning', label: 'Mañana' },
  { key: 'afternoon', label: 'Tarde' },
  { key: 'night', label: 'Noche' },
];

function SkeletonBlock() {
  return <div className="h-40 animate-pulse rounded-xl bg-black/5 dark:bg-white/5" />;
}

export default function StaffDistributionChart({ byTerminal, byShift, loading = false }) {
  const terminalSegments = TERMINAL_SEGMENTS.map(segment => ({ ...segment, value: byTerminal?.[segment.key] ?? 0 }));
  const shiftItems = SHIFT_ITEMS.map(item => ({ ...item, value: byShift?.[item.key] ?? 0 }));

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-4 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Distribución del personal</h2>

      {loading ? (
        <div className="space-y-4">
          <SkeletonBlock />
          <SkeletonBlock />
        </div>
      ) : (
        <div className="space-y-5">
          <CategoryDonutChart title="Por terminal" segments={terminalSegments} />
          <div>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">
              Por turno
            </h3>
            <HorizontalBarList items={shiftItems} />
          </div>
        </div>
      )}
    </div>
  );
}
