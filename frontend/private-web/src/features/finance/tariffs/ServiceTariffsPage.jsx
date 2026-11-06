import { useCallback, useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../../../components/ConfirmDialog';
import EmptyState from '../../../components/EmptyState';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import StatusBadge from '../../../components/StatusBadge';
import Tabs from '../../../components/Tabs';
import { useDepartmentAccess } from '../../access/DepartmentAccessContext';
import { TariffIcon } from '../components/icons';
import LoadFailure, { loadFailure } from '../components/LoadFailure';
import TariffsPage from './TariffsPage';
import { billingUnitLabel, proposedBillingUnit } from '../../../services/billingUnits';
import {
  createServiceTariffDraft, deleteServiceTariffDraft, FINANCE_CURRENCIES, formatMoney, getServiceTariff, listFinanceServices,
  listBillingUnits, listServiceTariffs, publishServiceTariff, saveServiceTariffDraft,
} from '../../../services/financeBookService';
import { financeTariffMessage } from '../../../services/financeErrors';
import { isConflict } from '../../../services/problemMessages';
import { statusMeta, TARIFF_VERSION_STATUS } from '../financeLabels';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
export const VERSION_STATUS = TARIFF_VERSION_STATUS;
const LOAD_FAILED = 'No se pudieron cargar las tarifas. Revise la conexión e intente de nuevo.';

export function VersionList({ versions, selectedId, onSelect }) {
  return (
    <ul className="space-y-2">
      {versions.map(version => {
        const status = statusMeta(VERSION_STATUS, version.status);
        return (
          <li key={version.id}>
            <button type="button" onClick={() => onSelect(version.id)}
              className={`w-full rounded-xl border p-3 text-left transition ${selectedId === version.id ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 bg-white hover:border-accent-600/40 dark:border-white/10 dark:bg-surface-dark-card'}`}>
              <div className="flex items-center justify-between gap-2">
                <strong className="text-sm">{version.currencyCode} · desde {version.validFrom}</strong>
                <StatusBadge tone={status.tone} label={status.label} />
              </div>
              <p className="mt-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {version.rateCount} tarifas{version.validTo ? ` · hasta ${version.validTo}` : ''}{version.publishedBy ? ` · ${version.publishedBy}` : ''}
              </p>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

/** Finance base price list: versioned per currency, edited as a draft and published once reviewed. */
/** Latest start date among non-draft versions; a new version must start after it. */
export function latestPublishedStart(versions) {
  return (versions ?? []).filter(item => item.status !== 'Draft').map(item => item.validFrom).sort().at(-1) ?? null;
}

function BaseTariff() {
  const { access } = useDepartmentAccess();
  // «Crear» opens drafts, «Modificar» edits them, «Eliminar» discards them and «Publicar» makes them current.
  const perms = { create: Boolean(access?.can('finance.tariffs.create')), update: Boolean(access?.can('finance.tariffs.update')),
    delete: Boolean(access?.can('finance.tariffs.delete')), publish: Boolean(access?.can('finance.tariffs.publish')) };
  const canManage = perms.update;
  const [currency, setCurrency] = useState('USD');
  const [versions, setVersions] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [detail, setDetail] = useState(null);
  const [rates, setRates] = useState([]);
  const [meta, setMeta] = useState({ validFrom: '', validTo: '', note: '' });
  const [services, setServices] = useState([]);
  const [units, setUnits] = useState([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });
  // A list that failed to load shows a recoverable error, never «Sin tarifa base».
  const [loadError, setLoadError] = useState(null);

  /** Bumped on every list read so the selected detail and its version are re-read after a save. */
  const [reloads, setReloads] = useState(0);

  const load = useCallback(async (keep) => {
    try {
      const list = await listServiceTariffs(currency);
      setVersions(list);
      setLoadError(null);
      setReloads(value => value + 1);
      const target = keep && list.some(item => item.id === keep) ? keep
        : list.find(item => item.status === 'Draft')?.id ?? list.find(item => item.status === 'Published')?.id ?? list[0]?.id ?? null;
      setSelectedId(target);
    } catch (error) {
      setVersions(null);
      setLoadError(loadFailure(error, financeTariffMessage(error, { fallback: LOAD_FAILED,
        forbidden: 'No tiene permiso para consultar la tarifa base.' })));
    }
  }, [currency]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    let active = true;
    Promise.all([listFinanceServices().catch(() => []), listBillingUnits().catch(() => [])])
      .then(([serviceList, unitList]) => {
        if (!active) return;
        setServices(serviceList.filter(service => service.isActive));
        setUnits(unitList.filter(unit => unit.isActive));
      });
    return () => { active = false; };
  }, []);
  useEffect(() => {
    if (!selectedId) { setDetail(null); return undefined; }
    let active = true;
    getServiceTariff(selectedId).then(result => {
      if (!active) return;
      setDetail(result);
      setRates(result.rates.map(rate => ({ ...rate, key: `${rate.serviceId}:${rate.stationId ?? '*'}` })));
      setMeta({ validFrom: result.summary.validFrom, validTo: result.summary.validTo ?? '', note: result.summary.note ?? '' });
    }).catch(error => active && setMessage({ tone: 'error', text: financeTariffMessage(error, { fallback: LOAD_FAILED }) }));
    return () => { active = false; };
  }, [selectedId, reloads]);

  const isDraft = detail?.summary.status === 'Draft';
  const editable = perms.update && isDraft;
  const draftActions = (perms.update || perms.delete || perms.publish) && isDraft;
  const visibleRates = useMemo(() => rates.filter(rate =>
    `${rate.serviceCode} ${rate.serviceName}`.toLowerCase().includes(search.trim().toLowerCase())), [rates, search]);
  const missingServices = services.filter(service => !rates.some(rate => rate.serviceId === service.id && !rate.stationId));

  /** Runs a command; a failure is explained by its code (1-E) and a conflict re-reads the versions. */
  async function run(action, success) {
    setBusy(true);
    setMessage({ tone: '', text: '' });
    try {
      const result = await action();
      setMessage({ tone: 'success', text: success });
      await load(result?.id ?? selectedId);
      return true;
    } catch (error) {
      setMessage({ tone: 'error', text: financeTariffMessage(error) });
      if (isConflict(error)) await load(selectedId);
      return false;
    } finally {
      setBusy(false);
    }
  }

  const save = () => run(() => saveServiceTariffDraft(detail.summary.id, {
    validFrom: meta.validFrom, validTo: meta.validTo || null, note: meta.note || null, expectedVersion: detail.summary.version,
    rates: rates.map(rate => ({ serviceId: rate.serviceId, stationId: rate.stationId ?? null, billingUnit: rate.billingUnit,
      unitPrice: Number(rate.unitPrice), minimumBillableQuantity: Number(rate.minimumBillableQuantity) })),
  }), 'Borrador guardado.');

  async function publish() {
    const latest = latestPublishedStart(versions);
    if (latest && detail.summary.validFrom <= latest) {
      setMessage({ tone: 'error', text: `La vigencia debe empezar después del ${latest}, inicio de la última versión publicada. Cambie «Vigente desde» y guarde.` });
      return;
    }
    await run(() => publishServiceTariff(detail.summary.id, detail.summary.version), 'Tarifa publicada.');
  }

  const update = (key, patch) => setRates(current => current.map(rate => (rate.key === key ? { ...rate, ...patch } : rate)));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">Moneda
          <select value={currency} onChange={event => setCurrency(event.target.value)} className={fieldClass}>
            {FINANCE_CURRENCIES.map(code => <option key={code}>{code}</option>)}
          </select>
        </label>
        {perms.create && !versions?.some(version => version.status === 'Draft') && (
          <button type="button" disabled={busy} onClick={() => run(() => createServiceTariffDraft({
            currencyCode: currency, validFrom: new Date().toISOString().slice(0, 10), note: null,
            copyFromVersionId: versions?.find(version => version.status === 'Published')?.id ?? null,
          }), 'Borrador creado a partir de la tarifa vigente.')}
            className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Nueva versión</button>
        )}
      </div>
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      <LoadFailure failure={loadError} onRetry={() => { void load(selectedId); }} />
      {!versions ? (loadError ? null : <p role="status" className="text-sm">Cargando tarifas…</p>) : versions.length === 0 ? (
        <EmptyState icon={TariffIcon} title="Sin tarifa base" description={`Aún no hay una tarifa base en ${currency}.`} />
      ) : (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(14rem,18rem)_minmax(0,1fr)]">
          <VersionList versions={versions} selectedId={selectedId} onSelect={setSelectedId} />
          {detail && (
            <section className="min-w-0 space-y-3 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
                <label className="text-xs font-semibold">Vigente desde<input type="date" disabled={!editable} value={meta.validFrom} onChange={event => setMeta(current => ({ ...current, validFrom: event.target.value }))} className={fieldClass} /></label>
                <label className="text-xs font-semibold">Hasta (opcional)<input type="date" disabled={!editable} value={meta.validTo} onChange={event => setMeta(current => ({ ...current, validTo: event.target.value }))} className={fieldClass} /></label>
                <label className="text-xs font-semibold">Nota<input maxLength={500} disabled={!editable} value={meta.note} onChange={event => setMeta(current => ({ ...current, note: event.target.value }))} className={fieldClass} /></label>
              </div>
              <label className="block max-w-sm text-xs font-semibold">Buscar servicio<input type="search" value={search} onChange={event => setSearch(event.target.value)} className={fieldClass} /></label>
              <StackedTable>
                <table className="table-stack w-full min-w-[620px] text-left text-sm">
                  <thead className="text-xs uppercase text-text-secondary-light"><tr><th className="p-2">Servicio</th><th className="p-2">Estación</th><th className="p-2">Unidad</th><th className="p-2">Precio</th><th className="p-2">Mínimo</th>{editable && <th className="p-2">Acción</th>}</tr></thead>
                  <tbody>
                    {visibleRates.map(rate => (
                      <tr key={rate.key} className="border-t border-black/5 dark:border-white/5">
                        <td className="p-2"><strong>{rate.serviceCode}</strong><span className="block text-xs text-text-secondary-light">{rate.serviceName}</span></td>
                        <td className="p-2 text-xs">{rate.stationCode ?? 'Todas'}</td>
                        <td className="p-2">{editable ? (
                          <select aria-label={`Unidad de ${rate.serviceCode}`} value={rate.billingUnit} onChange={event => update(rate.key, { billingUnit: event.target.value })} className={fieldClass}>
                            {units.map(unit => <option key={unit.code} value={unit.code}>{unit.name}</option>)}
                            {!units.some(unit => unit.code === rate.billingUnit) && <option value={rate.billingUnit}>{billingUnitLabel(rate.billingUnit)} (no activa)</option>}
                          </select>) : `Por ${billingUnitLabel(rate.billingUnit, units)}`}</td>
                        <td className="p-2">{editable ? <input aria-label={`Precio de ${rate.serviceCode}`} type="number" min="0" step="0.01" value={rate.unitPrice} onChange={event => update(rate.key, { unitPrice: event.target.value })} className={fieldClass} /> : formatMoney(rate.unitPrice, detail.summary.currencyCode)}</td>
                        <td className="p-2">{editable ? <input aria-label={`Mínimo de ${rate.serviceCode}`} type="number" min="0" step="0.01" value={rate.minimumBillableQuantity} onChange={event => update(rate.key, { minimumBillableQuantity: event.target.value })} className={fieldClass} /> : rate.minimumBillableQuantity}</td>
                        {editable && <td className="p-2"><button type="button" onClick={() => setRates(current => current.filter(item => item.key !== rate.key))} className="text-xs font-semibold text-status-danger">Quitar</button></td>}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </StackedTable>
              {editable && missingServices.length > 0 && (
                <label className="block max-w-sm text-xs font-semibold">Añadir servicio
                  <select value="" onChange={event => {
                    const service = services.find(item => item.id === event.target.value);
                    // 1-E: the proposed unit is always an active unit code; a legacy name maps to its code.
                    if (service) setRates(current => [...current, { key: `${service.id}:*`, serviceId: service.id, serviceCode: service.code,
                      serviceName: service.name, stationId: null, stationCode: null, billingUnit: proposedBillingUnit(service.defaultBillingUnit, units),
                      unitPrice: 0, minimumBillableQuantity: 0 }]);
                  }} className={fieldClass}>
                    <option value="">Seleccione…</option>
                    {missingServices.map(service => <option key={service.id} value={service.id}>{service.code} · {service.name}</option>)}
                  </select>
                </label>
              )}
              {draftActions && (
                <div className="flex flex-wrap justify-end gap-2">
                  {perms.delete && <button type="button" disabled={busy} onClick={() => setConfirm('delete')} className="rounded-lg border border-status-danger/40 px-4 py-2 text-sm font-semibold text-status-danger">Descartar borrador</button>}
                  {perms.update && <button type="button" disabled={busy} onClick={save} className="rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600">Guardar</button>}
                  {perms.publish && <button type="button" disabled={busy || rates.length === 0} onClick={() => setConfirm('publish')} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Publicar</button>}
                </div>
              )}
            </section>
          )}
        </div>
      )}
      <ConfirmDialog open={confirm === 'publish'} title="Publicar tarifa base"
        description={`La versión pasará a ser la vigente en ${detail?.summary.currencyCode ?? ''} desde ${meta.validFrom}; la anterior quedará como histórica. Guarde antes los cambios pendientes.`}
        confirmLabel="Publicar" onClose={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await publish(); }} />
      <ConfirmDialog open={confirm === 'delete'} title="Descartar borrador" description="El borrador y sus precios se eliminarán."
        confirmLabel="Descartar" onClose={() => setConfirm(null)}
        onConfirm={async () => { setConfirm(null); await run(() => deleteServiceTariffDraft(detail.summary.id, detail.summary.version), 'Borrador descartado.'); }} />
    </div>
  );
}

export default function ServiceTariffsPage({ initialStationId }) {
  const [tab, setTab] = useState('base');
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Finanzas" title="Tarifario de servicios"
        description="Tarifa base de Finanzas por moneda y las tarifas negociadas en cada contrato." />
      <Tabs activeId={tab} onChange={setTab} tabs={[{ id: 'base', label: 'Tarifa base' }, { id: 'contracts', label: 'Tarifas por contrato' }]} />
      {tab === 'base' ? <BaseTariff /> : <TariffsPage initialStationId={initialStationId} embedded />}
    </div>
  );
}
