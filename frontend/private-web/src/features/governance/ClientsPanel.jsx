import { useCallback, useEffect, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import Drawer from '../../components/Drawer';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import PasswordField from '../../components/PasswordField';
import StackedTable from '../../components/StackedTable';
import StatusBadge from '../../components/StatusBadge';
import { ChevronDownIcon, PlaneIcon } from '../shell/components/icons';
import {
  createClientUser,
  listClientAirlines,
  listClientUsers,
  resetClientUserPassword,
  setClientUserStatus,
} from '../../services/departmentGovernanceService';
import { resendAirlineInvitation } from '../../services/commercialGovernanceApi';
import { PASSWORD_HINT, PASSWORD_PATTERN } from '../department-users/useDepartmentGovernance';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function AirlineUsers({ airline, onBack }) {
  const [users, setUsers] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', temporaryPassword: '' });
  const [manual, setManual] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [password, setPassword] = useState('');
  const [toggling, setToggling] = useState(null);

  const refresh = useCallback(async () => {
    try { setUsers(await listClientUsers(airline.organizationId)); setError(''); }
    catch (failure) { setError(failure.message); }
  }, [airline.organizationId]);
  useEffect(() => { void refresh(); }, [refresh]);

  async function act(action, message) {
    setError('');
    try { await action(); setNotice(message); await refresh(); return true; }
    catch (failure) { setError(failure.status === 409 ? 'El usuario cambió o el correo ya existe. Actualice e inténtelo de nuevo.' : failure.message); return false; }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-accent-600">
          <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" /> Todas las aerolíneas
        </button>
        <button type="button" onClick={() => { setForm({ firstName: '', lastName: '', email: '', temporaryPassword: '' }); setManual(false); setCreating(true); }}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Añadir usuario</button>
      </div>
      <h2 className="text-xl font-bold">{airline.name} <span className="text-sm font-normal text-text-secondary-light">{airline.iataCode}</span></h2>
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      {error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}
      {!users ? !error && <p role="status" className="text-sm">Cargando usuarios…</p> : users.length === 0 ? (
        <EmptyState icon={PlaneIcon} title="Sin usuarios del portal" description="Añada el primer usuario de esta aerolínea." />
      ) : (
        <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
          <table className="table-stack w-full min-w-[640px] text-left text-sm">
            <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Usuario</th><th className="p-3">Estado</th><th className="p-3">Último acceso</th><th className="p-3">Acciones</th></tr></thead>
            <tbody>{users.map(user => (
              <tr key={user.id} className="border-t border-black/5 dark:border-white/5">
                <td className="p-3"><strong>{user.firstName} {user.lastName}</strong><span className="block text-xs text-text-secondary-light">{user.email}</span></td>
                <td className="p-3"><StatusBadge tone={user.status === 'Active' ? 'success' : 'neutral'} label={user.status === 'Active' ? 'Activo' : 'Inactivo'} />{user.mustChangePassword && <span className="block text-xs text-signal-500">Cambio de clave pendiente</span>}{user.invitationPending && <span className="block text-xs text-signal-500">Invitación pendiente de activar</span>}</td>
                <td className="p-3 text-xs">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('es-DO') : 'Nunca'}</td>
                <td className="p-3"><div className="flex flex-wrap gap-x-3 text-xs font-semibold">
                  {user.invitationPending && user.status === 'Active' && <button type="button" onClick={() => act(() => resendAirlineInvitation(user.id), `Enviamos un nuevo enlace de activación a ${user.email}. Los anteriores dejaron de funcionar.`)} className="min-h-[32px] text-accent-600">Reenviar invitación</button>}
                  <button type="button" onClick={() => { setResetting(user); setPassword(''); }} className="min-h-[32px] text-accent-600">Restablecer clave</button>
                  <button type="button" onClick={() => setToggling(user)} className={`min-h-[32px] ${user.status === 'Active' ? 'text-status-danger' : 'text-status-success'}`}>{user.status === 'Active' ? 'Desactivar' : 'Reactivar'}</button>
                </div></td>
              </tr>
            ))}</tbody>
          </table>
        </StackedTable>
      )}
      <Drawer open={creating} onClose={() => setCreating(false)} title={`Añadir usuario a ${airline.name}`}
        description="El usuario recibe por correo un enlace para activar su cuenta y crear su contraseña. Cada inicio de sesión le pide un código enviado a su correo."
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" form="client-user-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear usuario</button></div>}>
        {creating && <form id="client-user-form" className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          const payload = manual ? form : { firstName: form.firstName, lastName: form.lastName, email: form.email };
          if (await act(() => createClientUser(airline.organizationId, payload), manual
            ? 'Usuario creado. Entregue la contraseña temporal por un canal autorizado.'
            : `Usuario creado. Enviamos a ${form.email} un enlace de activación válido por 72 horas.`)) setCreating(false);
        }}>
          {[['firstName', 'Nombre'], ['lastName', 'Apellido']].map(([key, label]) => (
            <label key={key} className="block text-xs font-semibold">{label}<input required minLength={2} maxLength={100} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className={fieldClass} /></label>
          ))}
          <label className="block text-xs font-semibold">Correo de acceso<input required type="email" maxLength={256} value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} className={fieldClass} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)} /> Entregar una contraseña temporal en lugar de la invitación por correo</label>
          {manual && <PasswordField fieldClassName="text-xs font-semibold" inputClassName={fieldClass} label="Contraseña temporal" id="client-user-password" required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password" value={form.temporaryPassword} onChange={event => setForm(current => ({ ...current, temporaryPassword: event.target.value }))} />}
        </form>}
      </Drawer>
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title={`Restablecer clave de ${resetting?.firstName ?? ''}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setResetting(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" form="client-reset-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Restablecer</button></div>}>
        <form id="client-reset-form" onSubmit={async event => {
          event.preventDefault();
          if (await act(() => resetClientUserPassword(airline.organizationId, resetting.id, password), 'Contraseña restablecida.')) setResetting(null);
        }}>
          <PasswordField fieldClassName="text-sm font-semibold" inputClassName={fieldClass} label="Nueva contraseña temporal" id="client-reset-password" required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toggling)} title={toggling?.status === 'Active' ? 'Desactivar usuario' : 'Reactivar usuario'}
        description={toggling?.status === 'Active' ? 'El usuario perderá el acceso al portal de inmediato.' : 'El usuario recuperará el acceso al portal.'}
        confirmLabel={toggling?.status === 'Active' ? 'Desactivar' : 'Reactivar'} onClose={() => setToggling(null)}
        onConfirm={async () => { const user = toggling; setToggling(null); await act(() => setClientUserStatus(airline.organizationId, user.id, user.status !== 'Active', user.version), user.status === 'Active' ? 'Usuario desactivado.' : 'Usuario reactivado.'); }} />
    </div>
  );
}

/** Super administrator view of airline portal users, organised per airline. */
export default function ClientsPanel() {
  const [airlines, setAirlines] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState('');
  const refresh = useCallback(async () => {
    try { setAirlines(await listClientAirlines()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { void refresh(); }, [refresh, selected]);

  if (selected) return <AirlineUsers airline={selected} onBack={() => setSelected(null)} />;
  const visible = (airlines ?? []).filter(airline =>
    `${airline.name} ${airline.iataCode}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <label className="block max-w-md text-xs font-semibold">Buscar aerolínea<input type="search" value={query} onChange={event => setQuery(event.target.value)} className={fieldClass} /></label>
      {error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}
      {!airlines ? !error && <p role="status" className="text-sm">Cargando aerolíneas…</p> : visible.length === 0 ? (
        <EmptyState icon={PlaneIcon} title="Sin aerolíneas" description="Las aerolíneas aprovisionadas aparecerán aquí con sus usuarios del portal." />
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
          {visible.map(airline => (
            <button key={airline.organizationId} type="button" onClick={() => setSelected(airline)}
              className="flex items-center gap-3 rounded-2xl border border-black/5 bg-white p-4 text-left transition hover:border-accent-600/40 dark:border-white/5 dark:bg-surface-dark-card">
              <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-sm font-bold text-accent-600">{airline.iataCode}</span>
              <span className="min-w-0 flex-1"><strong className="block truncate">{airline.name}</strong>
                <span className="text-xs text-text-secondary-light">{airline.activeUsers} activos · {airline.users} en total</span></span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
