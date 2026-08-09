import { RadarIcon } from '../../shell/components/icons';

const MESSAGES = {
  'no-flights': {
    title: 'Sin vuelos para mostrar',
    description: 'No hay vuelos relacionados con la estación en este momento.',
  },
  'no-results': {
    title: 'Sin resultados',
    description: 'Ningún vuelo coincide con los filtros aplicados.',
  },
};

export default function EmptyFlightState({ reason = 'no-flights' }) {
  const meta = MESSAGES[reason] ?? MESSAGES['no-flights'];

  return (
    <div className="flex flex-col items-center gap-2 rounded-2xl border border-black/5 bg-white/70 p-8 text-center backdrop-blur-md dark:border-white/5 dark:bg-surface-dark-card">
      <RadarIcon className="h-8 w-8 text-text-secondary-light dark:text-text-secondary-dark" />
      <p className="text-sm font-semibold text-ink-900 dark:text-text-primary-dark">{meta.title}</p>
      <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{meta.description}</p>
    </div>
  );
}
