'use client';

import { useEffect, useState } from 'react';
import { useOptionalDepartmentAccess } from '../../access/DepartmentAccessContext';
import { formatMoney } from '../../../services/financeBookService';
import {
  createPackageCommand, financePackageError, listContractPackages, listFinancePackages, setContractPackages,
} from '../../../services/financePackagesService';

const scopeNames = { Turnaround: 'Rotación', Flight: 'Vuelo', Period: 'Período' };
const statuses = { Draft: 'Borrador', Published: 'Publicada', Superseded: 'Histórica' };
const buttonClass = 'rounded-lg border border-black/15 px-3 py-2 text-xs font-semibold disabled:opacity-50 dark:border-white/15';

// DateOnly values arrive as ISO dates: compare calendar days without timezone conversion.
function eligiblePackages(catalog, draft) {
  if (!draft.validFrom) return [];
  const effective = new Map();
  for (const item of catalog) {
    if (!['Published', 'Superseded'].includes(item.status) ||
        item.currencyCode !== draft.currencyCode || item.validFrom > draft.validFrom) continue;
    const previous = effective.get(item.code);
    if (!previous || item.validFrom > previous.validFrom ||
        (item.validFrom === previous.validFrom && item.versionNumber > previous.versionNumber))
      effective.set(item.code, item);
  }
  // Check coverage after selecting the effective version; an expired replacement must not revive an older one.
  return [...effective.values()].filter(item => !item.validTo || (draft.validTo && item.validTo >= draft.validTo));
}

function PackageDefinition({ item }) {
  return <div className="min-w-0 text-xs">
    <strong className="block break-words text-sm">{item.code} · v{item.versionNumber} · {item.name}</strong>
    <p className="mt-1">{statuses[item.status] ?? item.status} · {formatMoney(item.basePrice, item.currencyCode)} · {scopeNames[item.scope] ?? item.scope}
      {item.scope === 'Flight' && ` · ${item.flightDirection === 'Arrival' ? 'Llegada' : 'Salida'}`}
      {item.scope === 'Period' && ` · ${item.periodDays} días`}</p>
    <p className="mt-1 text-text-secondary-light">Desde {item.validFrom}{item.validTo ? ` hasta ${item.validTo}` : ' · sin fecha final'}</p>
    <ul className="mt-2 space-y-1 text-text-secondary-light dark:text-text-secondary-dark">
      {item.components.map(component => <li key={component.serviceId} className="break-words">
        {component.serviceCode} · {component.serviceName}: incluye {component.includedQuantity} {component.billingUnit}; excedente de {component.excessBlockSize} por {formatMoney(component.excessBlockPrice, item.currencyCode)}.
      </li>)}
    </ul>
  </div>;
}

export default function ContractPackagesPanel({ draft, canEdit = true, disabled = false, onSaved, onBusyChange, onDirtyChange }) {
  const access = useOptionalDepartmentAccess();
  const editable = canEdit && (access?.can('contracts.drafts.update') ?? canEdit) && (draft.versionStatus ?? 'Draft') === 'Draft';
  const [state, setState] = useState({ status: 'loading', bound: [], catalog: [], error: '', catalogError: '' });
  const [selectedIds, setSelectedIds] = useState([]);
  const [reload, setReload] = useState(0);
  const [busy, setBusy] = useState(false);
  const [awaitingVersion, setAwaitingVersion] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [command] = useState(createPackageCommand);

  useEffect(() => {
    let active = true;
    setState(current => ({ ...current, status: 'loading' }));
    setAwaitingVersion(false); setError('');
    onDirtyChange?.(false);
    Promise.allSettled([listContractPackages(draft.id), editable ? listFinancePackages() : Promise.resolve([])])
      .then(([bound, catalog]) => {
        if (!active) return;
        setState({ status: bound.status === 'fulfilled' ? 'ready' : 'error',
          bound: bound.status === 'fulfilled' ? bound.value : [], catalog: catalog.status === 'fulfilled' ? catalog.value : [],
          error: bound.status === 'rejected' ? financePackageError(bound.reason) : '',
          catalogError: catalog.status === 'rejected' ? financePackageError(catalog.reason) : '' });
        setSelectedIds(bound.status === 'fulfilled' ? bound.value.map(item => item.id) : []);
      });
    return () => { active = false; };
  }, [draft.id, draft.version, draft.currencyCode, draft.validFrom, draft.validTo, editable, reload, onDirtyChange]);

  const available = eligiblePackages(state.catalog, draft);
  const choices = [...state.bound, ...available.filter(item => !state.bound.some(bound => bound.id === item.id))];
  const dirty = selectedIds.length !== state.bound.length || selectedIds.some(id => !state.bound.some(item => item.id === id));
  const hasIneligible = selectedIds.some(id => !available.some(item => item.id === id));
  const locked = disabled || busy || awaitingVersion || !draft.version;

  function toggle(id, checked) {
    const next = checked ? [...selectedIds, id] : selectedIds.filter(value => value !== id);
    setSelectedIds(next); setError(''); setNotice('');
    onDirtyChange?.(next.length !== state.bound.length || next.some(value => !state.bound.some(item => item.id === value)));
  }

  async function save() {
    if (!editable || locked || !dirty || hasIneligible || state.status !== 'ready' || state.catalogError) return;
    setBusy(true); onBusyChange?.(true); setError(''); setNotice('');
    try {
      await command(`bind:${draft.id}`, { expectedVersion: draft.version, packageVersionIds: [...selectedIds].sort() }, body => setContractPackages(draft.id, body));
      setAwaitingVersion(true);
      setState(current => ({ ...current, bound: choices.filter(item => selectedIds.includes(item.id)) }));
      onDirtyChange?.(false);
      setNotice('Paquetes guardados.');
      try { await onSaved?.(); }
      catch { setError('Los paquetes se guardaron. Actualice el borrador para obtener su versión vigente antes de continuar.'); }
    } catch (failure) { setError(financePackageError(failure)); }
    finally { setBusy(false); onBusyChange?.(false); }
  }

  return <section aria-label="Paquetes del contrato" className="mt-5 space-y-3 border-t border-black/10 pt-4 dark:border-white/10">
    <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-sm font-bold">Paquetes del contrato</h3>
      <p className="mt-1 text-xs text-text-secondary-light">Definidos por Finanzas en {draft.currencyCode}. Precio y cobertura se conservan por versión.</p></div>
      <button type="button" disabled={busy || disabled || awaitingVersion} onClick={() => setReload(value => value + 1)} className={buttonClass}>Actualizar paquetes</button></div>
    {state.status === 'loading' ? <p role="status" className="text-xs">Cargando paquetes del contrato…</p>
      : state.status === 'error' ? <p role="alert" className="text-xs text-status-danger">{state.error}</p>
        : <>
          {state.bound.length === 0 && <p className="text-xs text-text-secondary-light">Este contrato no tiene paquetes seleccionados.</p>}
          {state.catalogError && <p role="alert" className="text-xs text-status-danger">{state.catalogError}</p>}
          {editable && <p className="text-xs text-text-secondary-light">Seleccione la versión vigente al inicio y con cobertura durante todo el contrato. Cada servicio puede estar cubierto por un solo paquete.</p>}
          {choices.map(item => <div key={item.id} role="group" aria-label={`Paquete ${item.code} v${item.versionNumber}`} className="flex items-start gap-3 rounded-lg border border-black/10 p-3 dark:border-white/10">
            {editable && <input type="checkbox" aria-label={`Seleccionar ${item.code} v${item.versionNumber}`} checked={selectedIds.includes(item.id)}
              disabled={locked || Boolean(state.catalogError) || (!selectedIds.includes(item.id) && !available.some(candidate => candidate.id === item.id))}
              onChange={event => toggle(item.id, event.target.checked)} className="mt-1 shrink-0" />}
            <PackageDefinition item={item} />
          </div>)}
          {editable && available.length === 0 && !state.catalogError && <p className="text-xs text-text-secondary-light">No hay paquetes en {draft.currencyCode} elegibles para la vigencia del contrato.</p>}
          {editable && !state.catalogError && hasIneligible && <p role="alert" className="text-xs text-status-danger">Un paquete seleccionado ya no es elegible. Quite esa selección y elija una versión vigente en la moneda del contrato antes de guardar.</p>}
          {editable && disabled && <p className="text-xs text-text-secondary-light">Guarde primero los cambios del borrador para seleccionar paquetes.</p>}
          {editable && !draft.version && <p role="alert" className="text-xs text-status-danger">Actualice el borrador para obtener su versión vigente.</p>}
          {editable && <button type="button" disabled={locked || !dirty || hasIneligible || Boolean(state.catalogError)} onClick={() => void save()} className={`${buttonClass} border-accent-600 text-accent-600`}>Guardar paquetes</button>}
        </>}
    {notice && <p role="status" className="text-xs text-status-success">{notice}</p>}
    {error && <p role="alert" className="text-xs text-status-danger">{error}</p>}
  </section>;
}
