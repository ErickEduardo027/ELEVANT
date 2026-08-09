import { SearchIcon } from './icons';

export default function FlightSearch({ value, onChange }) {
  return (
    <label className="flex flex-col gap-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
      Buscar vuelo
      <span className="relative">
        <SearchIcon className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-text-secondary-light dark:text-text-secondary-dark" />
        <input
          type="text"
          value={value}
          onChange={event => onChange(event.target.value)}
          placeholder="Número, aerolínea, matrícula o supervisor"
          className="w-full rounded-lg border border-black/10 bg-white/80 py-1.5 pl-7 pr-2 text-sm text-ink-900 dark:border-white/10 dark:bg-surface-dark-card dark:text-text-primary-dark"
        />
      </span>
    </label>
  );
}
