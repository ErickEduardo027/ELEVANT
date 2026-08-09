import KpiCard from '../../dashboard/components/KpiCard';
import { ChecklistIcon, ShieldCheckIcon } from '../../dashboard/components/icons';
import { EyeIcon } from '../../planning/components/icons';
import { CornerUpLeftIcon } from './icons';

const KPI_DEFINITIONS = [
  { tabId: 'pending', label: 'Pendientes de revisión', key: 'pending', icon: ChecklistIcon, signalWhenPositive: true },
  { tabId: 'inReview', label: 'En revisión', key: 'inReview', icon: EyeIcon, signalWhenPositive: false },
  { tabId: 'approved', label: 'Aprobadas hoy', key: 'approvedToday', icon: ShieldCheckIcon, signalWhenPositive: false },
  { tabId: 'returned', label: 'Devueltas', key: 'returned', icon: CornerUpLeftIcon, signalWhenPositive: true },
];

export default function ReviewKPIs({ kpis, activeTab, onSelectTab, loading = false }) {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {KPI_DEFINITIONS.map(definition => {
        const value = kpis[definition.key] ?? 0;
        const isActive = activeTab === definition.tabId;
        return (
          <button
            key={definition.tabId}
            type="button"
            onClick={() => onSelectTab(definition.tabId)}
            aria-pressed={isActive}
            className={`block rounded-2xl text-left transition-shadow duration-200 ${
              isActive ? 'ring-2 ring-accent-600' : ''
            }`}
          >
            <KpiCard
              label={definition.label}
              value={value}
              icon={definition.icon}
              loading={loading}
              tone={definition.signalWhenPositive && value > 0 ? 'signal' : 'default'}
            />
          </button>
        );
      })}
    </div>
  );
}
