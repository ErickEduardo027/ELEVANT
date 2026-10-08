import { useEffect, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import Drawer from '../../components/Drawer';
import EmptyState from '../../components/EmptyState';
import { ShieldCheckIcon } from '../shell/components/icons';
import { deactivateAccessProfile, saveAccessProfile } from '../../services/departmentGovernanceService';
import PermissionMatrix, { permissionLabels } from './PermissionMatrix';

const inputClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function ProfileDrawer({ open, department, profile, catalog, onClose, onSaved }) {
  const [form, setForm] = useState({ name: '', description: '', permissionCodes: [] });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!open) return;
    setForm({ name: profile?.name ?? '', description: profile?.description ?? '', permissionCodes: profile?.permissions ?? [] });
    setError('');
  }, [open, profile]);

  async function submit(event) {
    event.preventDefault();
    if (form.permissionCodes.length === 0) { setError('Seleccione al menos un permiso.'); return; }
    setBusy(true);
    setError('');
    try {
      await saveAccessProfile(department, profile?.id, {
        name: form.name.trim(), description: form.description.trim() || null,
        permissionCodes: form.permissionCodes, expectedVersion: profile?.version ?? null,
      });
      onSaved(profile ? 'Plantilla actualizada. Sus usuarios recibirán los nuevos permisos al volver a ingresar.' : 'Plantilla creada.');
    } catch (failure) {
      setError(failure.status === 409 ? 'Ya existe una plantilla activa con ese nombre o la plantilla cambió. Actualice la lista.' : failure.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={profile ? 'Editar plantilla' : 'Nueva plantilla de rol'}
      description="Los usuarios que usan la plantilla heredan sus permisos en vivo." widthClassName="lg:w-[560px]"
      footer={<div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Cancelar</button>
        <button type="submit" form="access-profile-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar plantilla'}</button>
      </div>}>
      {open && (
        <form id="access-profile-form" onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          <label className="block text-xs font-semibold">Nombre<input required minLength={3} maxLength={80} value={form.name} onChange={event => setForm(current => ({ ...current, name: event.target.value }))} className={inputClass} /></label>
          <label className="block text-xs font-semibold">Descripción<textarea maxLength={400} rows={2} value={form.description} onChange={event => setForm(current => ({ ...current, description: event.target.value }))} className={inputClass} /></label>
          <PermissionMatrix catalog={catalog} value={form.permissionCodes} onChange={permissionCodes => setForm(current => ({ ...current, permissionCodes }))} idPrefix="profile" />
        </form>
      )}
    </Drawer>
  );
}

export default function ProfilesPanel({ department, profiles, catalog, onChanged }) {
  const [editing, setEditing] = useState(null);
  const [open, setOpen] = useState(false);
  const [retiring, setRetiring] = useState(null);
  const [error, setError] = useState('');

  async function retire() {
    const profile = retiring;
    setRetiring(null);
    try {
      await deactivateAccessProfile(department, profile.id, profile.version);
      onChanged('Plantilla desactivada. Sus usuarios conservan la cuenta pero pierden esos permisos.');
    } catch (failure) {
      setError(failure.status === 409 ? 'La plantilla cambió o tiene solicitudes pendientes. Actualice la lista.' : failure.message);
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">Combine módulos y acciones del departamento en plantillas reutilizables.</p>
        <button type="button" onClick={() => { setEditing(null); setOpen(true); }} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nueva plantilla</button>
      </div>
      {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {profiles.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="Sin plantillas" description="Cree una plantilla para asignar el mismo conjunto de permisos a varios usuarios." />
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 2xl:grid-cols-3">
          {profiles.map(profile => (
            <article key={profile.id} className={`rounded-xl border p-4 ${profile.isActive ? 'border-black/10 bg-white dark:border-white/10 dark:bg-surface-dark-card' : 'border-dashed border-black/10 opacity-70 dark:border-white/10'}`}>
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <h3 className="truncate font-semibold">{profile.name}</h3>
                  <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{profile.members} usuario(s){profile.isActive ? '' : ' · Inactiva'}</p>
                </div>
                {profile.isActive && (
                  <div className="flex shrink-0 gap-3 text-xs font-semibold">
                    <button type="button" onClick={() => { setEditing(profile); setOpen(true); }} className="text-accent-600">Editar</button>
                    <button type="button" onClick={() => setRetiring(profile)} className="text-status-danger">Desactivar</button>
                  </div>
                )}
              </div>
              {profile.description && <p className="mt-2 text-sm">{profile.description}</p>}
              <ul className="mt-3 space-y-1 text-xs text-text-secondary-light dark:text-text-secondary-dark">
                {permissionLabels(catalog, profile.permissions).map(label => <li key={label}>{label}</li>)}
              </ul>
            </article>
          ))}
        </div>
      )}
      <ProfileDrawer open={open} department={department} profile={editing} catalog={catalog}
        onClose={() => setOpen(false)} onSaved={message => { setOpen(false); onChanged(message); }} />
      <ConfirmDialog open={Boolean(retiring)} title="Desactivar plantilla"
        description={`Los ${retiring?.members ?? 0} usuario(s) de «${retiring?.name ?? ''}» perderán estos permisos hasta que se les asigne otros.`}
        confirmLabel="Desactivar" onClose={() => setRetiring(null)} onConfirm={retire} />
    </section>
  );
}
