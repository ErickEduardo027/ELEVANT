import { useEffect, useRef, useState } from 'react';
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
  setClientUserPortalRole,
  setClientUserStatus,
} from '../../services/departmentGovernanceService';
import { resendAirlineInvitation } from '../../services/commercialGovernanceApi';
import { commercialGovernanceMessage } from '../../services/commercialProblems';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { isConflict, isForbidden } from '../../services/problemMessages';
import { PASSWORD_HINT, PASSWORD_PATTERN } from '../department-users/useDepartmentGovernance';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const FORBIDDEN = 'Solo el superadministrador gestiona los usuarios del portal de aerolíneas.';
const ROLE_BADGE = 'mr-1 mt-1 inline-block rounded-full px-2 py-0.5 text-[11px] font-semibold';

/** What each user may do in the portal (2-N20): representatives manage users and sign; signers sign. */
function PortalRoles({ user }) {
  if (!user.representative && !user.signer) return null;
  return <span className="block">
    {user.representative && <span className={`${ROLE_BADGE} bg-accent-600/10 text-accent-600`}>Representante</span>}
    {user.signer && <span className={`${ROLE_BADGE} bg-signal-500/10 text-signal-500`}>Firmante</span>}
  </span>;
}

/** The failure of a list read: an unauthorized state, never an error to retry. */
function LoadFailure({ failure, fallback, onRetry }) {
  if (isForbidden(failure)) return <p role="alert" className="rounded-lg border border-black/10 p-3 text-sm dark:border-white/10">{FORBIDDEN}</p>;
  return <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">
    <span>{commercialGovernanceMessage(failure, { fallback })}</span>
    <button type="button" onClick={onRetry} className="rounded-lg border border-status-danger px-3 py-1 text-xs font-semibold">Reintentar</button>
  </div>;
}

function AirlineUsers({ airline, onBack }) {
  const [users, setUsers] = useState(null);
  const [loadFailure, setLoadFailure] = useState(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ firstName: '', lastName: '', email: '', temporaryPassword: '' });
  const [manual, setManual] = useState(false);
  const [resetting, setResetting] = useState(null);
  const [password, setPassword] = useState('');
  const [toggling, setToggling] = useState(null);
  const [reload, setReload] = useState(0);
  const resendKeys = useRef(createCommandKeyHolder());
  const resetKeys = useRef(createCommandKeyHolder());
  const createKeys = useRef(createCommandKeyHolder());
  const statusKeys = useRef(createCommandKeyHolder());
  const roleKeys = useRef(createCommandKeyHolder());

  useEffect(() => {
    let active = true;
    listClientUsers(airline.organizationId)
      .then(next => { if (active) { setUsers(next); setLoadFailure(null); } })
      .catch(failure => { if (active) setLoadFailure(failure); });
    return () => { active = false; };
  }, [airline.organizationId, reload]);
  const refresh = () => setReload(current => current + 1);

  async function act(action, message) {
    setError(''); setNotice('');
    try { await action(); setNotice(message); refresh(); return true; }
    catch (failure) {
      // The code explains the failure in Spanish; a conflict re-reads the users before a new attempt.
      setError(commercialGovernanceMessage(failure));
      if (isConflict(failure)) refresh();
      return false;
    }
  }

  const resend = user => act(() => resendKeys.current.run('resend-invitation', { id: user.id, version: user.version },
    key => resendAirlineInvitation(user.id, user.version, key)),
  `Nuevo enlace de activación en cola para ${user.email}; vence en 72 horas y los anteriores dejaron de funcionar. Revise «Correo del sistema» en Configuración para confirmar el envío.`);

  /** Designates or withdraws a portal role with the account version on screen (2-N20). */
  const setPortalRole = (user, change, message) => {
    const values = { representative: Boolean(user.representative), signer: Boolean(user.signer), ...change,
      expectedVersion: user.version };
    return act(() => roleKeys.current.run('portal-role', { id: user.id, ...values },
      key => setClientUserPortalRole(airline.organizationId, user.id, values, key)),
    `${message} Si la aerolínea tiene representantes activos, su aviso quedó en cola.`);
  };

  async function reset(event) {
    event.preventDefault();
    const user = resetting;
    const done = await act(() => resetKeys.current.run('password-reset', { id: user.id, version: user.version, password },
      key => resetClientUserPassword(airline.organizationId, user.id, password, user.version, key)),
    user.invitationPending
      ? `Contraseña temporal asignada a ${user.email}. La invitación quedó cerrada: sus enlaces dejaron de funcionar y el correo pendiente se descartó. Entréguela por un canal autorizado; el primer ingreso exige cambiarla.`
      : `Contraseña temporal asignada a ${user.email}. Entréguela por un canal autorizado; el primer ingreso exige cambiarla.`);
    if (done) { setResetting(null); setPassword(''); }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <button type="button" onClick={onBack} className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-accent-600">
          <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" /> Todas las aerolíneas
        </button>
        <button type="button" onClick={() => { setForm({ firstName: '', lastName: '', email: '', temporaryPassword: '' }); setManual(false); createKeys.current.reset(); setCreating(true); }}
          className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Añadir usuario</button>
      </div>
      <h2 className="text-xl font-bold">{airline.name} <span className="text-sm font-normal text-text-secondary-light">{airline.iataCode}</span></h2>
      <p className="text-sm text-text-secondary-light">Los representantes gestionan los usuarios de su aerolínea en el portal y firman. Los firmantes firman los contratos y envían el permiso de operación (JAC). El resto de usuarios consulta.</p>
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      {error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}
      {loadFailure ? <LoadFailure failure={loadFailure} fallback="No se pudieron cargar los usuarios del portal." onRetry={refresh} />
        : !users ? <p role="status" className="text-sm">Cargando usuarios…</p> : users.length === 0 ? (
          <EmptyState icon={PlaneIcon} title="Sin usuarios del portal" description="Añada el primer usuario de esta aerolínea." />
        ) : (
          <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
            <table className="table-stack w-full min-w-[640px] text-left text-sm">
              <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-3">Usuario</th><th className="p-3">Estado</th><th className="p-3">Último acceso</th><th className="p-3">Acciones</th></tr></thead>
              <tbody>{users.map(user => (
                <tr key={user.id} className="border-t border-black/5 dark:border-white/5">
                  <td className="p-3"><strong>{user.firstName} {user.lastName}</strong><span className="block text-xs text-text-secondary-light">{user.email}</span><PortalRoles user={user} /></td>
                  <td className="p-3"><StatusBadge tone={user.status === 'Active' ? 'success' : 'neutral'} label={user.status === 'Active' ? 'Activo' : 'Inactivo'} />{user.mustChangePassword && <span className="block text-xs text-signal-500">Cambio de clave pendiente</span>}{user.invitationPending && <span className="block text-xs text-signal-500">Invitación pendiente de activar</span>}</td>
                  <td className="p-3 text-xs">{user.lastLoginAt ? new Date(user.lastLoginAt).toLocaleString('es-DO') : 'Nunca'}</td>
                  <td className="p-3"><div className="flex flex-wrap gap-x-3 text-xs font-semibold">
                    {user.invitationPending && user.status === 'Active' && <button type="button" onClick={() => { void resend(user); }} className="min-h-[32px] text-accent-600">Reenviar invitación</button>}
                    <button type="button" onClick={() => { setResetting(user); setPassword(''); resetKeys.current.reset(); }} className="min-h-[32px] text-accent-600">{user.invitationPending ? 'Asignar contraseña temporal' : 'Restablecer clave'}</button>
                    {user.status === 'Active' && <button type="button" onClick={() => { void setPortalRole(user, { representative: !user.representative },
                      user.representative ? `${user.firstName} ${user.lastName} dejó de ser representante.` : `${user.firstName} ${user.lastName} ahora es representante.`); }}
                    className="min-h-[32px] text-accent-600">{user.representative ? 'Quitar representante' : 'Designar representante'}</button>}
                    {user.status === 'Active' && <button type="button" onClick={() => { void setPortalRole(user, { signer: !user.signer },
                      user.signer ? `${user.firstName} ${user.lastName} ya no está marcado como firmante.` : `${user.firstName} ${user.lastName} ahora puede firmar y enviar el permiso de operación.`); }}
                    className="min-h-[32px] text-accent-600">{user.signer ? 'Quitar firmante' : 'Marcar firmante'}</button>}
                    <button type="button" onClick={() => setToggling(user)} className={`min-h-[32px] ${user.status === 'Active' ? 'text-status-danger' : 'text-status-success'}`}>{user.status === 'Active' ? 'Desactivar' : 'Reactivar'}</button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </StackedTable>
        )}
      <Drawer open={creating} onClose={() => setCreating(false)} title={`Añadir usuario a ${airline.name}`}
        description="Por defecto ELEVANT deja en cola una invitación por correo: el usuario activa su cuenta y crea su contraseña con el enlace, que vence en 72 horas. Como alternativa, entregue una contraseña temporal por un canal autorizado. Cada inicio de sesión pide un código enviado al correo."
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setCreating(false)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" form="client-user-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear usuario</button></div>}>
        {creating && <form id="client-user-form" className="space-y-4" onSubmit={async event => {
          event.preventDefault();
          const payload = manual ? form : { firstName: form.firstName, lastName: form.lastName, email: form.email };
          if (await act(() => createKeys.current.run('client-user.create', payload,
            key => createClientUser(airline.organizationId, payload, key)), manual
            ? 'Usuario creado. Entregue la contraseña temporal por un canal autorizado; el primer ingreso exige cambiarla.'
            : `Usuario creado. La invitación quedó en cola para ${form.email}; el enlace vence en 72 horas. Revise «Correo del sistema» en Configuración para confirmar el envío.`)) setCreating(false);
        }}>
          {[['firstName', 'Nombre'], ['lastName', 'Apellido']].map(([key, label]) => (
            <label key={key} className="block text-xs font-semibold">{label}<input required minLength={2} maxLength={100} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className={fieldClass} /></label>
          ))}
          <label className="block text-xs font-semibold">Correo de acceso<input required type="email" maxLength={256} value={form.email} onChange={event => setForm(current => ({ ...current, email: event.target.value }))} className={fieldClass} /></label>
          <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)} /> Entregar una contraseña temporal en lugar de la invitación por correo</label>
          {manual && <PasswordField fieldClassName="text-xs font-semibold" inputClassName={fieldClass} label="Contraseña temporal" id="client-user-password" required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password" value={form.temporaryPassword} onChange={event => setForm(current => ({ ...current, temporaryPassword: event.target.value }))} />}
        </form>}
      </Drawer>
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)}
        title={resetting?.invitationPending ? `Asignar contraseña temporal a ${resetting?.firstName ?? ''}` : `Restablecer clave de ${resetting?.firstName ?? ''}`}
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setResetting(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button><button type="submit" form="client-reset-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{resetting?.invitationPending ? 'Asignar contraseña' : 'Restablecer'}</button></div>}>
        <form id="client-reset-form" className="space-y-3" onSubmit={reset}>
          <p className="text-sm text-text-secondary-light">{resetting?.invitationPending
            ? 'Este usuario aún no activó su invitación. Con una contraseña temporal la invitación se da por aceptada: sus enlaces de activación dejan de funcionar y el correo pendiente se descarta. Entréguela por un canal autorizado; el primer ingreso exige cambiarla.'
            : 'El usuario deberá cambiar la contraseña temporal en su próximo ingreso. Entréguela por un canal autorizado.'}</p>
          <PasswordField fieldClassName="text-sm font-semibold" inputClassName={fieldClass} label="Nueva contraseña temporal" id="client-reset-password" required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toggling)} title={toggling?.status === 'Active' ? 'Desactivar usuario' : 'Reactivar usuario'}
        description={toggling?.status === 'Active' ? 'El usuario perderá el acceso al portal de inmediato.' : 'El usuario recuperará el acceso al portal.'}
        confirmLabel={toggling?.status === 'Active' ? 'Desactivar' : 'Reactivar'} onClose={() => setToggling(null)}
        onConfirm={async () => {
          const user = toggling;
          const active = user.status !== 'Active';
          setToggling(null);
          await act(() => statusKeys.current.run('client-user.status', { id: user.id, active, version: user.version },
            key => setClientUserStatus(airline.organizationId, user.id, active, user.version, key)),
          active ? 'Usuario reactivado. Si la aerolínea tiene representantes activos, su aviso quedó en cola.'
            : 'Usuario desactivado. Si la aerolínea tiene representantes activos, su aviso quedó en cola.');
        }} />
    </div>
  );
}

/** Super administrator view of airline portal users, organised per airline. */
export default function ClientsPanel() {
  const [airlines, setAirlines] = useState(null);
  const [selected, setSelected] = useState(null);
  const [query, setQuery] = useState('');
  const [failure, setFailure] = useState(null);
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    listClientAirlines()
      .then(next => { if (active) { setAirlines(next); setFailure(null); } })
      .catch(error => { if (active) setFailure(error); });
    return () => { active = false; };
  }, [reload, selected]);

  if (selected) return <AirlineUsers airline={selected} onBack={() => setSelected(null)} />;
  const visible = (airlines ?? []).filter(airline =>
    `${airline.name} ${airline.iataCode}`.toLowerCase().includes(query.trim().toLowerCase()));
  return (
    <div className="space-y-4">
      <label className="block max-w-md text-xs font-semibold">Buscar aerolínea<input type="search" value={query} onChange={event => setQuery(event.target.value)} className={fieldClass} /></label>
      {failure ? <LoadFailure failure={failure} fallback="No se pudieron cargar las aerolíneas." onRetry={() => setReload(current => current + 1)} />
        : !airlines ? <p role="status" className="text-sm">Cargando aerolíneas…</p> : visible.length === 0 ? (
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
