import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { formatMoney } from '../../../services/financeBookService';
import { confirmCharterPrepayment, listFinanceCharters } from '../../../services/financeChartersService';
import { ApprovedServicesIcon } from '../components/icons';

/**
 * «Charters sin contrato» (ADR-0033): flights served without a contract, priced at the base
 * tariff. The signed Service Request is the flight's agreement; Finance confirms the carrier's
 * prepayment here.
 */
export default function ChartersPage() {
  const { access } = useDepartmentAccess();
  const canConfirm = Boolean(access?.can('finance.charters.confirm'));
  const [state, setState] = useState({ status: 'loading', items: [] });
  const [editing, setEditing] = useState(null);
  const [amount, setAmount] = useState('');
  const [reference, setReference] = useState('');
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
    setEditing(item.id);
    setAmount(item.servicesTotal != null ? String(item.servicesTotal) : '');
    setReference('');
    setMessage({ tone: '', text: '' });
  }

  async function confirm(event, item) {
    event.preventDefault();
    setBusy(true);
    try {
      await confirmCharterPrepayment(item.id, Number(amount), reference);
      setMessage({ tone: 'success', text: `Prepago confirmado para ${item.operationCode}.` });
      setEditing(null);
    } catch (error) {
      setMessage({ tone: 'error', text: error.message });
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
                    {canConfirm && item.prepaymentStatus !== 'Confirmed' && (editing === item.id ? (
                      <form onSubmit={event => void confirm(event, item)} className="flex flex-wrap items-end gap-2">
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
