import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import Drawer from '../../../components/Drawer';
import EmptyState from '../../../components/EmptyState';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import Tabs from '../../../components/Tabs';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { TariffIcon } from '../components/icons';
import { latestPublishedStart, VersionList } from '../tariffs/ServiceTariffsPage';
import {
  createChargeTariffDraft, deleteChargeTariffDraft, FINANCE_CURRENCIES, formatMoney, getChargeTariff, listBillingUnits,
  listCharges, listChargeTariffs, listFinanceServices, publishChargeTariff, saveCharge, saveChargeTariffDraft,
} from '../../../services/financeBookService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

export const CATEGORY_LABELS = { Surcharge: 'Recargo', AdditionalCharge: 'Cargo adicional', Minimum: 'Mínimo', Manual: 'Manual' };
export const METHOD_LABELS = {
  FixedAmount: 'Importe fijo', PercentOfService: '% del servicio', PerHour: 'Por hora', PerMinute: 'Por minuto', PerUnit: 'Por unidad',
};
export const RULE_LABELS = {
  One: 'Una vez', ServiceDuration: 'Duración del servicio', OperationOverrun: 'Exceso sobre el fin planificado',
  ArrivalDelay: 'Demora de la llegada', ServiceQuantity: 'Cantidad del servicio',
};
/** Rules each method accepts; mirrors the API's shape validation. */
export const RULES_BY_METHOD = {
  FixedAmount: ['One'], PercentOfService: ['One'], PerHour: ['ServiceDuration', 'OperationOverrun', 'ArrivalDelay'],
  PerMinute: ['ServiceDuration', 'OperationOverrun', 'ArrivalDelay'], PerUnit: ['One', 'ServiceQuantity'],
};

const blankCharge = () => ({
  code: '', name: '', description: '', category: 'Surcharge', method: 'PercentOfService', quantityRule: 'One',
  graceMinutes: 0, roundingIncrement: 0, appliesToAllServices: true, serviceIds: [], allowMultiple: false,
  visibleToAgents: true, isActive: true, billingUnit: '',
});

function ChargeDrawer({ open, charge, services, units, onClose, onSaved }) {
  const [form, setForm] = useState(blankCharge);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm(charge ? { ...blankCharge(), ...charge, description: charge.description ?? '', billingUnit: charge.billingUnit ?? '' }
      : blankCharge());
    setError('');
  }, [open, charge]);
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const timeBased = form.method === 'PerHour' || form.method === 'PerMinute';

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await saveCharge(charge?.id, {
        ...form, description: form.description || null, billingUnit: form.billingUnit || null,
        graceMinutes: Number(form.graceMinutes), roundingIncrement: Number(form.roundingIncrement),
        serviceIds: form.appliesToAllServices ? null : form.serviceIds, expectedVersion: charge?.version ?? null,
      });
      onSaved(charge ? 'Cargo actualizado.' : 'Cargo creado. Asígnele un importe en el tarifario de cargos.');
    } catch (failure) {
      setError(failure.status === 409 ? 'Ya existe un cargo con ese código o el cargo cambió.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={charge ? 'Editar cargo' : 'Nuevo cargo'} widthClassName="lg:w-[560px]"
      description="Los agentes de rampa marcan el cargo; Finanzas lo valora con el tarifario de cargos."
      footer={<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="charge-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar cargo'}</button></div>}>
      {open && (
        <form id="charge-form" onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="text-xs font-semibold">Código<input required minLength={2} maxLength={32} pattern="[A-Za-z0-9_\-]+" value={form.code} onChange={event => set({ code: event.target.value.toUpperCase() })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Nombre<input required maxLength={120} value={form.name} onChange={event => set({ name: event.target.value })} className={fieldClass} /></label>
          </div>
          <label className="block text-xs font-semibold">Descripción para el agente<textarea maxLength={500} rows={2} value={form.description} onChange={event => set({ description: event.target.value })} className={fieldClass} /></label>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">Categoría<select value={form.category} onChange={event => set({ category: event.target.value })} className={fieldClass}>
              {Object.entries(CATEGORY_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-xs font-semibold">Cálculo<select value={form.method} onChange={event => set({ method: event.target.value, quantityRule: RULES_BY_METHOD[event.target.value][0] })} className={fieldClass}>
              {Object.entries(METHOD_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
            <label className="text-xs font-semibold">Cantidad<select value={form.quantityRule} onChange={event => set({ quantityRule: event.target.value })} className={fieldClass}>
              {RULES_BY_METHOD[form.method].map(value => <option key={value} value={value}>{RULE_LABELS[value]}</option>)}</select></label>
          </div>
          {timeBased && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs font-semibold">Minutos de gracia<input type="number" min="0" max="1440" value={form.graceMinutes} onChange={event => set({ graceMinutes: event.target.value })} className={fieldClass} /></label>
              <label className="text-xs font-semibold">Redondear hacia arriba cada ({form.method === 'PerHour' ? 'horas' : 'minutos'})<input type="number" min="0" step="0.25" value={form.roundingIncrement} onChange={event => set({ roundingIncrement: event.target.value })} className={fieldClass} /></label>
            </div>
          )}
          <label className="block text-xs font-semibold">Unidad de cobro{form.method === 'PerUnit' ? '' : ' (opcional)'}
            <select required={form.method === 'PerUnit'} value={form.billingUnit} onChange={event => set({ billingUnit: event.target.value })} className={fieldClass}>
              <option value="">—</option>{units.map(unit => <option key={unit.code} value={unit.code}>{unit.name}</option>)}</select></label>
          <fieldset className="space-y-2">
            <legend className="text-xs font-semibold">Servicios a los que aplica</legend>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.appliesToAllServices} onChange={event => set({ appliesToAllServices: event.target.checked })} />Todos los servicios</label>
            {!form.appliesToAllServices && (
              <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
                {services.map(service => (
                  <label key={service.id} className="flex min-h-[36px] items-center gap-2 rounded-lg border border-black/10 px-2 text-xs dark:border-white/10">
                    <input type="checkbox" checked={form.serviceIds.includes(service.id)} onChange={() => set({
                      serviceIds: form.serviceIds.includes(service.id) ? form.serviceIds.filter(id => id !== service.id) : [...form.serviceIds, service.id],
                    })} />{service.code}</label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
            {[['allowMultiple', 'Puede aplicarse varias veces'], ['visibleToAgents', 'Visible en la app de rampa'], ['isActive', 'Activo']].map(([key, label]) => (
              <label key={key} className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form[key]} onChange={event => set({ [key]: event.target.checked })} />{label}</label>
            ))}
          </div>
        </form>
      )}
    </Drawer>
  );
}

function Catalog({ perms }) {
  const [charges, setCharges] = useState(null);
  const [services, setServices] = useState([]);
  const [units, setUnits] = useState([]);
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const load = useCallback(async () => {
    try { setCharges(await listCharges()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => {
    void load();
    Promise.all([listFinanceServices().catch(() => []), listBillingUnits().catch(() => [])]).then(([serviceList, unitList]) => {
      setServices(serviceList.filter(service => service.isActive));
      setUnits(unitList.filter(unit => unit.isActive));
    });
  }, [load]);
  return (
    <section className="space-y-3">
      {perms.create && <div className="flex justify-end"><button type="button" onClick={() => { setEditing(null); setOpen(true); }} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo cargo</button></div>}
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {!charges ? !error && <p role="status" className="text-sm">Cargando cargos…</p> : charges.length === 0 ? (
        <EmptyState icon={TariffIcon} title="Sin cargos" description="Cree los cargos y recargos que los agentes podrán aplicar." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[720px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Cargo</th><th className="p-3">Categoría</th><th className="p-3">Cálculo</th><th className="p-3">Alcance</th><th className="p-3">Estado</th>{perms.update && <th className="p-3">Acción</th>}</tr></thead>
            <tbody>{charges.map(charge => (
              <tr key={charge.id} className="border-t border-black/5 dark:border-white/5">
                <td className="p-3"><strong>{charge.code}</strong><span className="block text-xs text-text-secondary-light">{charge.name}</span></td>
                <td className="p-3">{CATEGORY_LABELS[charge.category] ?? charge.category}</td>
                <td className="p-3 text-xs">{METHOD_LABELS[charge.method]} · {RULE_LABELS[charge.quantityRule]}{charge.graceMinutes ? ` · gracia ${charge.graceMinutes} min` : ''}</td>
                <td className="p-3 text-xs">{charge.appliesToAllServices ? 'Todos los servicios' : `${charge.serviceIds.length} servicio(s)`}{charge.visibleToAgents ? '' : ' · oculto en rampa'}</td>
                <td className="p-3"><StatusBadge tone={charge.isActive ? 'success' : 'neutral'} label={charge.isActive ? 'Activo' : 'Inactivo'} /></td>
                {perms.update && <td className="p-3"><button type="button" onClick={() => { setEditing(charge); setOpen(true); }} className="min-h-[32px] text-xs font-semibold text-accent-600">Editar</button></td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <ChargeDrawer open={open} charge={editing} services={services} units={units} onClose={() => setOpen(false)}
        onSaved={message => { setOpen(false); setNotice(message); void load(); }} />
    </section>
  );
}

function ChargeTariff({ perms }) {
  const [currency, setCurrency] = useState('USD');
  const [versions, setVersions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rates, setRates] = useState([]);
  const [charges, setCharges] = useState([]);
  const [validFrom, setValidFrom] = useState('');
  const [confirm, setConfirm] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState({ tone: '', text: '' });
  /** Bumped on every list read so the selected detail and its version are re-read after a save. */
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async keep => {
    try {
      const list = await listChargeTariffs(currency);
      setVersions(list);
      setReloads(value => value + 1);
      setSelectedId(keep && list.some(item => item.id === keep) ? keep
        : list.find(item => item.status === 'Draft')?.id ?? list.find(item => item.status === 'Published')?.id ?? list[0]?.id ?? null);
    } catch (failure) {
      setVersions([]);
      setMessage({ tone: 'error', text: failure.message });
    }
  }, [currency]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { listCharges().then(setCharges).catch(() => setCharges([])); }, []);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let active = true;
    getChargeTariff(selectedId).then(result => {
      if (!active) return;
      setDetail(result);
      setRates(result.rates);
      setValidFrom(result.summary.validFrom);
    }).catch(failure => active && setMessage({ tone: 'error', text: failure.message }));
    return () => { active = false; };
  }, [selectedId, reloads]);

  const editable = perms.update && detail?.summary.status === 'Draft';
  const draftActions = (perms.update || perms.delete || perms.publish) && detail?.summary.status === 'Draft';
  async function run(action, success, conflict = 'La tarifa cambió. Se actualizó la vista.') {
    setBusy(true);
    setMessage({ tone: '', text: '' });
    try {
      const result = await action();
      setMessage({ tone: 'success', text: success });
      await load(result?.id ?? selectedId);
    } catch (failure) {
      setMessage({ tone: 'error', text: failure.status === 409 ? conflict : failure.message });
      await load(selectedId);
    } finally {
      setBusy(false);
    }
  }
  const rows = charges.filter(charge => charge.isActive || rates.some(rate => rate.chargeId === charge.id)).map(charge => ({
    charge, rate: rates.find(item => item.chargeId === charge.id),
  }));
  const setRate = (charge, patch) => setRates(current => {
    const existing = current.find(item => item.chargeId === charge.id);
    if (!existing) return [...current, { chargeId: charge.id, chargeCode: charge.code, chargeName: charge.name, method: charge.method, value: 0, minimumAmount: 0, ...patch }];
    return current.map(item => (item.chargeId === charge.id ? { ...item, ...patch } : item));
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">Moneda<select value={currency} onChange={event => setCurrency(event.target.value)} className={fieldClass}>{FINANCE_CURRENCIES.map(code => <option key={code}>{code}</option>)}</select></label>
        {perms.create && !versions?.some(version => version.status === 'Draft') && (
          <button type="button" disabled={busy} onClick={() => run(() => createChargeTariffDraft({ currencyCode: currency,
            validFrom: new Date().toISOString().slice(0, 10), note: null,
            copyFromVersionId: versions?.find(version => version.status === 'Published')?.id ?? null }), 'Borrador creado.')}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Nueva versión</button>
        )}
      </div>
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {!versions ? <p role="status" className="text-sm">Cargando…</p> : versions.length === 0 ? (
        <EmptyState icon={TariffIcon} title="Sin tarifario de cargos" description={`Aún no hay importes de cargos en ${currency}.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
          <VersionList versions={versions} selectedId={selectedId} onSelect={setSelectedId} />
          {detail && (
            <section className="min-w-0 space-y-3 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <label className="block max-w-xs text-xs font-semibold">Vigente desde<input type="date" disabled={!editable} value={validFrom} onChange={event => setValidFrom(event.target.value)} className={fieldClass} /></label>
              <StackedTable>
                <table className="table-stack w-full min-w-[560px] text-left text-sm">
                  <thead className="text-xs uppercase text-text-secondary-light"><tr><th className="p-2">Cargo</th><th className="p-2">Cálculo</th><th className="p-2">Importe</th><th className="p-2">Mínimo</th></tr></thead>
                  <tbody>{rows.map(({ charge, rate }) => (
                    <tr key={charge.id} className="border-t border-black/5 dark:border-white/5">
                      <td className="p-2"><strong>{charge.code}</strong><span className="block text-xs text-text-secondary-light">{charge.name}</span></td>
                      <td className="p-2 text-xs">{METHOD_LABELS[charge.method]}</td>
                      <td className="p-2">{editable ? <input aria-label={`Importe de ${charge.code}`} type="number" min="0" step="0.01" value={rate?.value ?? ''} placeholder="Sin importe" onChange={event => setRate(charge, { value: event.target.value })} className={fieldClass} />
                        : rate ? (charge.method === 'PercentOfService' ? `${rate.value} %` : formatMoney(rate.value, detail.summary.currencyCode)) : '—'}</td>
                      <td className="p-2">{editable ? <input aria-label={`Mínimo de ${charge.code}`} type="number" min="0" step="0.01" value={rate?.minimumAmount ?? ''} onChange={event => setRate(charge, { minimumAmount: event.target.value })} className={fieldClass} />
                        : rate ? formatMoney(rate.minimumAmount, detail.summary.currencyCode) : '—'}</td>
                    </tr>
                  ))}</tbody>
                </table>
              </StackedTable>
              {draftActions && (
                <div className="flex flex-wrap justify-end gap-2">
                  {perms.delete && <button type="button" disabled={busy} onClick={() => setConfirm('delete')} className="rounded-lg border border-status-danger/40 px-4 py-2 text-sm font-semibold text-status-danger">Descartar borrador</button>}
                  {perms.update && <button type="button" disabled={busy} onClick={() => run(() => saveChargeTariffDraft(detail.summary.id, {
                    validFrom, validTo: null, note: detail.summary.note, expectedVersion: detail.summary.version,
                    rates: rates.filter(rate => rate.value !== '' && rate.value !== null).map(rate => ({ chargeId: rate.chargeId,
                      value: Number(rate.value), minimumAmount: Number(rate.minimumAmount || 0) })),
                  }), 'Borrador guardado.')} className="rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600">Guardar</button>}
                  {perms.publish && <button type="button" disabled={busy} onClick={() => setConfirm('publish')} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Publicar</button>}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <ConfirmDialog open={confirm === 'publish'} title="Publicar tarifario de cargos" description="La versión pasa a ser la vigente y la anterior queda como histórica. Guarde antes los cambios pendientes."
        confirmLabel="Publicar" onClose={() => setConfirm(null)}
        onConfirm={async () => {
          setConfirm(null);
          const latest = latestPublishedStart(versions);
          if (latest && detail.summary.validFrom <= latest) {
            setMessage({ tone: 'error', text: `La vigencia debe empezar después del ${latest}, inicio de la última versión publicada. Cambie «Vigente desde» y guarde.` });
            return;
          }
          await run(() => publishChargeTariff(detail.summary.id, detail.summary.version), 'Tarifario publicado.',
            'No se pudo publicar: la vigencia debe empezar después de la versión vigente o la tarifa cambió. Se actualizó la vista.');
        }} />
      <ConfirmDialog open={confirm === 'delete'} title="Descartar borrador" description="El borrador se eliminará." confirmLabel="Descartar"
        onClose={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await run(() => deleteChargeTariffDraft(detail.summary.id, detail.summary.version), 'Borrador descartado.'); }} />
    </div>
  );
}

export default function ChargesPage() {
  const { access } = useDepartmentAccess();
  // «Crear» opens drafts, «Modificar» edits them, «Eliminar» discards them and «Publicar» makes them current.
  const perms = { create: Boolean(access?.can('finance.charges.create')), update: Boolean(access?.can('finance.charges.update')),
    delete: Boolean(access?.can('finance.charges.delete')), publish: Boolean(access?.can('finance.charges.publish')) };
  const [tab, setTab] = useState('catalog');
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Tarifario de cargos"
        description="Recargos y cargos que los agentes de rampa aplican a los servicios, y sus importes por moneda." />
      <Tabs activeId={tab} onChange={setTab} tabs={[{ id: 'catalog', label: 'Catálogo de cargos' }, { id: 'tariff', label: 'Importes' }]} />
      {tab === 'catalog' ? <Catalog perms={perms} /> : <ChargeTariff perms={perms} />}
    </div>
  );
}
