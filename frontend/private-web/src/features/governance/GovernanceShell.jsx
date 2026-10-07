import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import ShellFrame from '../shell/ShellFrame';
import { LayoutGridIcon, ShieldCheckIcon, SettingsIcon, PlaneIcon } from '../shell/components/icons';
import AirlinesPanel from './AirlinesPanel';
import RampMobileAccessInbox from './RampMobileAccessInbox';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../shell/useResponsiveSidebar';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../hooks/useCommercialRevalidation';
import PasswordField from '../../components/PasswordField';
import ConfirmDialog from '../../components/ConfirmDialog';
import FileDropField from '../../components/FileDropField';
import PrivateMediaImage from '../../components/PrivateMediaImage';
import {
  getGovernance, getProvisioning, provisionAirline,
  listGovernanceRampMobileAccessRequests, rejectRampMobileAccessRequest,
  getGovernanceAudit,
  createRole, updateRole, deactivateRole, createUser, updateUser,
  deactivateUser, resetUserPassword,
  getManagedAirlines, saveManagedAirline, archiveManagedAirline,
  enrichManagedAirlines, uploadCommercialMedia,
} from '../../services/commercialGovernanceApi';

const modules = [
  { id: 'home', label: 'Inicio', icon: LayoutGridIcon, description: 'Resumen de solicitudes y cuentas.' },
  { id: 'users', label: 'Usuarios', icon: ShieldCheckIcon, description: 'Usuarios, roles y permisos.' },
  { id: 'airlines', label: 'Aerolíneas', icon: PlaneIcon, description: 'Catálogo de aerolíneas solicitantes.' },
  { id: 'settings', label: 'Configuración', icon: SettingsIcon, description: 'Políticas de acceso y auditoría.' },
];
const station = () => ({ code: 'AVIAM', localAbbr: 'AST', localTime: new Date().toISOString(), utcTime: new Date().toISOString() });

export default function GovernanceShell({ user, onLogout }) {
  const [moduleId, setModuleId] = useState('home');
  const [snapshot, setSnapshot] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [rampRequests, setRampRequests] = useState([]);
  const [airlines, setAirlines] = useState([]);
  const [status, setStatus] = useState('loading');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const refreshVersion = useRef(0);
  const sidebar = useResponsiveSidebar();
  const { theme, toggleTheme } = usePreviewControls();

  const refresh = useCallback(async () => {
    const version = ++refreshVersion.current;
    try {
      const [nextSnapshot, nextTasks, nextAirlines, nextRampRequests] = await Promise.all([
        getGovernance(), getProvisioning(), getManagedAirlines(),
        listGovernanceRampMobileAccessRequests(),
      ]);
      if (version !== refreshVersion.current) return;
      setSnapshot(nextSnapshot);
      setTasks(nextTasks);
      setAirlines(nextAirlines);
      setRampRequests(nextRampRequests);
      setStatus('ready');
      setError('');
    } catch (failure) {
      if (version !== refreshVersion.current) return;
      setSnapshot(null);
      setTasks([]);
      setAirlines([]);
      setRampRequests([]);
      setStatus('error');
      setError(failure.message);
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { refreshVersion.current += 1; };
  }, [refresh]);
  useCommercialRevalidation(refresh);
  useEffect(() => {
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ['account_provisioning', 'commercial_requests', 'airline_contracts', 'commercial_airlines', 'ramp_profiles', 'ramp_mobile_access_requests'].includes(resource))) void refresh();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [refresh]);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  async function run(action, successMessage, mobileAccessDecision = false) {
    setError(''); setNotice('');
    try { await action(); setNotice(successMessage); await refresh(); return true; }
    catch (failure) {
      if (failure.status === 409 && mobileAccessDecision) await refresh();
      setError(failure.status === 409 && mobileAccessDecision
        ? 'La solicitud o el perfil cambiaron. Revise la bandeja actualizada antes de decidir.'
        : failure.message);
      return false;
    }
  }
  const active = modules.find(module => module.id === moduleId) ?? modules[0];
  return <ShellFrame
      mainKey={moduleId}
      sidebarProps={{ modules, activeModuleId: moduleId, onSelectModule: id => { setModuleId(id); sidebar.closeOverlay(); },
        badgeCounts: { home: tasks.length + rampRequests.filter(item => item.status === 'Pending').length }, user, onLogout,
        breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded,
        overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay }}
      topbarProps={{ station: station(), notificationsEnabled: false, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}>
        <div className="mx-auto max-w-[1400px] space-y-5 3xl:max-w-[1760px]">
          <header className="flex flex-wrap items-end justify-between gap-3">
            <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">Gobernanza / AVIAM</p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{active.label}</h1>
              <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{active.description}</p></div>
            <button type="button" onClick={refresh} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold dark:border-white/10">Actualizar</button>
          </header>
          {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
          {error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}
          {status === 'loading' ? <div className="rounded-xl bg-white p-8 dark:bg-surface-dark-card">Cargando gobernanza…</div> : null}
          {status === 'ready' && moduleId === 'home' && <GovernanceHome snapshot={snapshot} tasks={tasks}
            rampRequests={rampRequests} run={run} />}
          {status === 'ready' && moduleId === 'users' && <GovernanceUsers snapshot={snapshot} run={run} />}
          {status === 'ready' && moduleId === 'airlines' && <AirlinesPanel airlines={airlines}
            onSave={(id, values) => run(() => saveManagedAirline(id, values), 'Aerolínea guardada.')}
            onArchive={(id, version) => run(() => archiveManagedAirline(id, version), 'Aerolínea archivada.')}
            onEnrich={() => run(enrichManagedAirlines, 'Fichas históricas sin edición manual revisadas.')} />}
          {status === 'ready' && moduleId === 'settings' && <GovernanceSettings snapshot={snapshot} />}
        </div>
  </ShellFrame>;
}

function GovernanceHome({ snapshot, tasks, rampRequests, run }) {
  const activeUsers = snapshot.users.filter(item => item.status === 'Active').length;
  const customRoles = snapshot.roles.filter(item => item.isCustom && item.isActive).length;
  return <>
    <div className="grid gap-4 md:grid-cols-3">
      {[['Cuentas activas', activeUsers], ['Roles personalizados', customRoles], ['Por aprovisionar', tasks.length]].map(([label, value]) =>
        <div key={label} className="rounded-2xl border border-black/5 bg-white p-6 dark:border-white/5 dark:bg-surface-dark-card">
          <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary-light">{label}</p>
          <strong className="mt-4 block text-4xl font-bold text-accent-600">{value}</strong>
        </div>)}
    </div>
    <section className="rounded-2xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="text-xl font-bold">Solicitudes aprobadas para crear acceso</h2>
      <p className="mt-1 text-sm text-text-secondary-light">La cuenta usa los datos del representante validados por Contratos. Ingrese el correo y una contraseña temporal; entregue ambos por un canal manual autorizado.</p>
      {tasks.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{tasks.map(task =>
        <ProvisioningCard key={task.requestId} task={task} run={run} />)}</div> :
        <p className="mt-6 rounded-xl bg-black/[.035] p-5 text-sm dark:bg-white/[.04]">No hay cuentas pendientes de crear.</p>}
    </section>
    <RampMobileAccessInbox requests={rampRequests} profiles={snapshot.rampProfiles ?? []}
      roleId={snapshot.roles.find(role => role.code === 'RAMP_AGENT' && role.isActive)?.id}
      onApprove={values => run(() => createUser(values),
        'Cuenta móvil creada. Entregue las credenciales manualmente; el primer ingreso exige cambiar la contraseña.', true)}
      onReject={(id, reason, version) => run(() => rejectRampMobileAccessRequest(id, reason, version),
        'Solicitud móvil rechazada. Gestión Humana verá el motivo.', true)} />
  </>;
}

function ProvisioningCard({ task, run }) {
  const [email, setEmail] = useState(task.suggestedEmail);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    const saved = await run(() => provisionAirline(task.requestId, email, password),
      `Cuenta de ${task.airline} creada. Entregue las credenciales manualmente; el primer ingreso exige cambiar la contraseña.`);
    if (saved) setPassword('');
    setBusy(false);
  }
  return <form onSubmit={submit} className="rounded-xl border border-accent-600/20 bg-accent-600/[.035] p-5">
    <div className="flex items-center justify-between gap-3"><strong>{task.airline}</strong><span className="text-xs font-mono text-text-secondary-light">{task.reference.slice(0, 12)}</span></div>
    <p className="mt-1 text-sm text-text-secondary-light">Representante: {task.representativeName}</p>
    <label className="mt-4 block text-xs font-semibold">Correo de acceso<input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" /></label>
    <PasswordField fieldClassName="mt-3 text-xs font-semibold" inputClassName="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" label="Contraseña temporal" id={`provision-password-${task.requestId}`} required minLength={14} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" />
    <button disabled={busy} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{busy ? 'Creando…' : 'Crear credenciales'}</button>
  </form>;
}

function GovernanceUsers({ snapshot, run }) {
  const [tab, setTab] = useState('users');
  return <>
    <div role="tablist" aria-label="Administración de usuarios" className="flex gap-2 border-b border-black/10 dark:border-white/10">
      {[['users', 'Usuarios'], ['roles', 'Roles y permisos']].map(([key, label]) =>
        <button key={key} type="button" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}
          className={`px-4 py-3 text-sm font-semibold ${tab === key ? 'border-b-2 border-accent-600 text-accent-600' : 'text-text-secondary-light'}`}>{label}</button>)}
    </div>
    {tab === 'users' ? <UsersPanel snapshot={snapshot} run={run} /> : <RolesPanel snapshot={snapshot} run={run} />}
  </>;
}

function UsersPanel({ snapshot, run }) {
  const [editing, setEditing] = useState(null);
  const [pendingDeactivate, setPendingDeactivate] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [password, setPassword] = useState('');
  const emptyUser = () => ({ firstName: '', lastName: '', email: '', roleId: '', rampAgentId: '', temporaryPassword: '', isActive: true, avatarMediaUrl: null });
  const [form, setForm] = useState(emptyUser);
  const [avatar, setAvatar] = useState(null);
  const roles = snapshot.roles.filter(role => role.isActive &&
    (editing ? role.portal === snapshot.users.find(user => user.id === editing)?.portal :
      role.portal === 'BackOffice'));
  const selectedRole = roles.find(role => role.id === form.roleId);
  const rampProfiles = snapshot.rampProfiles ?? [];
  function edit(user) {
    const words = user.name.split(' ');
    setEditing(user.id);
    setAvatar(null);
    setForm({ firstName: words[0] ?? '', lastName: words.slice(1).join(' '), email: user.email,
      roleId: user.roleId, rampAgentId: user.rampAgentId ?? '', temporaryPassword: '', isActive: user.status === 'Active', avatarMediaUrl: user.avatarMediaUrl ?? null });
  }
  async function save(event) {
    event.preventDefault();
    const succeeded = await run(async () => {
      const avatarMediaUrl = avatar ? (await uploadCommercialMedia('avatar', avatar)).url : form.avatarMediaUrl;
      const values = { ...form, rampAgentId: form.rampAgentId || null, avatarMediaUrl };
      return editing ? updateUser(editing, values) : createUser(values);
    },
      editing ? 'Usuario actualizado.' : 'Usuario creado. Entregue la contraseña temporal manualmente.');
    if (succeeded) { setEditing(null); setForm(emptyUser()); setAvatar(null); }
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_350px]">
    <section className="overflow-x-auto rounded-xl border border-black/5 bg-white dark:bg-surface-dark-card">
      <table className="w-full min-w-[700px] text-left text-sm"><thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]"><tr><th className="p-4">Usuario</th><th>Rol</th><th>Organización</th><th>Estado</th><th>Acciones</th></tr></thead>
        <tbody>{snapshot.users.map(user => <tr key={user.id} className="border-t border-black/5 dark:border-white/5">
          <td className="p-4"><div className="flex items-center gap-3"><div className="grid h-10 w-10 shrink-0 place-items-center overflow-hidden rounded-full bg-accent-600/10 text-xs font-bold text-accent-600">{user.avatarMediaUrl ? <PrivateMediaImage url={user.avatarMediaUrl} alt={`Foto de ${user.name}`} className="h-10 w-10 object-cover" /> : user.name.slice(0, 1)}</div><div><strong>{user.name}</strong><span className="block text-xs text-text-secondary-light">{user.email}</span></div></div></td>
          <td>{user.roleName}</td><td>{user.organization}</td><td>{user.status === 'Active' ? 'Activo' : 'Inactivo'}{user.mustChangePassword && <span className="block text-xs text-signal-500">Cambio de clave pendiente</span>}</td>
          <td><div className="flex flex-wrap gap-2"><button type="button" onClick={() => edit(user)} className="text-xs font-semibold text-accent-600">Editar</button><button type="button" onClick={() => { setResetting(user); setPassword(''); }} className="text-xs font-semibold text-accent-600">Restablecer clave</button><button type="button" onClick={() => setPendingDeactivate(user)} className="text-xs font-semibold text-status-danger">Desactivar</button></div></td>
        </tr>)}</tbody></table>
    </section>
    <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card">
      <h2 className="text-lg font-bold">{editing ? 'Editar usuario' : 'Crear usuario interno'}</h2>
      <p className="mt-1 text-xs text-text-secondary-light">La contraseña temporal exige cambio en el primer acceso y debe tener al menos 14 caracteres con mayúscula, minúscula, número y símbolo.</p>
      {[['firstName', 'Nombre'], ['lastName', 'Apellido'], ['email', 'Correo de acceso']].map(([key, label]) =>
        <label key={key} className="mt-4 block text-xs font-semibold">{label}<input required type={key === 'email' ? 'email' : 'text'} minLength={key === 'email' ? undefined : 2} maxLength={key === 'email' ? 256 : 100} value={form[key]} onChange={event => setForm(current => ({ ...current, [key]: event.target.value }))} className="mt-1 block w-full rounded-lg border border-black/10 p-2 text-sm dark:bg-surface-dark" /></label>)}
      <label className="mt-4 block text-xs font-semibold">Rol<select required value={form.roleId} onChange={event => setForm(current => ({ ...current, roleId: event.target.value, rampAgentId: '' }))} className="mt-1 block w-full rounded-lg border border-black/10 p-2 text-sm dark:bg-surface-dark"><option value="">Seleccione un rol</option>{roles.map(role => <option key={role.id} value={role.id}>{role.name} · {role.portal === 'RampMobileApp' ? 'App de rampa' : 'Private Web'}</option>)}</select></label>
      {selectedRole?.portal === 'RampMobileApp' && <label className="mt-4 block text-xs font-semibold">Perfil operativo de Gestión Humana<select required value={form.rampAgentId} disabled={Boolean(editing)} onChange={event => {
        const profile = rampProfiles.find(item => item.id === event.target.value);
        const [firstName, ...lastName] = (profile?.name ?? '').split(' ');
        setForm(current => ({ ...current, rampAgentId: event.target.value,
          firstName: firstName || current.firstName, lastName: lastName.join(' ') || current.lastName }));
      }} className="mt-1 block w-full rounded-lg border border-black/10 p-2 text-sm dark:bg-surface-dark"><option value="">Seleccione un perfil con estación activa</option>{rampProfiles.filter(profile => profile.stations.length && (!profile.accountId || profile.accountId === editing)).map(profile => <option key={profile.id} value={profile.id}>{profile.name} · {profile.employeeNumber} · {profile.stations.join(', ')}</option>)}</select></label>}
      {form.avatarMediaUrl && !avatar && <PrivateMediaImage url={form.avatarMediaUrl} alt="Foto actual del usuario" className="mt-4 h-16 w-16 rounded-full object-cover" />}
      <FileDropField label="Foto de perfil" accept="image/png,image/jpeg,image/webp" file={avatar} onFile={setAvatar} hint="Arrastre o busque una imagen PNG, JPG o WebP de hasta 8 MB." />
      {!editing && <PasswordField fieldClassName="mt-4 text-xs font-semibold" inputClassName="mt-1 block w-full rounded-lg border border-black/10 p-2 text-sm dark:bg-surface-dark" label="Contraseña temporal" id="governance-create-password" required minLength={14} pattern="(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{14,}" title="Al menos 14 caracteres con mayúscula, minúscula, número y símbolo." autoComplete="new-password" value={form.temporaryPassword} onChange={event => setForm(current => ({ ...current, temporaryPassword: event.target.value }))} />}
      {editing && <label className="mt-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={form.isActive} onChange={event => setForm(current => ({ ...current, isActive: event.target.checked }))} /> Cuenta activa</label>}
      <div className="mt-5 flex gap-2"><button className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar usuario</button>{editing && <button type="button" onClick={() => { setEditing(null); setForm(emptyUser()); setAvatar(null); }} className="rounded-lg border px-3 py-2 text-sm">Cancelar</button>}</div>
    </form>
    {resetting && <div role="dialog" aria-modal="true" aria-label="Restablecer contraseña" className="fixed inset-0 z-[100] grid place-items-center bg-black/55 p-4"><form onSubmit={async event => { event.preventDefault(); const saved = await run(() => resetUserPassword(resetting.id, password), 'Contraseña restablecida. Entregue la nueva clave manualmente.'); if (saved) setResetting(null); }} className="w-full max-w-md rounded-xl bg-white p-6 dark:bg-surface-dark-card"><h2 className="font-bold">Restablecer clave de {resetting.name}</h2><PasswordField fieldClassName="mt-4 text-sm font-semibold" inputClassName="mt-1 w-full rounded-lg border p-2 dark:bg-surface-dark" label="Nueva contraseña temporal" id="governance-reset-password" required minLength={14} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" /><div className="mt-4 flex gap-2"><button className="rounded-lg bg-accent-600 px-4 py-2 text-white">Restablecer</button><button type="button" onClick={() => setResetting(null)}>Cancelar</button></div></form></div>}
    <ConfirmDialog open={Boolean(pendingDeactivate)} title="Desactivar usuario" description={`¿Desactivar a ${pendingDeactivate?.name ?? ''}? Su acceso quedará revocado.`} confirmLabel="Desactivar" onClose={() => setPendingDeactivate(null)} onConfirm={async () => { const user = pendingDeactivate; setPendingDeactivate(null); await run(() => deactivateUser(user.id), 'Usuario desactivado.'); }} />
  </div>;
}

function RolesPanel({ snapshot, run }) {
  const [editing, setEditing] = useState(null);
  const [pendingDeactivate, setPendingDeactivate] = useState(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [levels, setLevels] = useState({});
  const [closureGrants, setClosureGrants] = useState([]);
  const closureActions = ['read', 'request', 'decide', 'reopen'];
  const modules = useMemo(() => snapshot.permissionCodes.filter(code => code.startsWith('commercial.') &&
    code.endsWith('.read') && !code.startsWith('commercial.service_closures.')).map(code => code.slice(0, -5)), [snapshot.permissionCodes]);
  function edit(role) {
    setEditing(role.id); setName(role.name); setDescription(role.description ?? '');
    setClosureGrants(role.permissions.filter(code => code.startsWith('commercial.service_closures.')));
    setLevels(Object.fromEntries(modules.map(module => [module,
      role.permissions.includes(`${module}.write`) || role.permissions.includes(`${module}.full`) ? 'full' :
        role.permissions.includes(`${module}.edit`) ? 'edit' :
          role.permissions.includes(`${module}.create`) ? 'create' :
            'read'])));
  }
  async function save(event) {
    event.preventDefault();
    const permissionCodes = [...modules.flatMap(module => {
      const level = levels[module] ?? 'read';
      if (level === 'read') return [`${module}.read`];
      if (level === 'full') return [`${module}.read`, ...['create', 'edit', 'full']
        .filter(action => snapshot.permissionCodes.includes(`${module}.${action}`))
        .map(action => `${module}.${action}`)];
      return [`${module}.read`, `${module}.${level}`];
    }), ...closureGrants];
    if (closureGrants.some(code => code !== 'commercial.service_closures.read') &&
      !permissionCodes.includes('commercial.service_closures.read'))
      permissionCodes.push('commercial.service_closures.read');
    const values = { name, description, permissionCodes, isActive: true };
    const saved = await run(() => editing ? updateRole(editing, values) : createRole(values), editing ? 'Rol actualizado.' : 'Rol creado.');
    if (saved) { setEditing(null); setName(''); setDescription(''); setLevels({}); setClosureGrants([]); }
  }
  return <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_390px]">
    <section className="rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card"><h2 className="font-bold">Roles del sistema</h2><div className="mt-4 space-y-2">{snapshot.roles.map(role =>
      <div key={role.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10"><div><strong>{role.name}</strong><p className="text-xs text-text-secondary-light">{role.code} · {role.activeUsers} usuarios activos · {role.isCustom ? 'Personalizado' : 'Protegido'}</p><p className="mt-1 text-xs text-text-secondary-light">{role.permissions.join(' · ') || 'Sin permisos de gobernanza asignados'}</p></div>{role.isCustom && <div className="flex gap-2"><button type="button" onClick={() => edit(role)} className="text-xs font-semibold text-accent-600">Editar</button><button type="button" onClick={() => setPendingDeactivate(role)} className="text-xs font-semibold text-status-danger">Desactivar</button></div>}</div>)}</div></section>
    <form onSubmit={save} className="h-fit rounded-xl border border-black/5 bg-white p-5 dark:bg-surface-dark-card"><h2 className="font-bold">{editing ? 'Editar rol' : 'Nuevo rol personalizado'}</h2>
      <label className="mt-4 block text-xs font-semibold">Nombre<input required minLength={3} maxLength={120} value={name} onChange={event => setName(event.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
      <label className="mt-4 block text-xs font-semibold">Descripción<input maxLength={500} value={description} onChange={event => setDescription(event.target.value)} className="mt-1 w-full rounded-lg border p-2 text-sm dark:bg-surface-dark" /></label>
      <h3 className="mt-5 text-sm font-semibold">Permisos por módulo</h3><div className="mt-2 space-y-2">{modules.map(module =>
        <label key={module} className="flex items-center justify-between gap-2 rounded-lg bg-black/[.03] px-3 py-2 text-xs dark:bg-white/[.04]"><span>{module === 'commercial.catalog' ? 'Servicios' : 'Solicitudes y borradores'}</span><select value={levels[module] ?? 'read'} onChange={event => setLevels(current => ({ ...current, [module]: event.target.value }))} className="rounded border bg-white p-1 dark:bg-surface-dark"><option value="read">Ver</option>{snapshot.permissionCodes.includes(`${module}.create`) && <option value="create">Crear</option>}<option value="edit">Editar</option><option value="full">Acceso completo</option></select></label>)}</div>
      <fieldset className="mt-5 space-y-2"><legend className="text-sm font-semibold">Clausura de servicios</legend>{closureActions.map(action => {
        const code = `commercial.service_closures.${action}`;
        if (!snapshot.permissionCodes.includes(code)) return null;
        const label = { read: 'Ver historial', request: 'Solicitar clausura (OCC)', decide: 'Aprobar o denegar (Contratos)', reopen: 'Republicar (Contratos)' }[action];
        return <label key={code} className="flex items-center gap-3 rounded-lg bg-black/[.03] px-3 py-2 text-xs dark:bg-white/[.04]"><input type="checkbox" checked={closureGrants.includes(code)} onChange={event => setClosureGrants(current => event.target.checked ? [...current, code] : current.filter(item => item !== code))} />{label}</label>;
      })}</fieldset>
      <div className="mt-5 flex gap-2"><button className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Guardar rol</button>{editing && <button type="button" onClick={() => { setEditing(null); setName(''); setDescription(''); setLevels({}); setClosureGrants([]); }}>Cancelar</button>}</div>
    </form>
    <ConfirmDialog open={Boolean(pendingDeactivate)} title="Desactivar rol" description={`¿Desactivar el rol ${pendingDeactivate?.name ?? ''}?`} confirmLabel="Desactivar" onClose={() => setPendingDeactivate(null)} onConfirm={async () => { const role = pendingDeactivate; setPendingDeactivate(null); await run(() => deactivateRole(role.id), 'Rol desactivado.'); }} />
  </div>;
}

function GovernanceSettings({ snapshot }) {
  const [page, setPage] = useState(1);
  const [audit, setAudit] = useState(null);
  const [auditError, setAuditError] = useState('');
  useEffect(() => {
    let active = true;
    getGovernanceAudit(page).then(result => { if (active) { setAudit(result); setAuditError(''); } })
      .catch(error => { if (active) setAuditError(error.message); });
    return () => { active = false; };
  }, [page, snapshot]);
  return <div className="grid gap-5 lg:grid-cols-2">
    <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card"><h2 className="text-lg font-bold">Política de acceso</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>Contraseña temporal</dt><dd className="font-semibold">Cambio obligatorio al ingresar</dd></div><div className="flex justify-between gap-3"><dt>Longitud mínima</dt><dd className="font-semibold">14 caracteres</dd></div><div className="flex justify-between gap-3"><dt>Bloqueo</dt><dd className="font-semibold">5 intentos / 15 minutos</dd></div><div className="flex justify-between gap-3"><dt>Entrega de credenciales</dt><dd className="font-semibold">Manual, sin correo automático</dd></div></dl><h3 className="mt-6 font-semibold">Catálogo de permisos</h3><div className="mt-2 flex flex-wrap gap-2">{snapshot.permissionCodes.map(code => <span key={code} className="rounded bg-accent-600/10 px-2 py-1 font-mono text-xs text-accent-600">{code}</span>)}</div></section>
    <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card"><h2 className="text-lg font-bold">Auditoría</h2>{auditError && <p role="alert" className="mt-3 text-sm text-status-danger">{auditError}</p>}<div className="mt-4 max-h-[560px] space-y-3 overflow-auto">{(audit?.entries ?? snapshot.recentAudit).length ? (audit?.entries ?? snapshot.recentAudit).map((item, index) => <div key={`${item.at}-${index}`} className="border-b border-black/5 pb-3 text-sm dark:border-white/5"><p className="font-semibold">{item.action}</p><p className="text-xs text-text-secondary-light">{new Date(item.at).toLocaleString('es-DO')} · {item.actor} · {item.entityType}</p>{item.changes?.length > 0 && <ul className="mt-2 space-y-1 text-xs">{item.changes.map(change => <li key={change.field}><strong>{change.field}</strong>: {change.before ?? '—'} → {change.after ?? '—'}</li>)}</ul>}</div>) : <p className="text-sm text-text-secondary-light">No hay cambios registrados.</p>}</div><div className="mt-4 flex items-center gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(current => current - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Anterior</button><span>Página {page}</span><button type="button" disabled={!audit?.hasMore} onClick={() => setPage(current => current + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Siguiente</button></div></section>
  </div>;
}
