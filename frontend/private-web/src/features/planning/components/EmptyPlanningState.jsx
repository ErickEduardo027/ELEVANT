import { ChecklistIcon } from '../../dashboard/components/icons';

const COPY = {
  'no-flights': {
    title: 'Sin vuelos programados',
    description: 'No hay vuelos registrados para la fecha y estación seleccionadas.',
  },
  'no-results': {
    title: 'Sin resultados',
    description: 'Ningún vuelo coincide con los filtros aplicados. Ajuste los filtros para ver más resultados.',
  },
};

export default function EmptyPlanningState({ reason }) {
  const copy = COPY[reason] ?? COPY['no-results'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <ChecklistIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{copy.title}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">{copy.description}</p>
    </div>
  );
}
