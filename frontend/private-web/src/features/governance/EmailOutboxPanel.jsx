import { useEffect, useState } from 'react';
import StatusBadge from '../../components/StatusBadge';
import { getEmailOutbox } from '../../services/commercialGovernanceApi';
import { commercialGovernanceMessage } from '../../services/commercialProblems';
import {
  EMAIL_RECOVERY, purposeLabel, reasonLabel, referenceLabel, statusLabel,
} from '../../services/emailDeliveries';
import { isForbidden } from '../../services/problemMessages';

const FILTERS = [
  ['All', 'Todos'], ['Pending', 'En cola'], ['Sent', 'Enviados'], ['Failed', 'Fallidos'], ['Discarded', 'Descartados'],
];
const LIMIT = 20;
const stamp = value => new Intl.DateTimeFormat('es-DO', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value));

/**
 * Superadmin outbox (1-N22): every email with its purpose, delivery state, the reason it was not sent and the
 * contract, invoice, payment, account or request it is about, so a failure can be followed up. Bodies are never
 * shown. `reloadKey` re-reads the first page, for example after a test email.
 */
export default function EmailOutboxPanel({ reloadKey = 0 }) {
  const [filter, setFilter] = useState('All');
  const [page, setPage] = useState(1);
  const [state, setState] = useState({ status: 'loading', data: null, failure: null });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    getEmailOutbox({ status: filter, page, limit: LIMIT })
      .then(data => { if (active) setState({ status: 'ready', data, failure: null }); })
      .catch(failure => {
        if (active) setState({ status: isForbidden(failure) ? 'forbidden' : 'error', data: null, failure });
      });
    return () => { active = false; };
  }, [filter, page, reloadKey, attempt]);
  const retry = () => { setState({ status: 'loading', data: null, failure: null }); setAttempt(current => current + 1); };

  const entries = state.data?.entries ?? [];
  return (
    <section aria-labelledby="email-outbox-heading" className="mt-5 border-t border-black/5 pt-4 dark:border-white/5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div><h3 id="email-outbox-heading" className="text-base font-bold">Bandeja de correos</h3>
          <p className="text-xs text-text-secondary-light">Cada correo con su estado, el motivo si no salió y el documento o la cuenta a la que corresponde.</p></div>
        <label className="text-xs font-semibold">Estado
          <select aria-label="Filtrar correos por estado" value={filter} onChange={event => { setFilter(event.target.value); setPage(1); }}
            className="mt-1 block rounded-lg border border-black/10 px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark">
            {FILTERS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select></label>
      </div>
      {state.status === 'loading' && <p role="status" className="mt-3 text-sm">Cargando la bandeja de correos…</p>}
      {state.status === 'forbidden' && <p role="alert" className="mt-3 text-sm">Solo el superadministrador revisa la bandeja de correos.</p>}
      {state.status === 'error' && <div role="alert" className="mt-3 text-sm">
        <p>{commercialGovernanceMessage(state.failure, { fallback: 'No se pudo cargar la bandeja de correos.' })}</p>
        <button type="button" onClick={retry} className="mt-1 font-semibold text-accent-600 underline">Reintentar</button></div>}
      {state.status === 'ready' && (entries.length === 0
        ? <p className="mt-4 text-sm text-text-secondary-light">{filter === 'All' ? 'Todavía no hay correos.' : 'No hay correos con este estado.'}</p>
        : <ul className="mt-3 divide-y divide-black/5 text-sm dark:divide-white/5" aria-label="Correos de la bandeja">
          {entries.map(item => {
            const status = statusLabel(item.status);
            const reason = reasonLabel(item.reason);
            const reference = referenceLabel(item.reference);
            const pending = item.status === 'Failed' || item.status === 'Discarded';
            return <li key={item.id} className="flex flex-wrap items-start justify-between gap-2 py-2.5">
              <span className="min-w-0 flex-1 [overflow-wrap:anywhere]"><strong>{purposeLabel(item.purpose)}</strong> · {item.recipient}
                {reference && <span className="block text-xs">{reference}</span>}
                <span className="block text-xs text-text-secondary-light">{stamp(item.createdAt)} · {item.attempts} intento(s){item.sentAt ? ` · enviado ${stamp(item.sentAt)}` : ''}</span>
                {reason && <span className="block text-xs text-status-danger">{reason}</span>}
                {pending && EMAIL_RECOVERY[item.purpose] && <span className="block text-xs text-text-secondary-light">{EMAIL_RECOVERY[item.purpose]}</span>}
              </span>
              <StatusBadge tone={status.tone} label={status.label} />
            </li>;
          })}
        </ul>)}
      {state.data && (page > 1 || state.data.hasMore) && <div className="mt-3 flex items-center gap-3 text-sm">
        <button type="button" disabled={page <= 1} onClick={() => setPage(current => current - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Anterior</button>
        <span>Página {page}</span>
        <button type="button" disabled={!state.data.hasMore} onClick={() => setPage(current => current + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Siguiente</button>
      </div>}
    </section>
  );
}
