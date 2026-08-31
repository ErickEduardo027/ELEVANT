import { ChecklistIcon } from '../../dashboard/components/icons';

const TAB_COPY = {
  pending: {
    title: 'No hay operaciones pendientes de revisión.',
    description: 'Las operaciones completadas aparecerán aquí cuando sean enviadas por los agentes.',
  },
  inReview: {
    title: 'No hay operaciones en revisión.',
    description: 'Las operaciones que el OCC empiece a revisar aparecerán aquí.',
  },
  approved: {
    title: 'No hay operaciones aprobadas.',
    description: 'Las operaciones aprobadas quedarán disponibles aquí para Finanzas.',
  },
  returned: {
    title: 'No hay operaciones devueltas.',
    description: 'Las operaciones devueltas con correcciones aparecerán aquí.',
  },
  resubmitted: {
    title: 'No hay operaciones reenviadas.',
    description: 'Las operaciones corregidas y reenviadas por el agente o supervisor aparecerán aquí.',
  },
};

const NO_RESULTS_COPY = {
  title: 'Sin resultados',
  description: 'Ninguna operación coincide con los filtros aplicados. Ajuste los filtros para ver más resultados.',
};

export default function ReviewEmptyState({ activeTab, hasActiveFilters }) {
  const copy = hasActiveFilters ? NO_RESULTS_COPY : TAB_COPY[activeTab] ?? TAB_COPY.pending;

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{copy.title}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">{copy.description}</p>
    </div>
  );
}
