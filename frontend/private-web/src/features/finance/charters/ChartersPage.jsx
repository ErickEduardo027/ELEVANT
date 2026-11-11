import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { formatMoney } from '../../../services/financeBookService';
import {
  confirmCharterPrepayment, listFinanceCharters, reopenCharterPrepayment,
} from '../../../services/financeChartersService';
import { ApprovedServicesIcon } from '../components/icons';

const validReason = value => value.trim().length >= 8 && value.trim().length <= 500;
const validCorrection = value => value.trim().length >= 5 && value.trim().length <= 500;

/**
 * «Charters sin contrato» (ADR-0033): flights served without a contract, priced at the base
 * tariff. The signed Service Request is the flight's agreement; Finance confirms the carrier's
 * prepayment here, and reopens a confirmed one as a new quotation with a reason (3-N24) so the agent can add services
 * again. 4-N22: confirmed after the invoice, the prepayment settles it; one captured wrong is corrected with a reason
 * while it was never applied. Every command carries its intent's Idempotency-Key and the charter's version; a refusal
 * re-reads the list.
 */
export default function ChartersPage() {
  const { access } = useDepartmentAccess();
  const canConfirm = Boolean(access?.can('finance.charters.confirm'));
  const keys = useRef(createCommandKeyHolder());
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [editing, setEditing] = useState(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
  const [reopening, setReopening] = useState(null);
  const [correcting, setCorrecting] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });

  const load = useCallback(async signal => {
    try {
      const items = await listFinanceCharters({ signal });
      setState({ status: items.length ? 'success' : 'empty', items });
    } catch (error) {
      if (error?.name !== 'AbortError') setState({ status: 'error', items: [], error });
    }
  }, []);
  useEffect(() => {
    const controller = new AbortController();
    void load(controller.signal);
    return () => controller.abort();
  }, [load]);

  function startConfirm(item) {
    setReopening(null);
    setCorrecting(null);
    setEditing(item.id);
    setAmount(item.servicesTotal != null ? String(item.servicesTotal) : '');
    setReference('');
    setMessage({ tone: '', text: '' });
  }

  function startCorrect(item) {
    setEditing(null);
    setReopening(null);
    setCorrecting(item.id);
    setAmount(item.prepaymentAmount != null ? String(item.prepaymentAmount) : '');
    setReference(item.prepaymentReference ?? '');
    setReason('');
    setMessage({ tone: '', text: '' });
  }

  function startReopen(item) {
    setEditing(null);
    setCorrecting(null);
    setReopening(item.id);
    setReason('');
    setMessage({ tone: '', text: '' });
  }

  async function reopen(event, item) {
    event.preventDefault();
    if (busy || !validReason(reason)) return;
    const command = { reason: reason.trim(), version: item.version };
    setBusy(true);
    try {
      await keys.current.run('reopen', { charterId: item.id, ...command },
        key => reopenCharterPrepayment(item.id, command, key));
      setMessage({ tone: 'success', text: `Cotización reabierta para ${item.operationCode}: el prepago vuelve a Pendiente.` });
      setReopening(null);
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
      // A stale version or a state that moved: the form closes and the list is read again before a new intent.
      if (error?.status === 409) setReopening(null);
    } finally {
      setBusy(false);
      await load();
    }
  }

  /** 4-N22: confirms a pending prepayment or, with a reason, corrects a confirmed one that was never applied. */
  async function confirm(event, item, correction = false) {
    event.preventDefault();
    if (busy || (correction && !validCorrection(reason))) return;
    const command = { amount: Number(amount), reference: reference.trim(), version: item.version,
      ...(correction ? { reason: reason.trim() } : {}) };
    setBusy(true);
    try {
      await keys.current.run(correction ? 'correct' : 'confirm', { charterId: item.id, ...command },
        key => confirmCharterPrepayment(item.id, command, key));
      setMessage({ tone: 'success', text: correction ? `Prepago corregido para ${item.operationCode}.`
        : `Prepago confirmado para ${item.operationCode}. Si el charter ya estaba facturado, se aplicó a su factura.` });
      setEditing(null);
      setCorrecting(null);
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
      // A stale version, an applied prepayment or a state that moved: the form closes and the list is read again.
      if (error?.status === 409) {
        setEditing(null);
        setCorrecting(null);
      }
    } finally {
      setBusy(false);
      await load();
    }
  }

  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Charters sin contrato"
        description="Vuelos atendidos sin contrato, a la tarifa base. La Solicitud de Servicio firmada es el acuerdo del vuelo; aquí se confirma el prepago." />
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {state.status === 'loading' && <p role="status" className="text-sm">Cargando charters…</p>}
      {state.status === 'error' && (
        <div role="alert" className="space-y-2 text-sm">
          <p>{state.error.message}</p>
          {state.error.status !== 403 && <button type="button" onClick={() => { setState({ status: 'loading', items: [] }); void load(); }}
            className="min-h-11 rounded-lg border border-accent-600 px-3 py-2 font-semibold">Reintentar</button>}
        </div>
      )}
      {state.status === 'empty' && <EmptyState icon={ApprovedServicesIcon} title="Sin charters"
        description="Cuando OCC registre un vuelo charter de una aerolínea sin contrato, aparecerá aquí." />}
      {state.status === 'success' && (
        <StackedTable>
          <table className="table-stack w-full min-w-[760px] text-left text-sm">
            <thead className="text-xs uppercase text-text-secondary-light">
              <tr><th className="p-2">Operación</th><th className="p-2">Aerolínea</th><th className="p-2">Servicios</th><th className="p-2">Solicitud</th><th className="p-2">Prepago</th><th className="p-2"><span className="sr-only">Acción</span></th></tr>
            </thead>
            <tbody>
              {state.items.map(item => (
                <tr key={item.id} className="border-t border-black/5 align-top dark:border-white/5">
                  <td className="p-2"><strong>{item.operationCode}</strong><span className="block text-xs text-text-secondary-light">{item.stationCode} · {item.operationDate}</span></td>
                  <td className="p-2">{item.airlineName}</td>
                  <td className="p-2 tabular-nums">{formatMoney(item.servicesTotal, item.currencyCode)}</td>
                  <td className="p-2"><StatusBadge tone={item.requestSigned ? 'success' : 'warning'} label={item.requestSigned ? 'Firmada' : 'Sin firmar'} /></td>
                  <td className="p-2">
                    <StatusBadge tone={item.prepaymentStatus === 'Confirmed' ? 'success' : 'warning'}
                      label={item.prepaymentStatus === 'Confirmed' ? 'Confirmado' : 'Pendiente'} />
                    {item.prepaymentStatus === 'Confirmed' && <span className="mt-1 block text-xs text-text-secondary-light">
                      {formatMoney(item.prepaymentAmount, item.currencyCode)} · {item.prepaymentReference}</span>}
                  </td>
                  <td className="p-2">
                    {/* A server before phase 3, block D sends no version: no command is offered without it. */}
                    {canConfirm && item.prepaymentStatus !== 'Confirmed' && item.version && (editing === item.id ? (
                      <form onSubmit={event => void confirm(event, item)} aria-label={`Confirmar prepago de ${item.operationCode}`}
                        className="flex flex-wrap items-end gap-2">
                        <label className="text-xs">Monto ({item.currencyCode})
                          <input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)}
                            className="mt-1 block w-28 rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                        <label className="text-xs">Referencia
                          <input required minLength={2} maxLength={80} value={reference} onChange={event => setReference(event.target.value)}
                            className="mt-1 block w-36 rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                        <button type="submit" disabled={busy} className="min-h-10 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Confirmar</button>
                        <button type="button" onClick={() => setEditing(null)} className="min-h-10 rounded-lg border border-black/15 px-3 py-2 text-xs dark:border-white/15">Cancelar</button>
                      </form>
                    ) : (
                      <button type="button" onClick={() => startConfirm(item)}
                        className="min-h-10 rounded-lg border border-accent-600 px-3 py-2 text-xs font-semibold text-accent-600">Confirmar prepago</button>
                    ))}
                    {/* 3-N24: a server before phase 3, block D sends no version, and no reopening is offered. */}
                    {canConfirm && item.prepaymentStatus === 'Confirmed' && item.version && (correcting === item.id ? (
                      <form onSubmit={event => void confirm(event, item, true)}
                        aria-label={`Corregir prepago de ${item.operationCode}`} className="space-y-2">
                        <p className="text-xs">Prepago confirmado: {formatMoney(item.prepaymentAmount, item.currencyCode)} · {item.prepaymentReference}.
                          Se corrige solo mientras no se haya aplicado a la factura del charter.</p>
                        <div className="flex flex-wrap items-end gap-2">
                          <label className="text-xs">Monto corregido ({item.currencyCode})
                            <input required type="number" min="0.01" step="0.01" value={amount} onChange={event => setAmount(event.target.value)}
                              className="mt-1 block w-28 rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                          <label className="text-xs">Referencia corregida
                            <input required minLength={2} maxLength={80} value={reference} onChange={event => setReference(event.target.value)}
                              className="mt-1 block w-36 rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                        </div>
                        <label className="block text-xs">Motivo de la corrección (5 a 500 caracteres)
                          <textarea required minLength={5} maxLength={500} rows={2} value={reason}
                            onChange={event => setReason(event.target.value)}
                            className="mt-1 block w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" disabled={busy || !validCorrection(reason)}
                            className="min-h-10 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Corregir</button>
                          <button type="button" disabled={busy} onClick={() => setCorrecting(null)}
                            className="min-h-10 rounded-lg border border-black/15 px-3 py-2 text-xs dark:border-white/15">Cancelar</button>
                        </div>
                      </form>
                    ) : reopening === item.id ? (
                      <form onSubmit={event => void reopen(event, item)} aria-label={`Reabrir cotización de ${item.operationCode}`}
                        className="space-y-2">
                        <p className="text-xs">Prepago anterior: {formatMoney(item.prepaymentAmount, item.currencyCode)} · {item.prepaymentReference}.
                          Vuelve a Pendiente y el agente puede agregar servicios hasta la nueva confirmación.</p>
                        <label className="block text-xs">Motivo de la reapertura (8 a 500 caracteres)
                          <textarea required minLength={8} maxLength={500} rows={2} value={reason}
                            onChange={event => setReason(event.target.value)}
                            className="mt-1 block w-full rounded-lg border border-black/15 px-2 py-1.5 text-sm dark:border-white/15 dark:bg-surface-dark-card" /></label>
                        <div className="flex flex-wrap gap-2">
                          <button type="submit" disabled={busy || !validReason(reason)}
                            className="min-h-10 rounded-lg bg-accent-600 px-3 py-2 text-xs font-semibold text-white disabled:opacity-50">Reabrir</button>
                          <button type="button" disabled={busy} onClick={() => setReopening(null)}
                            className="min-h-10 rounded-lg border border-black/15 px-3 py-2 text-xs dark:border-white/15">Cancelar</button>
                        </div>
                      </form>
                    ) : (
                      <div className="flex flex-wrap gap-2">
                        <button type="button" onClick={() => startCorrect(item)}
                          className="min-h-10 rounded-lg border border-accent-600 px-3 py-2 text-xs font-semibold text-accent-600">Corregir prepago</button>
                        <button type="button" onClick={() => startReopen(item)}
                          className="min-h-10 rounded-lg border border-status-warning px-3 py-2 text-xs font-semibold">Reabrir cotización</button>
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </StackedTable>
      )}
    </div>
  );
}
