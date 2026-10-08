import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { createPrivateWebAccountChangeObserver } from '../../../services/accountChangeObserver';
import { ApprovedServicesIcon } from '../components/icons';
import { METHOD_LABELS } from '../charges/ChargesPage';
import { decideContractApproval, formatMoney, getContractApproval, listContractApprovals } from '../../../services/financeBookService';

const STATUS = {
  PendingFinanceApproval: { label: 'Pendiente de Finanzas', tone: 'warning' },
  Approved: { label: 'Aprobado', tone: 'success' },
  Draft: { label: 'Devuelto a Contratos', tone: 'danger' },
};

function Difference({ value }) {
  if (value === null || value === undefined) return <span className="text-xs text-text-secondary-light">Sin tarifa base</span>;
  const tone = value < 0 ? 'text-status-danger' : value > 0 ? 'text-status-success' : 'text-text-secondary-light';
  return <span className={`font-semibold tabular-nums ${tone}`}>{value > 0 ? '+' : ''}{value} %</span>;
}

/** Finance reviews each contract against the base tariff before it becomes active. */
export default function ContractApprovalsPage() {
  const { access } = useDepartmentAccess();
  const canDecide = Boolean(access?.can('finance.contract_approvals.decide'));
  const [pendingOnly, setPendingOnly] = useState(true);
  const [items, setItems] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [deciding, setDeciding] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });

  const load = useCallback(async () => {
    try { setItems(await listContractApprovals(pendingOnly)); } catch (failure) { setItems([]); setMessage({ tone: 'error', text: failure.message }); }
  }, [pendingOnly]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('contract_approvals')) void load();
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [load]);
  useEffect(() => {
    if (!selected) { setDetail(null); return undefined; }
    let active = true;
    getContractApproval(selected).then(result => active && setDetail(result))
      .catch(failure => active && setMessage({ tone: 'error', text: failure.message }));
    return () => { active = false; };
  }, [selected, items]);

  async function decide(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await decideContractApproval(detail.summary.versionId, { decision: deciding, reason: reason.trim() || null,
        expectedVersion: detail.summary.version });
      setMessage({ tone: 'success', text: deciding === 'Approved' ? 'Contrato aprobado y activado.' : 'Contrato devuelto a Contratos con el motivo.' });
      setDeciding(null);
      setSelected(null);
      await load();
    } catch (failure) {
      setMessage({ tone: 'error', text: failure.status === 409 ? 'El contrato cambió o ya fue decidido. Se actualizó la lista.' : failure.message });
      setDeciding(null);
      await load();
    } finally {
      setBusy(false);
    }
  }

  const currency = detail?.summary.currencyCode;
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Aprobación de contratos"
        description="Contratos enviados por Contratos. Compare cada precio con la tarifa base antes de activarlos." />
      <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={!pendingOnly} onChange={event => setPendingOnly(!event.target.checked)} />Ver también decididos en los últimos 90 días</label>
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {!items ? <p role="status" className="text-sm">Cargando contratos…</p> : items.length === 0 ? (
        <EmptyState icon={ApprovedServicesIcon} title="Sin contratos por aprobar" description="Los contratos que Contratos envíe aparecerán aquí." />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
          <ul className="space-y-2">
            {items.map(item => {
              const status = STATUS[item.status] ?? { label: item.status, tone: 'info' };
              return (
                <li key={item.versionId}>
                  <button type="button" onClick={() => setSelected(item.versionId)}
                    className={`w-full rounded-xl border p-3 text-left ${selected === item.versionId ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark-card'}`}>
                    <div className="flex items-center justify-between gap-2"><strong className="text-sm">{item.airline}</strong><StatusBadge tone={status.tone} label={status.label} /></div>
                    <p className="mt-1 text-xs text-text-secondary-light">{item.contractCode} · {item.currencyCode} · desde {item.validFrom}</p>
                    {(item.ratesBelowBase > 0 || item.ratesWithoutBase > 0) && (
                      <p className="mt-1 text-xs text-status-warning">{item.ratesBelowBase} por debajo de la base · {item.ratesWithoutBase} sin base</p>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
          {detail && (
            <section className="min-w-0 space-y-4 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <div>
                <h2 className="text-lg font-bold">{detail.summary.airline} · {detail.summary.contractCode}</h2>
                <p className="text-xs text-text-secondary-light">{currency} · {detail.summary.validFrom}{detail.summary.validTo ? ` a ${detail.summary.validTo}` : ''} · Estaciones {detail.stations.join(', ') || '—'}</p>
              </div>
              <StackedTable>
                <table className="table-stack w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-text-secondary-light"><tr><th className="p-2">Servicio</th><th className="p-2">Unidad</th><th className="p-2">Contrato</th><th className="p-2">Tarifa base</th><th className="p-2">Diferencia</th></tr></thead>
                  <tbody>{detail.rates.map(rate => (
                    <tr key={rate.rateId} className="border-t border-black/5 dark:border-white/5">
                      <td className="p-2"><strong>{rate.serviceCode}</strong><span className="block text-xs text-text-secondary-light">{rate.serviceName}</span></td>
                      <td className="p-2 text-xs">{rate.billingUnit} · mín. {rate.contractMinimum}</td>
                      <td className="p-2 tabular-nums">{formatMoney(rate.contractPrice, currency)}</td>
                      <td className="p-2 tabular-nums">{rate.basePrice === null ? '—' : formatMoney(rate.basePrice, currency)}</td>
                      <td className="p-2"><Difference value={rate.differencePercent} /></td>
                    </tr>
                  ))}</tbody>
                </table>
              </StackedTable>
              <div>
                <h3 className="text-sm font-semibold">Cargos en este contrato</h3>
                <ul className="mt-2 grid grid-cols-1 gap-1 text-xs sm:grid-cols-2">
                  {detail.charges.map(charge => (
                    <li key={charge.chargeId} className="rounded-lg bg-black/[.03] px-3 py-2 dark:bg-white/[.04]">
                      <strong>{charge.chargeCode}</strong> · {METHOD_LABELS[charge.method] ?? charge.method}: {charge.isExcluded ? 'excluido'
                        : charge.contractValue !== null ? `negociado ${charge.contractValue} (base ${charge.baseValue ?? '—'})` : `tarifa base ${charge.baseValue ?? 'sin importe'}`}
                    </li>
                  ))}
                </ul>
              </div>
              {detail.history.length > 0 && (
                <div className="text-xs text-text-secondary-light">
                  {detail.history.map(item => <p key={item.decidedAt}>{item.decision === 'Approved' ? 'Aprobado' : 'Devuelto'} por {item.decidedBy} · {new Date(item.decidedAt).toLocaleString('es-DO')}{item.reason ? ` · ${item.reason}` : ''}</p>)}
                </div>
              )}
              {canDecide && detail.summary.status === 'PendingFinanceApproval' && (
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => { setDeciding('Returned'); setReason(''); }} className="min-h-[40px] rounded-lg border border-status-danger/40 px-4 text-sm font-semibold text-status-danger">Devolver a Contratos</button>
                  <button type="button" onClick={() => { setDeciding('Approved'); setReason(''); }} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Aprobar y activar</button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <Modal open={Boolean(deciding)} onClose={() => setDeciding(null)} tone={deciding === 'Returned' ? 'danger' : 'default'}
        title={deciding === 'Approved' ? 'Aprobar contrato' : 'Devolver contrato'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDeciding(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="contract-decision-form" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${deciding === 'Returned' ? 'bg-status-danger' : 'bg-accent-600'}`}>{deciding === 'Approved' ? 'Aprobar' : 'Devolver'}</button></div>}>
        <form id="contract-decision-form" onSubmit={decide} className="space-y-3">
          <p className="text-sm">{deciding === 'Approved' ? 'El contrato quedará activo y el OCC podrá planificar sus operaciones.' : 'Contratos verá el motivo y podrá corregir el borrador.'}</p>
          <label className="block text-sm font-semibold">{deciding === 'Approved' ? 'Comentario (opcional)' : 'Motivo'}
            <textarea required={deciding === 'Returned'} minLength={deciding === 'Returned' ? 3 : undefined} maxLength={1000} rows={3} value={reason}
              onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" />
          </label>
        </form>
      </Modal>
    </div>
  );
}
