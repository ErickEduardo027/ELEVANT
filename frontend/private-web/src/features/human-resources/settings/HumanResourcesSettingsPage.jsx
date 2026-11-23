import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../../components/EmptyState';
import Modal from '../../../components/Modal';
import PageHeader from '../../../components/PageHeader';
import StackedTable from '../../../components/StackedTable';
import { ShieldCheckIcon } from '../../shell/components/icons';
import LoadFailure, { loadFailure } from '../../finance/components/LoadFailure';
import { createCommandKeyHolder } from '../../../services/commandKeys';
import {
  listEquipmentTypes, listPermitTypes, saveEquipmentType, savePermitType, settingsMessage,
} from '../../../services/humanResourcesSettingsService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const CODE_PATTERN = '[A-Za-z0-9][A-Za-z0-9\\-]{1,31}';
const EQUIPMENT_CODE_PATTERN = '[A-Za-z0-9][A-Za-z0-9\\-]{1,39}';
/** What a code outside its pattern says under the field (the server's rule of each catalog). */
export const PERMIT_CODE_ERROR = 'Usa de 2 a 32 letras, dígitos o guiones, empezando por letra o dígito; p. ej. ZONA-RESTRINGIDA.';
export const EQUIPMENT_CODE_ERROR = 'Usa de 2 a 40 letras, dígitos o guiones, empezando por letra o dígito; p. ej. TUG.';

export const SETTINGS_TABS = [
  { id: 'permits', label: 'Carnets y permisos' },
  { id: 'equipment', label: 'Equipos de habilitación' },
];

/**
 * «Gestión Humana › Configuración» (ADR-0045): the permit types Gestión Humana records (the two of the system and the
 * ones it adds) and the equipment types of the qualifications. Nothing is deleted: a type is deactivated.
 */
export default function HumanResourcesSettingsPage() {
  const [tab, setTab] = useState('permits');
  return (
    <div className="mx-auto max-w-[1100px] space-y-5">
      <PageHeader eyebrow="Gestión Humana" title="Configuración"
        description="Los tipos de carnet y permiso que se registran a los agentes y los equipos de las habilitaciones." />
      <div role="tablist" aria-label="Configuración" className="flex flex-wrap gap-2">
        {SETTINGS_TABS.map(item => (
          <button key={item.id} type="button" role="tab" aria-selected={tab === item.id} onClick={() => setTab(item.id)}
            className={`rounded-lg px-4 py-2 text-sm font-semibold ${tab === item.id
              ? 'bg-accent-600 text-white' : 'border border-black/10 dark:border-white/10'}`}>{item.label}</button>
        ))}
      </div>
      <div role="tabpanel" aria-label={SETTINGS_TABS.find(item => item.id === tab).label}>
        {tab === 'permits' ? <PermitTypesTab /> : <EquipmentTypesTab />}
      </div>
    </div>
  );
}

/** The list of a tab: loading, failure (with «Reintentar» unless forbidden) and the loaded data. */
function useSettingsList(read, failureText) {
  const [data, setData] = useState(null);
  const [failure, setFailure] = useState(null);
  const load = useCallback(async () => {
    try { setData(await read()); setFailure(null); }
    catch (error) {
      setData(null);
      setFailure(loadFailure(error, settingsMessage(error, failureText)));
    }
  }, [read, failureText]);
  useEffect(() => { void load(); }, [load]);
  return { data, failure, load };
}

function PermitTypesTab() {
  const { data, failure, load } = useSettingsList(listPermitTypes,
    'No se pudieron cargar los tipos de carnet. Revisa la conexión e inténtalo de nuevo.');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const keys = useRef(createCommandKeyHolder());

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const id = form.id ?? null;
    const values = {
      code: form.code.trim().toUpperCase(), name: form.name.trim(), description: form.description?.trim() || null,
      ...(id ? { isActive: form.isActive, expectedVersion: form.version } : {}),
    };
    try {
      await keys.current.run('save-permit-type', { id, ...values }, key => savePermitType(id, values, key));
      setNotice(id ? `Tipo «${values.name}» actualizado.` : `Tipo «${values.name}» creado.`);
      setForm(null);
      await load();
    } catch (failure) {
      setError(settingsMessage(failure, 'No se pudo confirmar el guardado. Reintenta con los mismos datos.'));
      if (failure?.status === 409) await load();
    } finally { setBusy(false); }
  }

  const types = data?.permitTypes ?? [];
  return (
    <section className="space-y-4" aria-label="Carnets y permisos">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary-light">Un tipo nuevo solo cuenta donde una posición lo exige (OCC › Datos maestros).</p>
        {data?.canCreate && <button type="button" onClick={() => { setNotice(''); setError('');
          setForm({ code: '', name: '', description: '', isActive: true }); }}
        className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo tipo de carnet</button>}
      </div>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && !form && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      <LoadFailure failure={failure} onRetry={() => { void load(); }} />
      {!data ? (failure ? null : <p role="status" className="text-sm">Cargando tipos de carnet…</p>) : types.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="Sin tipos de carnet" description="Crea el primer tipo de carnet o permiso." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[640px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
              <tr><th className="p-3">Nombre</th><th className="p-3">Código</th><th className="p-3">Origen</th>
                <th className="p-3">Estado</th>{data.canUpdate && <th className="p-3">Acción</th>}</tr>
            </thead>
            <tbody>{types.map(type => (
              <tr key={type.code} className={`border-t border-black/5 dark:border-white/5 ${type.isActive ? '' : 'opacity-60'}`}>
                <td className="p-3 font-semibold">{type.name}
                  {type.description && <span className="block text-xs font-normal text-text-secondary-light">{type.description}</span>}</td>
                <td className="p-3 font-mono text-xs">{type.code}</td>
                <td className="p-3 text-xs">{type.isSystem ? 'Del sistema' : 'Personalizado'}{type.inUse && !type.isSystem ? ' · En uso' : ''}</td>
                <td className="p-3 text-xs">{type.isActive ? 'Activo' : 'Inactivo'}</td>
                {data.canUpdate && <td className="p-3">{type.isSystem ? <span className="text-xs text-text-secondary-light">No editable</span>
                  : <button type="button" onClick={() => { setNotice(''); setError(''); setForm({ ...type, description: type.description ?? '' }); }}
                    className="min-h-[32px] text-xs font-semibold text-accent-600">Editar</button>}</td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? `Editar «${form.name}»` : 'Nuevo tipo de carnet'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="permit-type-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button></div>}>
        {form && (
          <form id="permit-type-form" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            <label className="block text-xs font-semibold">Nombre<input required minLength={2} maxLength={160} value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))}
              placeholder="Carnet de zona restringida" className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Código<input required pattern={CODE_PATTERN} maxLength={32} data-error={PERMIT_CODE_ERROR}
              disabled={Boolean(form.id && form.inUse)} value={form.code}
              onChange={event => setForm(current => ({ ...current, code: event.target.value.toUpperCase() }))}
              placeholder="ZONA-RESTRINGIDA" className={fieldClass} />
              <span className="mt-1 block font-normal text-text-secondary-light">2 a 32 letras, dígitos o guiones.{form.id && form.inUse ? ' En uso: el código no cambia.' : ''}</span></label>
            <label className="block text-xs font-semibold">Descripción (opcional)<textarea maxLength={500} rows={2} value={form.description}
              onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className={fieldClass} /></label>
            {form.id && <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive}
              onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Activo (se pueden registrar ciclos nuevos)</label>}
          </form>
        )}
      </Modal>
    </section>
  );
}

function EquipmentTypesTab() {
  const { data, failure, load } = useSettingsList(listEquipmentTypes,
    'No se pudieron cargar los equipos de habilitación. Revisa la conexión e inténtalo de nuevo.');
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const keys = useRef(createCommandKeyHolder());

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const id = form.id ?? null;
    const values = {
      code: form.code.trim().toUpperCase(), name: form.name.trim(), requiresQualification: form.requiresQualification,
      ...(id ? { isActive: form.isActive, expectedVersion: form.version } : {}),
    };
    try {
      await keys.current.run('save-equipment-type', { id, ...values }, key => saveEquipmentType(id, values, key));
      setNotice(id ? `Equipo «${values.name}» actualizado.` : `Equipo «${values.name}» creado.`);
      setForm(null);
      await load();
    } catch (failure) {
      setError(settingsMessage(failure, 'No se pudo confirmar el guardado. Reintenta con los mismos datos.'));
      if (failure?.status === 409) await load();
    } finally { setBusy(false); }
  }

  const types = data?.equipmentTypes ?? [];
  return (
    <section className="space-y-4" aria-label="Equipos de habilitación">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-text-secondary-light">Los equipos que se habilitan en «Habilitaciones y certificaciones».</p>
        {data?.canCreate && <button type="button" onClick={() => { setNotice(''); setError('');
          setForm({ code: '', name: '', requiresQualification: true, isActive: true }); }}
        className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo equipo</button>}
      </div>
      {notice && <p role="status" className="rounded-lg bg-status-success/10 p-3 text-sm">{notice}</p>}
      {error && !form && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      <LoadFailure failure={failure} onRetry={() => { void load(); }} />
      {!data ? (failure ? null : <p role="status" className="text-sm">Cargando equipos…</p>) : types.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="Sin equipos de habilitación" description="Crea el primer equipo." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[640px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
              <tr><th className="p-3">Nombre</th><th className="p-3">Código</th><th className="p-3">Habilitación</th>
                <th className="p-3">Estado</th>{data.canUpdate && <th className="p-3">Acción</th>}</tr>
            </thead>
            <tbody>{types.map(type => (
              <tr key={type.id} className={`border-t border-black/5 dark:border-white/5 ${type.isActive ? '' : 'opacity-60'}`}>
                <td className="p-3 font-semibold">{type.name}</td>
                <td className="p-3 font-mono text-xs">{type.code}{type.isLocked ? ' · Del sistema' : ''}</td>
                <td className="p-3 text-xs">{type.requiresQualification ? 'Requiere habilitación' : 'Sin habilitación'}</td>
                <td className="p-3 text-xs">{type.isActive ? 'Activo' : 'Inactivo'}</td>
                {data.canUpdate && <td className="p-3"><button type="button" onClick={() => { setNotice(''); setError(''); setForm({ ...type }); }}
                  className="min-h-[32px] text-xs font-semibold text-accent-600">Editar</button></td>}
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title={form?.id ? `Editar «${form.name}»` : 'Nuevo equipo de habilitación'}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="equipment-type-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Guardando…' : 'Guardar'}</button></div>}>
        {form && (
          <form id="equipment-type-form" onSubmit={submit} className="space-y-3">
            {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
            <label className="block text-xs font-semibold">Nombre<input required minLength={2} maxLength={160} value={form.name}
              onChange={event => setForm(current => ({ ...current, name: event.target.value }))} placeholder="Tractor de remolque" className={fieldClass} /></label>
            <label className="block text-xs font-semibold">Código<input required pattern={EQUIPMENT_CODE_PATTERN} maxLength={40} data-error={EQUIPMENT_CODE_ERROR}
              disabled={Boolean(form.id && (form.inUse || form.isLocked))} value={form.code}
              onChange={event => setForm(current => ({ ...current, code: event.target.value.toUpperCase() }))} placeholder="TUG" className={fieldClass} />
              {form.id && (form.inUse || form.isLocked) && <span className="mt-1 block font-normal text-text-secondary-light">
                {form.isLocked ? 'Lo usa una regla del sistema: el código no cambia y sigue activo.' : 'En uso: el código no cambia.'}</span>}</label>
            <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={form.requiresQualification}
              onChange={event => setForm(current => ({ ...current, requiresQualification: event.target.checked }))} />Requiere habilitación vigente</label>
            {form.id && <label className="flex min-h-[40px] items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive}
              disabled={form.isLocked} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} />Activo</label>}
          </form>
        )}
      </Modal>
    </section>
  );
}
