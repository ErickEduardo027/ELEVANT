import { MapPinIcon } from '../../dashboard/components/icons';

const MESSAGES = {
  'no-positions': {
    title: 'Sin posiciones para mostrar',
    description: 'No hay posiciones registradas para esta estación en este momento.',
  },
  'no-results': {
    title: 'Sin resultados',
    description: 'Ninguna posición coincide con los filtros aplicados.',
  },
};

export default function EmptyPositionsState({ reason = 'no-positions' }) {
  const meta = MESSAGES[reason] ?? MESSAGES['no-positions'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-8 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <MapPinIcon className="h-8 w-8 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{meta.title}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{meta.description}</p>
    </div>
  );
}
