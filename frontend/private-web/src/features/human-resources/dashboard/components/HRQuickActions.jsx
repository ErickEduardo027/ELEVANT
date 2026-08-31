import { useNavigate } from 'react-router-dom';
import { HUMAN_RESOURCES_NAVIGATION, HUMAN_RESOURCES_MODULE_IDS } from '../../navigation';

const QUICK_ACTION_IDS = [
  HUMAN_RESOURCES_MODULE_IDS.USERS,
  HUMAN_RESOURCES_MODULE_IDS.CERTIFICATIONS,
  HUMAN_RESOURCES_MODULE_IDS.PERMITS,
  HUMAN_RESOURCES_MODULE_IDS.SCHEDULES,
  HUMAN_RESOURCES_MODULE_IDS.REPORTS,
];

// Reutiliza la configuración de navegación de Gestión Humana (misma fuente
// que el Sidebar) para no duplicar labels, íconos ni rutas.
export default function HRQuickActions() {
  const navigate = useNavigate();
  const items = QUICK_ACTION_IDS.map(id => HUMAN_RESOURCES_NAVIGATION.find(item => item.id === id)).filter(Boolean);

  return (
    <div className="rounded-2xl border border-black/5 bg-white/70 p-4 backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="mb-3 text-sm font-semibold text-ink-900 dark:text-text-primary-dark">Accesos rápidos</h2>
      <div className="flex flex-wrap gap-2">
        {items.map(item => (
          <button
            key={item.id}
            type="button"
            onClick={() => navigate(item.path)}
            className="flex items-center gap-2 rounded-lg border border-black/10 px-3 py-2 text-sm text-ink-900 transition-colors hover:bg-black/5 dark:border-white/10 dark:text-text-primary-dark dark:hover:bg-white/5"
          >
            <item.icon className="h-4 w-4 text-accent-600" />
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
