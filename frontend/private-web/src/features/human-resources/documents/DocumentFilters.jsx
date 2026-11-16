import { useEffect, useState } from 'react';
import { DOCUMENT_VALIDITIES, validityLabel } from './documentValidity';

const fieldClass = 'mt-1 w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark-card';

/**
 * Búsqueda (con espera breve para no consultar en cada tecla), tipo y vigencia.
 * `type` = { label, value, options: [{ value, label }] }.
 */
export default function DocumentFilters({ filters, onChange, type, gender, searchLabel }) {
  const [search, setSearch] = useState(filters.search);

  useEffect(() => { setSearch(filters.search); }, [filters.search]);
  useEffect(() => {
    if (search === filters.search) return undefined;
    const timer = window.setTimeout(() => onChange({ ...filters, search }), 350);
    return () => window.clearTimeout(timer);
  }, [search, filters, onChange]);

  return <div className="grid gap-3 rounded-2xl border border-black/5 bg-white/70 p-4 sm:grid-cols-3 dark:border-white/5 dark:bg-surface-dark-card">
    <label className="text-xs font-semibold text-text-secondary-light">Buscar
      <input type="search" value={search} maxLength={100} placeholder={searchLabel}
        onChange={event => setSearch(event.target.value)} className={fieldClass} />
    </label>
    <label className="text-xs font-semibold text-text-secondary-light">{type.label}
      <select value={filters[type.key]} onChange={event => onChange({ ...filters, [type.key]: event.target.value })}
        className={fieldClass}>
        <option value="">Todos</option>
        {type.options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
      </select>
    </label>
    <label className="text-xs font-semibold text-text-secondary-light">Vigencia
      <select value={filters.validity} onChange={event => onChange({ ...filters, validity: event.target.value })}
        className={fieldClass}>
        <option value="">Todas</option>
        {DOCUMENT_VALIDITIES.map(validity => <option key={validity} value={validity}>{validityLabel(validity, gender)}</option>)}
      </select>
    </label>
  </div>;
}
