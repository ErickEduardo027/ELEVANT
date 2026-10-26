'use client';

import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import PageHeader from '../../../components/PageHeader';
import StatusBadge from '../../../components/StatusBadge';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { FINANCE_CURRENCIES, formatMoney, listBillingUnits, listFinanceServices } from '../../../services/financeBookService';
import {
  createPackageCommand, financePackageError, listFinancePackages, publishFinancePackage, saveFinancePackageDraft,
} from '../../../services/financePackagesService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const buttonClass = 'rounded-lg border border-black/15 px-4 py-2 text-sm font-semibold disabled:opacity-50 dark:border-white/15';
const statusMeta = {
  Draft: { label: 'Borrador', tone: 'warning' },
  Published: { label: 'Publicada', tone: 'success' },
  Superseded: { label: 'Histórica', tone: 'neutral' },
};
const scopeNames = { Turnaround: 'Rotación', Flight: 'Vuelo', Period: 'Período' };

const newPackage = () => ({ code: '', name: '', currencyCode: 'USD', basePrice: '', scope: 'Turnaround',
  flightDirection: null, periodDays: null, validFrom: new Date().toISOString().slice(0, 10), validTo: '',
  status: 'Draft', components: [] });

export default function PackagesPage() {
  const { access } = useDepartmentAccess();
  const canRead = access?.can('finance.packages.read') ?? false;
  const canCreate = access?.can('finance.packages.create') ?? false;
  const canUpdate = access?.can('finance.packages.update') ?? false;
  const canPublish = access?.can('finance.packages.publish') ?? false;
  const canManage = canCreate || canUpdate;
  const [data, setData] = useState({ status: 'loading', packages: [], services: [], units: [] });
  const [selection, setSelection] = useState(null);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const load = useCallback(async keep => {
    if (!canRead) return;
    setData(current => ({ ...current, status: 'loading', error: '' }));
    try {
      const [packages, services, units] = await Promise.all([
        listFinancePackages(), canManage ? listFinanceServices() : [], canManage ? listBillingUnits() : [],
      ]);
      setData({ status: 'ready', packages, services: services.filter(item => item.isActive), units: units.filter(item => item.isActive) });
      setSelection({ item: packages.find(item => item.id === keep) ?? packages[0] ?? null });
    } catch (error) {
      setData(current => ({ ...current, status: 'error', error: financePackageError(error) }));
    }
  }, [canRead, canManage]);
  useEffect(() => { void load(); }, [load]);

  if (!canRead) return <p role="alert" className="p-4 text-sm">No tiene permiso para consultar paquetes.</p>;
  return <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
    <PageHeader eyebrow="Finanzas" title="Paquetes de servicios"
      description="Defina coberturas, cantidades incluidas y bloques de excedente. Cada publicación conserva su historial."
      actions={<><button type="button" disabled={busy || data.status === 'loading'} onClick={() => void load(selection?.item?.id)} className={buttonClass}>Actualizar</button>
        {canCreate && <button type="button" disabled={busy || data.status !== 'ready'} onClick={() => { setNotice(''); setSelection({ item: newPackage() }); }} className={`${buttonClass} bg-accent-600 text-white`}>Nuevo paquete</button>}</>} />
    {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
    {data.status === 'loading' ? <p role="status" className="text-sm">Cargando paquetes…</p>
      : data.status === 'error' ? <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{data.error}</p>
        : <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(14rem,19rem)_minmax(0,1fr)]">
          <section aria-label="Versiones de paquetes" className="space-y-2">
            {data.packages.length === 0 && <p className="rounded-xl border border-black/5 bg-white p-4 text-sm dark:bg-surface-dark-card">Aún no hay paquetes definidos.</p>}
            {data.packages.map(item => <button type="button" key={item.id} disabled={busy} aria-pressed={selection?.item?.id === item.id}
              onClick={() => { setNotice(''); setSelection({ item }); }}
              className={`w-full rounded-xl border bg-white p-4 text-left dark:bg-surface-dark-card ${selection?.item?.id === item.id ? 'border-accent-600' : 'border-black/10 dark:border-white/10'}`}>
              <strong className="block text-sm">{item.code} · v{item.versionNumber}</strong><span className="block break-words text-sm">{item.name}</span>
              <span className="mt-2 flex flex-wrap items-center gap-2"><StatusBadge {...(statusMeta[item.status] ?? { label: item.status })} /><span className="text-xs">{formatMoney(item.basePrice, item.currencyCode)}</span></span>
            </button>)}
          </section>
          {selection?.item && <PackageEditor key={JSON.stringify(selection)} item={selection.item} copy={selection.copy}
            canManage={canUpdate} canCreate={canCreate} canPublish={canPublish} services={data.services} units={data.units} onBusy={setBusy}
            onCopy={() => setSelection({ item: { ...selection.item, id: null, version: null, status: 'Draft' }, copy: true })}
            onSaved={async (id, text) => { setNotice(text); await load(id); }} />}
        </div>}
  </div>;
}

function PackageEditor({ item, copy, canManage, canCreate = canManage, canPublish = canManage, services, units, onBusy, onCopy, onSaved }) {
  const [values, setValues] = useState({ ...item, validTo: item.validTo ?? '' });
  const [dirty, setDirty] = useState(!item.id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [confirm, setConfirm] = useState(false);
  const [command] = useState(createPackageCommand);
  const editable = canManage && item.status === 'Draft';
  const patch = changes => { setValues(current => ({ ...current, ...changes })); setDirty(true); };
  const updateComponent = (id, changes) => patch({ components: values.components.map(component => component.serviceId === id ? { ...component, ...changes } : component) });
  const missingServices = services.filter(service => !values.components.some(component => component.serviceId === service.id));

  async function run(operation, payload, send, message) {
    if (busy) return;
    setBusy(true); onBusy(true); setError('');
    try {
      const result = await command(operation, payload, send);
      await onSaved(result.id, message);
    } catch (failure) { setError(financePackageError(failure)); }
    finally { setBusy(false); onBusy(false); }
  }

  function save(event) {
    event.preventDefault();
    if (!editable) return;
    if (!values.components.length) { setError('Añada al menos un servicio al paquete.'); return; }
    if (values.components.some(component => !services.some(service => service.id === component.serviceId)
      || !units.some(unit => unit.code === component.billingUnit))) {
      setError('Seleccione servicios y unidades de facturación activos.'); return;
    }
    const payload = {
      code: values.code.trim(), name: values.name.trim(), currencyCode: values.currencyCode, basePrice: Number(values.basePrice),
      scope: values.scope, flightDirection: values.scope === 'Flight' ? values.flightDirection : null,
      periodDays: values.scope === 'Period' ? Number(values.periodDays) : null,
      validFrom: values.validFrom, validTo: values.validTo || null, expectedVersion: item.id ? item.version : null,
      components: values.components.map(component => ({ serviceId: component.serviceId, billingUnit: component.billingUnit,
        includedQuantity: Number(component.includedQuantity), excessBlockSize: Number(component.excessBlockSize), excessBlockPrice: Number(component.excessBlockPrice) })),
    };
    void run(`save:${item.id ?? 'new'}`, payload, body => saveFinancePackageDraft(item.id, body), 'Borrador de paquete guardado.');
  }

  return <section className="min-w-0 space-y-4 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-bold">{item.id ? `${item.code} · versión ${item.versionNumber}` : copy ? `Nueva versión de ${item.code} (origen v${item.versionNumber})` : 'Nuevo paquete'}</h2>
      <p className="mt-1 text-xs text-text-secondary-light">{item.id && item.status !== 'Draft' ? 'Versión inmutable. Cree una nueva versión para cambiar su definición.' : 'Guarde los cambios antes de publicar.'}</p></div>
      {canCreate && item.id && item.status !== 'Draft' && <button type="button" disabled={busy} onClick={onCopy} className={buttonClass}>Nueva versión</button>}</div>
    {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
    <form onSubmit={save} className="space-y-4">
      <fieldset disabled={!editable || busy} className="min-w-0 space-y-4">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="text-xs font-semibold">Código<input required minLength={2} maxLength={32} pattern="(?:[A-Z0-9]|-){2,32}" title="De 2 a 32 letras mayúsculas, números o guiones" disabled={Boolean(item.id || copy)} value={values.code} onChange={event => patch({ code: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Nombre<input required maxLength={120} value={values.name} onChange={event => patch({ name: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Moneda<select disabled={Boolean(item.id || copy)} value={values.currencyCode} onChange={event => patch({ currencyCode: event.target.value })} className={fieldClass}>{FINANCE_CURRENCIES.map(currency => <option key={currency}>{currency}</option>)}</select></label>
          <label className="text-xs font-semibold">Precio base<input type="number" min="0" max="900000000000" step="0.0001" required value={values.basePrice} onChange={event => patch({ basePrice: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Alcance<select value={values.scope} onChange={event => patch({ scope: event.target.value, flightDirection: null, periodDays: null })} className={fieldClass}>{Object.entries(scopeNames).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {values.scope === 'Flight' && <label className="text-xs font-semibold">Dirección del vuelo<select required value={values.flightDirection ?? ''} onChange={event => patch({ flightDirection: event.target.value })} className={fieldClass}><option value="">Seleccione…</option><option value="Arrival">Llegada</option><option value="Departure">Salida</option></select></label>}
          {values.scope === 'Period' && <label className="text-xs font-semibold">Días del período<input type="number" min="1" max="366" step="1" required value={values.periodDays ?? ''} onChange={event => patch({ periodDays: event.target.value })} className={fieldClass} /></label>}
          <label className="text-xs font-semibold">Vigente desde<input type="date" required value={values.validFrom} onChange={event => patch({ validFrom: event.target.value })} className={fieldClass} /></label>
          <label className="text-xs font-semibold">Hasta (opcional)<input type="date" min={values.validFrom} value={values.validTo} onChange={event => patch({ validTo: event.target.value })} className={fieldClass} /></label>
        </div>
        <div className="space-y-3"><h3 className="text-sm font-bold">Servicios incluidos</h3>
          {values.components.length === 0 && <p className="text-sm text-text-secondary-light">Añada los servicios que cubre este paquete.</p>}
          {values.components.map(component => <div key={component.serviceId} className="rounded-lg border border-black/10 p-3 dark:border-white/10">
            <div className="flex flex-wrap items-center justify-between gap-2"><strong className="text-sm">{component.serviceCode} · {component.serviceName}</strong>
              {editable && <button type="button" onClick={() => patch({ components: values.components.filter(value => value.serviceId !== component.serviceId) })} className="text-xs font-semibold text-status-danger">Quitar {component.serviceCode}</button>}</div>
            <div className="mt-2 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <label className="text-xs">Unidad de {component.serviceCode}<select required value={component.billingUnit} onChange={event => updateComponent(component.serviceId, { billingUnit: event.target.value })} className={fieldClass}>
                <option value="">Seleccione…</option>{units.map(unit => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
                {component.billingUnit && !units.some(unit => unit.code === component.billingUnit) && <option value={component.billingUnit}>{component.billingUnit}</option>}</select></label>
              {[['includedQuantity', 'Cantidad incluida', 0], ['excessBlockSize', 'Tamaño del bloque excedente', 0.0001], ['excessBlockPrice', 'Precio del bloque excedente', 0]].map(([key, label, min]) => <label key={key} className="text-xs">{label} de {component.serviceCode}<input required type="number" min={min} step="0.0001" value={component[key]} onChange={event => updateComponent(component.serviceId, { [key]: event.target.value })} className={fieldClass} /></label>)}
            </div>
          </div>)}
          {editable && missingServices.length > 0 && <label className="block text-xs font-semibold">Añadir servicio<select value="" onChange={event => {
            const service = missingServices.find(candidate => candidate.id === event.target.value);
            if (service) patch({ components: [...values.components, { serviceId: service.id, serviceCode: service.code, serviceName: service.name,
              billingUnit: units.some(unit => unit.code === service.defaultBillingUnit) ? service.defaultBillingUnit : units[0]?.code ?? '',
              includedQuantity: 0, excessBlockSize: 1, excessBlockPrice: 0 }] });
          }} className={fieldClass}><option value="">Seleccione…</option>{missingServices.map(service => <option key={service.id} value={service.id}>{service.code} · {service.name}</option>)}</select></label>}
        </div>
      </fieldset>
      {editable && <div className="flex flex-wrap justify-end gap-2"><button type="submit" disabled={busy || !dirty} className={buttonClass}>Guardar borrador</button>
        {item.id && canPublish && <button type="button" disabled={busy || dirty || !item.version || !values.components.length} onClick={() => setConfirm(true)} className={`${buttonClass} bg-accent-600 text-white`}>Publicar</button>}</div>}
    </form>
    <ConfirmDialog open={confirm} title="Publicar paquete" description="La definición quedará inmutable y disponible para Contratos. La publicación anterior se conservará como histórica."
      confirmLabel="Publicar" busy={busy} onClose={() => setConfirm(false)} onConfirm={() => {
        setConfirm(false);
        void run(`publish:${item.id}`, { expectedVersion: item.version }, body => publishFinancePackage(item.id, body), 'Paquete publicado.');
      }} />
  </section>;
}
