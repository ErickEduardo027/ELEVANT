import { useEffect, useState } from 'react';
import { DOCUMENT_VALIDITIES, validityLabel } from './documentValidity';

const TONE_CLASSES = {
  Valid: 'text-status-success',
  ExpiringSoon: 'text-status-warning',
  Expired: 'text-status-danger',
  Upcoming: 'text-text-secondary-light dark:text-text-secondary-dark',
};

const COUNT_KEYS = { Valid: 'valid', ExpiringSoon: 'expiringSoon', Expired: 'expired', Upcoming: 'upcoming' };

/**
 * Totales por vigencia (proyección del servidor). Cada tarjeta filtra el listado;
 * si el resumen falla, el listado sigue funcionando y sólo se informa aquí.
 */
export default function DocumentValiditySummary({ load, query, revision, selected, onSelect, gender, noun }) {
  const [state, setState] = useState({ status: 'loading', data: null });
  const queryKey = JSON.stringify(query);

  useEffect(() => {
    const controller = new AbortController();
    setState(current => ({ status: 'loading', data: current.data }));
    load(JSON.parse(queryKey), { signal: controller.signal })
      .then(data => { if (!controller.signal.aborted) setState({ status: 'success', data }); })
      .catch(error => {
        if (controller.signal.aborted || error?.name === 'AbortError') return;
        setState({ status: 'error', data: null });
      });
    return () => controller.abort();
  }, [load, queryKey, revision]);

  if (state.status === 'error') return <p role="status" className="rounded-xl border border-black/5 bg-white/70 p-4 text-sm text-text-secondary-light dark:bg-surface-dark-card">
    No se pudo calcular el resumen de vigencias. El listado sigue disponible.
  </p>;

  const data = state.data;
  return <section aria-label={`Resumen de ${noun}`} className="grid grid-cols-2 gap-3 md:grid-cols-5">
    <button type="button" aria-pressed={!selected} onClick={() => onSelect('')}
      className={`rounded-2xl border bg-white/70 p-4 text-left shadow-sm dark:bg-surface-dark-card ${!selected ? 'border-accent-600 ring-1 ring-accent-600' : 'border-black/5 dark:border-white/5'}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-text-secondary-light">Total</span>
      <span className="mt-1 block text-2xl font-bold">{data ? data.total : '…'}</span>
    </button>
    {DOCUMENT_VALIDITIES.map(validity => <button key={validity} type="button"
      aria-pressed={selected === validity} onClick={() => onSelect(selected === validity ? '' : validity)}
      className={`rounded-2xl border bg-white/70 p-4 text-left shadow-sm dark:bg-surface-dark-card ${selected === validity ? 'border-accent-600 ring-1 ring-accent-600' : 'border-black/5 dark:border-white/5'}`}>
      <span className="block text-xs font-semibold uppercase tracking-wide text-text-secondary-light">{validityLabel(validity, gender)}</span>
      <span className={`mt-1 block text-2xl font-bold ${TONE_CLASSES[validity]}`}>{data ? data[COUNT_KEYS[validity]] : '…'}</span>
      {validity === 'ExpiringSoon' && data && <span className="block text-xs text-text-secondary-light">en {data.expiringSoonDays} días o menos</span>}
    </button>)}
  </section>;
}
