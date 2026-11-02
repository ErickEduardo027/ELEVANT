import { useCallback, useEffect, useRef, useState } from 'react';
import ActivityPanel from '../employees/ActivityPanel';
import { listAudit } from '../../services/humanResourcesEmployeesService';
import ShellFrame from '../shell/ShellFrame';
import { LayoutGridIcon, ShieldCheckIcon, SettingsIcon, PlaneIcon, UsersIcon } from '../shell/components/icons';
import AirlinesPanel from './AirlinesPanel';
import ClientsPanel from './ClientsPanel';
import InternalUsersPanel from './InternalUsersPanel';
import AccessValidationsPage from '../department-users/AccessValidationsPage';
import { usePreviewControls } from '../dashboard/usePreviewControls';
import { useResponsiveSidebar } from '../shell/useResponsiveSidebar';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { useCommercialRevalidation } from '../../hooks/useCommercialRevalidation';
import PasswordField from '../../components/PasswordField';
import ConfirmDialog from '../../components/ConfirmDialog';
import {
  getGovernance, getProvisioning, provisionAirline, getGovernanceAudit,
  getManagedAirlines, saveManagedAirline, archiveManagedAirline, enrichManagedAirlines, checkManagedAirlineRegistry,
} from '../../services/commercialGovernanceApi';
import { convertLegacyRole, getDepartmentsOverview, listLegacyRoles } from '../../services/departmentGovernanceService';

const MODULE_INFO = {
  home: { label: 'Inicio', description: 'Resumen de solicitudes y cuentas.' },
  clients: { label: 'Clientes', description: 'Usuarios del portal de cada aerolínea.' },
  internal: { label: 'Usuarios internos', description: 'Administradores, sub-usuarios y solicitudes por departamento.' },
  validations: { label: 'Validaciones de acceso', description: 'Todas las altas solicitadas por los departamentos.' },
  airlines: { label: 'Aerolíneas', description: 'Catálogo de aerolíneas solicitantes.' },
  settings: { label: 'Configuración', description: 'Políticas de acceso, roles heredados y auditoría.' },
};

const modules = [
  { id: 'home', label: 'Inicio', icon: LayoutGridIcon },
  { id: 'users', label: 'Usuarios', icon: UsersIcon, children: [
    { id: 'clients', label: 'Clientes' },
    { id: 'internal', label: 'Usuarios internos' },
  ] },
  { id: 'validations', label: 'Validaciones de acceso', icon: ShieldCheckIcon },
  { id: 'airlines', label: 'Aerolíneas', icon: PlaneIcon },
  { id: 'settings', label: 'Configuración', icon: SettingsIcon },
];
const station = () => ({ code: 'AVIAM', localAbbr: 'AST', localTime: new Date().toISOString(), utcTime: new Date().toISOString() });

export default function GovernanceShell({ user, onLogout }) {
  const [moduleId, setModuleId] = useState('home');
  const [snapshot, setSnapshot] = useState(null);
  const [tasks, setTasks] = useState([]);
  const [overview, setOverview] = useState(null);
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
      const [nextSnapshot, nextTasks, nextAirlines, nextOverview] = await Promise.all([
        getGovernance(), getProvisioning(), getManagedAirlines(), getDepartmentsOverview(),
      ]);
      if (version !== refreshVersion.current) return;
      setSnapshot(nextSnapshot);
      setTasks(nextTasks);
      setAirlines(nextAirlines);
      setOverview(nextOverview);
      setStatus('ready');
      setError('');
    } catch (failure) {
      if (version !== refreshVersion.current) return;
      setStatus(current => (current === 'ready' ? current : 'error'));
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
      if (resources.some(resource => ['account_provisioning', 'commercial_requests', 'airline_contracts', 'commercial_airlines',
        'access_requests', 'department_users'].includes(resource))) void refresh();
    });
    void observer.start();
    return () => { void observer.stop(); };
  }, [refresh]);
  useEffect(() => { document.documentElement.classList.toggle('dark', theme === 'dark'); }, [theme]);

  async function run(action, successMessage) {
    setError(''); setNotice('');
    try { await action(); setNotice(successMessage); await refresh(); return true; }
    catch (failure) {
      setError(failure.code === 'registry_check_required'
        ? 'Para publicarla, verifica la aerolínea en el registro público (check verde) o marca la verificación manual con su fuente.'
        : failure.message);
      return false;
    }
  }

  const pendingValidations = overview?.pendingRequests ?? 0;
  const active = MODULE_INFO[moduleId] ?? MODULE_INFO.home;
  return <ShellFrame
      mainKey={moduleId}
      sidebarProps={{ modules, activeModuleId: moduleId, onSelectModule: id => { setModuleId(id); setNotice(''); sidebar.closeOverlay(); },
        badgeCounts: { home: tasks.length, validations: pendingValidations }, user, onLogout,
        breakpoint: sidebar.breakpoint, railVisible: sidebar.railVisible, railExpanded: sidebar.railExpanded,
        overlayOpen: sidebar.overlayOpen, onToggle: sidebar.toggle, onCloseOverlay: sidebar.closeOverlay }}
      topbarProps={{ station: station(), notificationsEnabled: false, theme, onToggleTheme: toggleTheme, user, onOpenMenu: sidebar.toggle, onLogout }}>
        <div className="mx-auto max-w-[1400px] space-y-5 3xl:max-w-[1760px]">
          {!['internal', 'validations'].includes(moduleId) && (
            <header className="flex flex-wrap items-end justify-between gap-3">
              <div className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">Gobernanza / AVIAM</p>
                <h1 className="mt-1 text-2xl font-bold sm:text-3xl">{active.label}</h1>
                <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{active.description}</p></div>
              <button type="button" onClick={refresh} className="rounded-lg border border-black/10 px-4 py-2 text-sm font-semibold dark:border-white/10">Actualizar</button>
            </header>
          )}
          {moduleId === 'internal' && (
            <header className="min-w-0"><p className="text-xs font-bold uppercase tracking-[.18em] text-signal-500">Gobernanza / Usuarios</p>
              <h1 className="mt-1 text-2xl font-bold sm:text-3xl">Usuarios internos</h1>
              <p className="mt-1 text-sm text-text-secondary-light dark:text-text-secondary-dark">{active.description}</p></header>
          )}
          {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
          {error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</div>}
          {moduleId === 'internal' && <InternalUsersPanel />}
          {moduleId === 'clients' && <ClientsPanel />}
          {moduleId === 'validations' && <AccessValidationsPage />}
          {status === 'loading' && !['internal', 'clients', 'validations'].includes(moduleId) ? <div className="rounded-xl bg-white p-8 dark:bg-surface-dark-card">Cargando gobernanza…</div> : null}
          {status === 'ready' && moduleId === 'home' && <GovernanceHome snapshot={snapshot} tasks={tasks} overview={overview}
            onOpen={setModuleId} run={run} />}
          {status === 'ready' && moduleId === 'airlines' && <AirlinesPanel airlines={airlines}
            onSave={(id, values) => run(() => saveManagedAirline(id, values), 'Aerolínea guardada.')}
            onArchive={(id, version) => run(() => archiveManagedAirline(id, version), 'Aerolínea archivada.')}
            onEnrich={() => run(enrichManagedAirlines, 'Fichas históricas sin edición manual revisadas.')}
            onCheckRegistry={async id => { const result = await checkManagedAirlineRegistry(id); await refresh(); return result; }} />}
          {status === 'ready' && moduleId === 'settings' && <GovernanceSettings snapshot={snapshot} run={run} />}
        </div>
  </ShellFrame>;
}

function GovernanceHome({ snapshot, tasks, overview, onOpen, run }) {
  const activeUsers = snapshot.users.filter(item => item.status === 'Active').length;
  const cards = [
    ['Cuentas activas', activeUsers, null],
    ['Pendientes de validar', overview?.pendingRequests ?? 0, 'validations'],
    ['Por aprovisionar', tasks.length, null],
  ];
  return <>
    <div className="grid gap-4 md:grid-cols-3">
      {cards.map(([label, value, target]) => {
        const content = <>
          <p className="text-xs font-semibold uppercase tracking-widest text-text-secondary-light">{label}</p>
          <strong className="mt-4 block text-4xl font-bold text-accent-600">{value}</strong>
        </>;
        return target
          ? <button key={label} type="button" onClick={() => onOpen(target)} className="rounded-2xl border border-black/5 bg-white p-6 text-left transition hover:border-accent-600/40 dark:border-white/5 dark:bg-surface-dark-card">{content}</button>
          : <div key={label} className="rounded-2xl border border-black/5 bg-white p-6 dark:border-white/5 dark:bg-surface-dark-card">{content}</div>;
      })}
    </div>
    <section className="rounded-2xl border border-black/5 bg-white p-5 dark:border-white/5 dark:bg-surface-dark-card">
      <h2 className="text-xl font-bold">Solicitudes aprobadas para crear acceso</h2>
      <p className="mt-1 text-sm text-text-secondary-light">La cuenta usa los datos del representante validados por Contratos. Ingrese el correo y una contraseña temporal; entregue ambos por un canal manual autorizado.</p>
      {tasks.length ? <div className="mt-5 grid gap-4 lg:grid-cols-2">{tasks.map(task =>
        <ProvisioningCard key={task.requestId} task={task} run={run} />)}</div> :
        <p className="mt-6 rounded-xl bg-black/[.035] p-5 text-sm dark:bg-white/[.04]">No hay cuentas pendientes de crear.</p>}
    </section>
  </>;
}

function ProvisioningCard({ task, run }) {
  const [email, setEmail] = useState(task.suggestedEmail);
  const [password, setPassword] = useState('');
  const [manual, setManual] = useState(false);
  const [busy, setBusy] = useState(false);
  async function submit(event) {
    event.preventDefault(); setBusy(true);
    const saved = await run(() => provisionAirline(task.requestId, email, manual ? password : ''),
      manual ? `Cuenta de ${task.airline} creada. Entregue las credenciales manualmente; el primer ingreso exige cambiar la contraseña.`
        : `Cuenta de ${task.airline} creada. Enviamos a ${email} un enlace de activación válido por 72 horas.`);
    if (saved) setPassword('');
    setBusy(false);
  }
  return <form onSubmit={submit} className="rounded-xl border border-accent-600/20 bg-accent-600/[.035] p-5">
    <div className="flex items-center justify-between gap-3"><strong>{task.airline}</strong><span className="text-xs font-mono text-text-secondary-light">{task.reference.slice(0, 12)}</span></div>
    <p className="mt-1 text-sm text-text-secondary-light">Representante: {task.representativeName}</p>
    <label className="mt-4 block text-xs font-semibold">Correo de acceso<input type="email" required value={email} onChange={event => setEmail(event.target.value)} className="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" /></label>
    <label className="mt-3 flex items-center gap-2 text-xs"><input type="checkbox" checked={manual} onChange={event => setManual(event.target.checked)} /> Entregar una contraseña temporal en lugar de la invitación por correo</label>
    {manual && <PasswordField fieldClassName="mt-3 text-xs font-semibold" inputClassName="mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark" label="Contraseña temporal" id={`provision-password-${task.requestId}`} required minLength={14} value={password} onChange={event => setPassword(event.target.value)} autoComplete="new-password" />}
    <button disabled={busy} className="mt-4 rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{busy ? 'Creando…' : manual ? 'Crear credenciales' : 'Crear y enviar invitación'}</button>
  </form>;
}

function LegacyRoles({ run }) {
  const [roles, setRoles] = useState(null);
  const [error, setError] = useState('');
  const [converting, setConverting] = useState(null);
  const load = useCallback(async () => {
    try { setRoles(await listLegacyRoles()); setError(''); } catch (failure) { setError(failure.message); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  return <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card">
    <h2 className="text-lg font-bold">Roles heredados</h2>
    <p className="mt-1 text-sm text-text-secondary-light">Roles personalizados anteriores al modelo por departamentos. Sus usuarios ya operan como sub-usuarios de Contratos; conviértalos en plantillas para administrarlos desde allí.</p>
    {error && <p role="alert" className="mt-3 text-sm text-status-danger">{error}</p>}
    {!roles ? !error && <p className="mt-4 text-sm">Cargando…</p> : roles.length === 0 ? <p className="mt-4 rounded-lg bg-black/[.03] p-4 text-sm dark:bg-white/[.04]">No quedan roles heredados.</p> :
      <ul className="mt-4 space-y-2">{roles.map(role => <li key={role.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-black/10 p-4 dark:border-white/10">
        <div className="min-w-0"><strong>{role.name}</strong><p className="text-xs text-text-secondary-light">{role.activeUsers} usuario(s) activos · {role.permissions.join(' · ')}</p></div>
        <button type="button" onClick={() => setConverting(role)} className="rounded-lg border border-accent-600 px-3 py-1.5 text-xs font-semibold text-accent-600">Convertir en plantilla de Contratos</button>
      </li>)}</ul>}
    <ConfirmDialog open={Boolean(converting)} title="Convertir rol heredado"
      description={`«${converting?.name ?? ''}» pasará a ser una plantilla de Contratos y sus ${converting?.activeUsers ?? 0} usuario(s) la usarán. El rol heredado quedará inactivo.`}
      confirmLabel="Convertir" onClose={() => setConverting(null)}
      onConfirm={async () => { const role = converting; setConverting(null); await run(() => convertLegacyRole(role.id), 'Rol convertido en plantilla de Contratos.'); await load(); }} />
  </section>;
}

function GovernanceSettings({ snapshot, run }) {
  const [page, setPage] = useState(1);
  const [audit, setAudit] = useState(null);
  const [auditError, setAuditError] = useState('');
  useEffect(() => {
    let active = true;
    getGovernanceAudit(page).then(result => { if (active) { setAudit(result); setAuditError(''); } })
      .catch(error => { if (active) setAuditError(error.message); });
    return () => { active = false; };
  }, [page, snapshot]);
  return <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
    <div className="space-y-5">
      <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card"><h2 className="text-lg font-bold">Política de acceso</h2><dl className="mt-4 space-y-3 text-sm"><div className="flex justify-between gap-3"><dt>Superadministrador</dt><dd className="font-semibold">Único e intransferible</dd></div><div className="flex justify-between gap-3"><dt>Altas de los departamentos</dt><dd className="font-semibold">Validadas por Gestión Humana</dd></div><div className="flex justify-between gap-3"><dt>Contraseña temporal</dt><dd className="font-semibold">Cambio obligatorio al ingresar</dd></div><div className="flex justify-between gap-3"><dt>Longitud mínima</dt><dd className="font-semibold">14 caracteres</dd></div><div className="flex justify-between gap-3"><dt>Bloqueo</dt><dd className="font-semibold">5 intentos / 15 minutos</dd></div><div className="flex justify-between gap-3"><dt>Entrega de credenciales</dt><dd className="font-semibold">Manual, sin correo automático</dd></div></dl></section>
      <LegacyRoles run={run} />
    </div>
    <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card"><h2 className="text-lg font-bold">Auditoría</h2>{auditError && <p role="alert" className="mt-3 text-sm text-status-danger">{auditError}</p>}<div className="mt-4 max-h-[560px] space-y-3 overflow-auto">{(audit?.entries ?? snapshot.recentAudit).length ? (audit?.entries ?? snapshot.recentAudit).map((item, index) => <div key={`${item.at}-${index}`} className="border-b border-black/5 pb-3 text-sm dark:border-white/5"><p className="font-semibold">{item.action}</p><p className="text-xs text-text-secondary-light">{new Date(item.at).toLocaleString('es-DO')} · {item.actor} · {item.entityType}</p>{item.changes?.length > 0 && <ul className="mt-2 space-y-1 text-xs">{item.changes.map(change => <li key={change.field}><strong>{change.field}</strong>: {change.before ?? '—'} → {change.after ?? '—'}</li>)}</ul>}</div>) : <p className="text-sm text-text-secondary-light">No hay cambios registrados.</p>}</div><div className="mt-4 flex items-center gap-3 text-sm"><button type="button" disabled={page <= 1} onClick={() => setPage(current => current - 1)} className="rounded border px-3 py-1 disabled:opacity-50">Anterior</button><span>Página {page}</span><button type="button" disabled={!audit?.hasMore} onClick={() => setPage(current => current + 1)} className="rounded border px-3 py-1 disabled:opacity-50">Siguiente</button></div></section>
    <section className="rounded-xl border border-black/5 bg-white p-6 dark:bg-surface-dark-card lg:col-span-2"><h2 className="text-lg font-bold">Actividad por departamento</h2><p className="mt-1 text-sm text-text-secondary-light">Inicios de sesión, cambios de acceso y operación del personal, filtrables por departamento.</p><div className="mt-4"><ActivityPanel load={listAudit} departmentFilter /></div></section>
  </div>;
}
