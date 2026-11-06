import { useCallback, useEffect, useRef, useState } from 'react';
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
import { billingUnitLabel } from '../../../services/billingUnits';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import { financeContractApprovalMessage } from '../../../services/financeErrors';
import { isConflict, isForbidden } from '../../../services/problemMessages';
import { CONTRACT_APPROVAL_STATUS, packageScopeLabel, statusMeta } from '../financeLabels';
import { financeApprovalEffect } from '../../contracts/approvalEffect';

const LOAD_FAILED = 'No se pudieron cargar los contratos por aprobar. Revise la conexión e intente de nuevo.';
const DETAIL_FAILED = 'No se pudo cargar el contrato. Revise la conexión e intente de nuevo.';
const DETAIL_FORBIDDEN = 'No tiene permiso para ver este contrato: alguna de sus estaciones no está en su alcance.';
/** No contract read yet: the detail of a new selection starts here, so the previous one is never shown. */
const NO_DETAIL = Object.freeze({ versionId: null, detail: null, error: null });

function Difference({ value }) {
  if (value === null || value === undefined) return <span className="text-xs text-text-secondary-light">Sin tarifa base</span>;
  const tone = value < 0 ? 'text-status-danger' : value > 0 ? 'text-status-success' : 'text-text-secondary-light';
  return <span className={`font-semibold tabular-nums ${tone}`}>{value > 0 ? '+' : ''}{value} %</span>;
}

/**
 * Finance reviews the prices of each contract version against the base tariff. Approving a new or expired contract
 * does not activate it (ADR-0024): the validity, both signatures and a verified permit come after. An amendment or a
 * renewal of a contract in force replaces the version in force from its start once approved (1-F).
 */
export default function ContractApprovalsPage() {
  const { access } = useDepartmentAccess();
  const canDecide = Boolean(access?.can('finance.contract_approvals.decide'));
  const [pendingOnly, setPendingOnly] = useState(true);
  // null while loading; the list never shows «vacío» for a list that failed to load.
  const [items, setItems] = useState(null);
  const [loadState, setLoadState] = useState({ status: 'loading', error: '' });
  const decideKeys = useRef(createCommandKeyHolder());
  const [selected, setSelected] = useState(null);
  // The last read of a contract's detail, with the contract it belongs to. A detail is shown only for the
  // selected contract: while another one loads or fails, neither the previous contract nor its decision
  // buttons stay on screen.
  const [detailRead, setDetailRead] = useState(NO_DETAIL);
  const [detailAttempt, setDetailAttempt] = useState(0);
  const [deciding, setDeciding] = useState(null);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });

  const load = useCallback(async () => {
    try {
      setItems(await listContractApprovals(pendingOnly));
      setLoadState({ status: 'ready', error: '' });
    } catch (failure) {
      if (isForbidden(failure)) setLoadState({ status: 'forbidden', error: '' });
      else setLoadState(current => ({ status: current.status === 'ready' ? 'ready' : 'error',
        error: financeContractApprovalMessage(failure, { fallback: LOAD_FAILED }) }));
    }
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
    if (!selected) return undefined;
    let active = true;
    // A refresh of the same contract keeps its detail on screen until the new read arrives, and after a
    // connection failure; a refusal (no permission, no longer there) takes it and its buttons away.
    getContractApproval(selected).then(
      result => { if (active) setDetailRead({ versionId: selected, detail: result, error: null }); },
      failure => {
        if (!active) return;
        const keeps = !isForbidden(failure) && failure?.status !== 404;
        setDetailRead(current => ({ versionId: selected,
          detail: keeps && current.versionId === selected ? current.detail : null, error: failure }));
      });
    return () => { active = false; };
  }, [selected, items, detailAttempt]);
  const read = selected && detailRead.versionId === selected ? detailRead : null;
  const detail = read?.detail ?? null;
  // 1-F: what approving does depends on the status of the contract (in force, or still to activate).
  const effect = detail ? financeApprovalEffect(detail.summary.contractStatus, detail.summary.validFrom) : null;
  function select(versionId) {
    if (versionId === selected) return;
    setSelected(versionId);
    setDetailRead(NO_DETAIL);
  }
  function retryDetail() {
    setDetailRead(current => ({ ...current, error: null }));
    setDetailAttempt(value => value + 1);
  }

  async function decide(event) {
    event.preventDefault();
    setBusy(true);
    const values = { decision: deciding, reason: reason.trim() || null, expectedVersion: detail.summary.version };
    const approved = effect.done;
    try {
      // The same key goes with a retry of the same decision after an uncertain result.
      await decideKeys.current.run('decide', { versionId: detail.summary.versionId, ...values },
        key => decideContractApproval(detail.summary.versionId, values, key));
      setMessage({ tone: 'success', text: deciding === 'Approved' ? approved : 'Contrato devuelto a Contratos con el motivo.' });
      setDeciding(null);
      select(null);
      await load();
    } catch (failure) {
      // One message per blocking cause (1-N07); the server title is never shown.
      setMessage({ tone: 'error', text: financeContractApprovalMessage(failure) });
      setDeciding(null);
      if (isConflict(failure)) await load();
    } finally {
      setBusy(false);
    }
  }

  const currency = detail?.summary.currencyCode;
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Aprobación de contratos"
        description="Versiones que envía Contratos. Compare cada precio con la tarifa base antes de aprobarlos." />
      <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={!pendingOnly} onChange={event => setPendingOnly(!event.target.checked)} />Ver también decididos en los últimos 90 días</label>
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {loadState.status === 'forbidden' ? <p role="alert" className="rounded-xl border border-status-danger/30 bg-white p-6 text-sm dark:bg-surface-dark-card">No tiene permiso para ver las aprobaciones de contratos.</p>
        : loadState.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger"><span>{loadState.error}</span><button type="button" onClick={() => { void load(); }} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button></div>}
      {loadState.status === 'forbidden' || loadState.status === 'error' ? null : !items ? <p role="status" className="text-sm">Cargando contratos…</p> : items.length === 0 ? (
        <EmptyState icon={ApprovedServicesIcon} title="Sin contratos por aprobar" description="Los contratos que Contratos envíe aparecerán aquí." />
      ) : (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(18rem,24rem)_minmax(0,1fr)]">
          <ul className="space-y-2">
            {items.map(item => {
              const status = statusMeta(CONTRACT_APPROVAL_STATUS, item.status);
              return (
                <li key={item.versionId}>
                  <button type="button" onClick={() => select(item.versionId)}
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
          {selected && !detail && (
            <section aria-label="Contrato seleccionado" className="h-fit min-w-0 rounded-xl border border-black/5 bg-white p-4 text-sm dark:border-white/5 dark:bg-surface-dark-card">
              {!read?.error ? <p role="status">Cargando contrato…</p>
                : isForbidden(read.error) ? <p role="alert">{DETAIL_FORBIDDEN}</p>
                  : <div role="alert" className="flex flex-wrap items-center justify-between gap-2 text-status-danger"><span>{financeContractApprovalMessage(read.error, { fallback: DETAIL_FAILED })}</span><button type="button" onClick={retryDetail} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button></div>}
            </section>
          )}
          {detail && (
            <section aria-label="Contrato seleccionado" className="min-w-0 space-y-4 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              {read.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger"><span>{financeContractApprovalMessage(read.error, { fallback: DETAIL_FAILED })}</span><button type="button" onClick={retryDetail} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button></div>}
              <div>
                <h2 className="text-lg font-bold">{detail.summary.airline} · {detail.summary.contractCode}</h2>
                <p className="text-xs text-text-secondary-light">{currency} · {detail.summary.validFrom}{detail.summary.validTo ? ` a ${detail.summary.validTo}` : ''} · Estaciones {detail.stations.join(', ') || '—'}</p>
                <p className="text-xs text-text-secondary-light">{effect.validity}</p>
              </div>
              <StackedTable>
                <table className="table-stack w-full min-w-[640px] text-left text-sm">
                  <thead className="text-xs uppercase text-text-secondary-light"><tr><th className="p-2">Servicio</th><th className="p-2">Unidad</th><th className="p-2">Contrato</th><th className="p-2">Tarifa base</th><th className="p-2">Diferencia</th></tr></thead>
                  <tbody>{detail.rates.map(rate => (
                    <tr key={rate.rateId} className="border-t border-black/5 dark:border-white/5">
                      <td className="p-2"><strong>{rate.serviceCode}</strong><span className="block text-xs text-text-secondary-light">{rate.serviceName}</span></td>
                      <td className="p-2 text-xs">Por {billingUnitLabel(rate.billingUnit)} · mín. {rate.contractMinimum}</td>
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
              {detail.packages?.length > 0 && <section><h3 className="text-sm font-semibold">Paquetes contractuales</h3><ul className="mt-2 space-y-2">{detail.packages.map(item => <li key={item.id ?? item.packageVersionId ?? item.code} className="rounded-lg bg-black/5 p-3 text-xs dark:bg-white/5"><strong>{item.code} · {item.name}</strong> · versión {item.versionNumber} · {packageScopeLabel(item.scope)} · base {formatMoney(item.basePrice, item.currencyCode)}</li>)}</ul><p className="mt-2 text-xs text-text-secondary-light">Los servicios cubiertos no se cobrarán individualmente. Las inclusiones y excedentes conservan la versión aprobada del paquete.</p></section>}
              {detail.history.length > 0 && (
                <div className="text-xs text-text-secondary-light">
                  {detail.history.map(item => <p key={item.decidedAt}>{item.decision === 'Approved' ? 'Aprobado' : 'Devuelto'} por {item.decidedBy} · {new Date(item.decidedAt).toLocaleString('es-DO')}{item.reason ? ` · ${item.reason}` : ''}</p>)}
                </div>
              )}
              {canDecide && detail.summary.status === 'PendingFinanceApproval' && (
                <div className="flex flex-wrap justify-end gap-2">
                  <button type="button" onClick={() => { setDeciding('Returned'); setReason(''); }} className="min-h-[40px] rounded-lg border border-status-danger/40 px-4 text-sm font-semibold text-status-danger">Devolver a Contratos</button>
                  <button type="button" onClick={() => { setDeciding('Approved'); setReason(''); }} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Aprobar precios</button>
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <Modal open={Boolean(deciding)} onClose={() => setDeciding(null)} tone={deciding === 'Returned' ? 'danger' : 'default'}
        title={deciding === 'Approved' ? 'Aprobar precios' : 'Devolver contrato'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setDeciding(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="contract-decision-form" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${deciding === 'Returned' ? 'bg-status-danger' : 'bg-accent-600'}`}>{deciding === 'Approved' ? 'Aprobar precios' : 'Devolver'}</button></div>}>
        <form id="contract-decision-form" onSubmit={decide} className="space-y-3">
          <p className="text-sm">{deciding === 'Approved' ? effect?.explained : 'Contratos verá el motivo y podrá corregir el borrador. La aerolínea solo verá que la versión fue devuelta, sin el motivo.'}</p>
          <label className="block text-sm font-semibold">{deciding === 'Approved' ? 'Comentario (opcional)' : 'Motivo'}
            <textarea required={deciding === 'Returned'} minLength={deciding === 'Returned' ? 3 : undefined} maxLength={1000} rows={3} value={reason}
              onChange={event => setReason(event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark" />
          </label>
        </form>
      </Modal>
    </div>
  );
}
