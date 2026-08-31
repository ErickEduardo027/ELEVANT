import { BellIcon } from '../../dashboard/components/icons';

const VARIANT_COPY = {
  general: {
    title: 'Sin notificaciones nuevas',
    description: 'Las nuevas alertas y eventos operativos aparecerán aquí.',
  },
  filtered: {
    title: 'No hay notificaciones en esta categoría.',
    description: 'Ajuste los filtros para ver más resultados.',
  },
  'all-read': {
    title: 'Todas las notificaciones están al día.',
    description: 'No hay notificaciones pendientes por revisar.',
  },
};

export default function NotificationEmptyState({ variant = 'general' }) {
  const copy = VARIANT_COPY[variant] ?? VARIANT_COPY.general;

  return (
    <div className="mx-auto flex max-w-[800px] flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 px-6 py-16 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <BellIcon className="h-6 w-6 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{copy.title}</p>
      <p className="max-w-md text-xs text-text-secondary-light dark:text-text-secondary-dark">{copy.description}</p>
    </div>
  );
}
