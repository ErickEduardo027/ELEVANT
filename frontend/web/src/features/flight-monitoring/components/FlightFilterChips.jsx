import { FLIGHT_FILTER_CHIPS } from '../flightMonitoringMappers';

export default function FlightFilterChips({ active, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {FLIGHT_FILTER_CHIPS.map(({ id, label }) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-pressed={active === id}
          className={`rounded-full border px-3 py-1 text-xs font-medium transition-colors duration-200 ${
            active === id
              ? 'border-accent-600 bg-accent-600/10 text-accent-600'
              : 'border-black/10 text-text-secondary-light hover:border-accent-600/40 dark:border-white/10 dark:text-text-secondary-dark'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
