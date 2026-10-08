import { useEffect, useRef, useState } from 'react';
import Drawer from '../../components/Drawer';
import FileDropField from '../../components/FileDropField';
import PasswordField from '../../components/PasswordField';
import PrivateMediaImage from '../../components/PrivateMediaImage';
import { uploadCommercialMedia } from '../../services/commercialGovernanceApi';
import {
  createDepartmentAdministrator,
  createDepartmentUser,
  DEPARTMENTS,
  requestDepartmentUserAccess,
  updateDepartmentUser,
} from '../../services/departmentGovernanceService';
import PermissionMatrix from './PermissionMatrix';
import { newRequestId, PASSWORD_HINT, PASSWORD_PATTERN } from './useDepartmentGovernance';

const inputClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const labelClass = 'block text-xs font-semibold text-ink-900 dark:text-text-primary-dark';

const TITLES = {
  request: 'Solicitar alta de usuario',
  member: 'Crear sub-usuario',
  administrator: 'Crear administrador',
  edit: 'Editar usuario',
};

const DESCRIPTIONS = {
  request: 'Gestión Humana validará la solicitud y definirá la contraseña temporal.',
  member: 'La cuenta queda activa al instante; entregue la contraseña temporal por un canal autorizado.',
  administrator: 'El administrador tendrá todos los módulos del departamento y podrá solicitar sub-usuarios.',
  edit: 'Los cambios de permisos, estaciones o datos no requieren nueva validación.',
};

function blank(user) {
  return {
    kind: 'BackOfficeUser',
    firstName: user?.firstName ?? '',
    lastName: user?.lastName ?? '',
    email: user?.email ?? '',
    temporaryPassword: '',
    stationIds: user?.stations?.map(station => station.id) ?? [],
    grantMode: user && !user.accessProfileId ? 'custom' : 'profile',
    accessProfileId: user?.accessProfileId ?? '',
    permissionCodes: user && !user.accessProfileId ? user.permissions : [],
    employeeNumber: '',
    category: '',
    hireDate: '',
    terminalIds: [],
    supervisorRampAgentId: '',
    avatarMediaUrl: user?.avatarMediaUrl ?? null,
  };
}

/**
 * Account form used by department administrators (to request accounts) and by
 * the super administrator (to create administrators or members directly, and to
 * edit any user). Ramp agents can only be requested by Operations.
 */
export default function AccountFormDrawer({ open, mode, department, user, profiles, options, catalog, onClose, onSaved }) {
  const [form, setForm] = useState(() => blank(user));
  const [avatar, setAvatar] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const requestId = useRef(newRequestId());

  useEffect(() => {
    if (!open) return;
    setForm(blank(user));
    setAvatar(null);
    setError('');
    requestId.current = newRequestId();
  }, [open, user]);

  const isEdit = mode === 'edit';
  const isRamp = form.kind === 'RampAgent';
  const isAdministrator = mode === 'administrator' || user?.kind === 'Administrator';
  const editsGrants = !isAdministrator && !isRamp && user?.kind !== 'RampAgent';
  const activeProfiles = (profiles ?? []).filter(profile => profile.isActive);
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const toggle = (key, id) => set({
    [key]: form[key].includes(id) ? form[key].filter(item => item !== id) : [...form[key], id],
  });

  async function submit(event) {
    event.preventDefault();
    setError('');
    if (form.stationIds.length === 0) { setError('Seleccione al menos una estación.'); return; }
    if (editsGrants && form.grantMode === 'profile' && !form.accessProfileId) { setError('Seleccione una plantilla.'); return; }
    if (editsGrants && form.grantMode === 'custom' && form.permissionCodes.length === 0) { setError('Seleccione al menos un permiso.'); return; }
    setBusy(true);
    try {
      const avatarMediaUrl = avatar ? (await uploadCommercialMedia('avatar', avatar)).url : form.avatarMediaUrl;
      const grants = editsGrants
        ? form.grantMode === 'profile'
          ? { accessProfileId: form.accessProfileId, permissionCodes: null }
          : { accessProfileId: null, permissionCodes: form.permissionCodes }
        : { accessProfileId: null, permissionCodes: null };
      const person = { firstName: form.firstName.trim(), lastName: form.lastName.trim(), email: form.email.trim(),
        stationIds: form.stationIds, avatarMediaUrl };
      if (isEdit) {
        await updateDepartmentUser(department, user.id, { ...person, ...grants, expectedVersion: user.version });
      } else if (mode === 'request') {
        await requestDepartmentUserAccess(department, {
          ...person, ...(isRamp ? { accessProfileId: null, permissionCodes: null } : grants),
          requestId: requestId.current, kind: form.kind,
          ...(isRamp ? {
            employeeNumber: form.employeeNumber.trim(), category: form.category.trim(), hireDate: form.hireDate,
            terminalIds: form.terminalIds, supervisorRampAgentId: form.supervisorRampAgentId || null,
          } : {}),
        });
      } else {
        const create = mode === 'administrator' ? createDepartmentAdministrator : createDepartmentUser;
        await create(department, { ...person, ...grants, temporaryPassword: form.temporaryPassword });
      }
      onSaved(mode);
    } catch (failure) {
      setError(failure.status === 409
        ? 'El usuario cambió o el correo ya está en uso. Actualice la lista e inténtelo de nuevo.'
        : failure.message);
    } finally {
      setBusy(false);
    }
  }

  const terminals = (options?.terminals ?? []).filter(terminal => form.stationIds.includes(terminal.stationId));

  return (
    <Drawer open={open} onClose={onClose} title={TITLES[mode] ?? ''} description={DESCRIPTIONS[mode]} widthClassName="lg:w-[560px]"
      footer={<div className="flex flex-wrap justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border border-black/10 px-4 py-2 text-sm dark:border-white/10">Cancelar</button>
        <button type="submit" form="department-account-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">
          {busy ? 'Guardando…' : mode === 'request' ? 'Enviar a Gestión Humana' : 'Guardar'}
        </button>
      </div>}>
      {open && (
        <form id="department-account-form" onSubmit={submit} className="space-y-4">
          {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          {mode === 'request' && department === DEPARTMENTS.OPERATIONS && (
            <fieldset>
              <legend className={labelClass}>Tipo de usuario</legend>
              <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[['BackOfficeUser', 'Usuario web del OCC'], ['RampAgent', 'Agente de rampa (app móvil)']].map(([value, label]) => (
                  <label key={value} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${form.kind === value ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}`}>
                    <input type="radio" name="kind" value={value} checked={form.kind === value} onChange={() => set({ kind: value })} />
                    {label}
                  </label>
                ))}
              </div>
            </fieldset>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className={labelClass}>Nombre<input required minLength={2} maxLength={100} value={form.firstName} onChange={event => set({ firstName: event.target.value })} className={inputClass} /></label>
            <label className={labelClass}>Apellido<input required minLength={2} maxLength={100} value={form.lastName} onChange={event => set({ lastName: event.target.value })} className={inputClass} /></label>
          </div>
          <label className={labelClass}>Correo de acceso<input required type="email" maxLength={256} value={form.email} onChange={event => set({ email: event.target.value })} className={inputClass} /></label>
          {(mode === 'member' || mode === 'administrator') && (
            <PasswordField fieldClassName={labelClass} inputClassName={inputClass} label="Contraseña temporal" id="department-account-password"
              required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password"
              value={form.temporaryPassword} onChange={event => set({ temporaryPassword: event.target.value })} />
          )}
          <fieldset>
            <legend className={labelClass}>Estaciones</legend>
            <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">Solo puede conceder estaciones que usted tiene asignadas.</p>
            <div className="mt-2 flex flex-wrap gap-2">
              {(options?.stations ?? []).map(station => (
                <label key={station.id} className={`flex min-h-[40px] items-center gap-2 rounded-lg border px-3 text-sm ${form.stationIds.includes(station.id) ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}`}>
                  <input type="checkbox" checked={form.stationIds.includes(station.id)} onChange={() => toggle('stationIds', station.id)} />
                  {station.code}
                </label>
              ))}
              {options && options.stations.length === 0 && <p className="text-sm text-status-danger">No tiene estaciones asignadas para conceder.</p>}
            </div>
          </fieldset>
          {isRamp && (
            <div className="space-y-3 rounded-xl border border-black/10 p-3 dark:border-white/10">
              <p className="text-sm font-semibold">Perfil operativo del agente</p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <label className={labelClass}>Número de empleado<input required minLength={2} maxLength={32} value={form.employeeNumber} onChange={event => set({ employeeNumber: event.target.value })} className={inputClass} /></label>
                <label className={labelClass}>Categoría<input required minLength={2} maxLength={64} value={form.category} onChange={event => set({ category: event.target.value })} className={inputClass} /></label>
                <label className={labelClass}>Fecha de ingreso<input required type="date" max={new Date().toISOString().slice(0, 10)} value={form.hireDate} onChange={event => set({ hireDate: event.target.value })} className={inputClass} /></label>
                <label className={labelClass}>Supervisor<select value={form.supervisorRampAgentId} onChange={event => set({ supervisorRampAgentId: event.target.value })} className={inputClass}>
                  <option value="">Sin supervisor</option>
                  {(options?.supervisors ?? []).map(supervisor => <option key={supervisor.id} value={supervisor.id}>{supervisor.name} · {supervisor.employeeNumber}</option>)}
                </select></label>
              </div>
              <fieldset>
                <legend className={labelClass}>Terminales</legend>
                <div className="mt-2 flex flex-wrap gap-2">
                  {terminals.map(terminal => (
                    <label key={terminal.id} className="flex min-h-[40px] items-center gap-2 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10">
                      <input type="checkbox" checked={form.terminalIds.includes(terminal.id)} onChange={() => toggle('terminalIds', terminal.id)} />
                      Terminal {terminal.code}
                    </label>
                  ))}
                  {terminals.length === 0 && <p className="text-xs text-text-secondary-light">Seleccione una estación para ver sus terminales.</p>}
                </div>
              </fieldset>
            </div>
          )}
          {editsGrants && !isRamp && (
            <fieldset className="space-y-3">
              <legend className={labelClass}>Permisos</legend>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {[['profile', 'Usar una plantilla'], ['custom', 'Permisos personalizados']].map(([value, label]) => (
                  <label key={value} className={`flex min-h-[44px] items-center gap-2 rounded-lg border px-3 text-sm ${form.grantMode === value ? 'border-accent-600 bg-accent-600/5' : 'border-black/10 dark:border-white/10'}`}>
                    <input type="radio" name="grantMode" value={value} checked={form.grantMode === value} onChange={() => set({ grantMode: value })} />
                    {label}
                  </label>
                ))}
              </div>
              {form.grantMode === 'profile' ? (
                <label className={labelClass}>Plantilla<select value={form.accessProfileId} onChange={event => set({ accessProfileId: event.target.value })} className={inputClass}>
                  <option value="">Seleccione una plantilla</option>
                  {activeProfiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select>
                {activeProfiles.length === 0 && <span className="mt-1 block font-normal text-text-secondary-light">Aún no hay plantillas; cree una en la pestaña Plantillas o use permisos personalizados.</span>}
                </label>
              ) : (
                <PermissionMatrix catalog={catalog} value={form.permissionCodes} onChange={permissionCodes => set({ permissionCodes })} idPrefix="account" />
              )}
            </fieldset>
          )}
          <div>
            {form.avatarMediaUrl && !avatar && <PrivateMediaImage url={form.avatarMediaUrl} alt="Foto actual" className="mb-2 h-16 w-16 rounded-full object-cover" />}
            <FileDropField label="Foto de perfil (opcional)" accept="image/png,image/jpeg,image/webp" file={avatar} onFile={setAvatar} hint="PNG, JPG o WebP de hasta 8 MB." />
          </div>
        </form>
      )}
    </Drawer>
  );
}
