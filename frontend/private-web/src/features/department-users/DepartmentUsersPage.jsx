import { useEffect, useMemo, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import FilterBar from '../../components/FilterBar';
import Modal from '../../components/Modal';
import PageHeader from '../../components/PageHeader';
import PasswordField from '../../components/PasswordField';
import StackedTable from '../../components/StackedTable';
import StatusBadge from '../../components/StatusBadge';
import Tabs from '../../components/Tabs';
import { UsersIcon } from '../shell/components/icons';
import { useDepartmentAccess } from '../access/DepartmentAccessContext';
import {
  cancelAccessRequest,
  DEPARTMENT_LABELS,
  DEPARTMENTS,
  resetDepartmentUserPassword,
  setDepartmentUserStatus,
} from '../../services/departmentGovernanceService';
import AccessRequestCard from './AccessRequestCard';
import AccountFormDrawer from './AccountFormDrawer';
import { permissionLabels } from './PermissionMatrix';
import ProfilesPanel from './ProfilesPanel';
import RampProfilesPanel from '../human-resources/users/RampProfilesPanel';
import {
  KIND_LABELS,
  PASSWORD_HINT,
  PASSWORD_PATTERN,
  STATUS_LABELS,
  useDepartmentGovernance,
} from './useDepartmentGovernance';

const selectClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function SummaryStrip({ summary, department }) {
  const items = [
    ['Administradores', summary.administrators],
    ['Sub-usuarios', summary.members],
    ...(department === DEPARTMENTS.OPERATIONS ? [['Agentes de rampa', summary.rampAgents]] : []),
    ['Inactivos', summary.inactive, 'warning'],
    ['Pendientes de validar', summary.pendingRequests, 'warning'],
    ['Pendientes de primer acceso', summary.pendingFirstLogin, 'info'],
    ['Plantillas activas', summary.activeProfiles],
  ];
  return (
    <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-7">
      {items.map(([label, value, tone]) => (
        <div key={label} className="rounded-xl border border-black/5 bg-white px-3 py-2.5 dark:border-white/5 dark:bg-surface-dark-card">
          <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
          <dd className={`mt-0.5 text-xl font-bold ${tone && value > 0 ? (tone === 'warning' ? 'text-status-warning' : 'text-accent-600') : 'text-ink-900 dark:text-text-primary-dark'}`}>{value}</dd>
        </div>
      ))}
    </dl>
  );
}

function UsersTable({ users, catalog, canManage, onEdit, onReset, onToggle }) {
  if (users.length === 0) {
    return <EmptyState icon={UsersIcon} title="Sin usuarios" description="No hay usuarios que coincidan con los filtros." />;
  }
  return (
    <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
      <table className="table-stack w-full min-w-[640px] text-left text-sm">
        <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03] dark:text-text-secondary-dark">
          <tr><th className="p-3">Usuario</th><th className="p-3">Tipo</th><th className="p-3">Permisos</th><th className="p-3">Estaciones</th><th className="p-3">Estado</th><th className="p-3">Acciones</th></tr>
        </thead>
        <tbody>
          {users.map(user => {
            const manageable = canManage(user);
            const permissions = user.kind === 'Administrator' ? ['Todos los módulos del departamento']
              : user.kind === 'RampAgent' ? ['App móvil de rampa']
                : user.accessProfileName ? [`Plantilla: ${user.accessProfileName}`] : permissionLabels(catalog, user.permissions);
            return (
              <tr key={user.id} className="border-t border-black/5 align-top dark:border-white/5">
                <td className="p-3"><strong>{user.firstName} {user.lastName}</strong><span className="block text-xs text-text-secondary-light">{user.email}</span></td>
                <td className="p-3">{KIND_LABELS[user.kind] ?? user.kind}</td>
                <td className="p-3 text-xs">{permissions.length ? permissions.map(label => <span key={label} className="block">{label}</span>) : <span className="text-status-warning">Sin permisos</span>}</td>
                <td className="p-3 text-xs">{user.stations.map(station => station.code).join(', ') || '—'}</td>
                <td className="p-3">
                  <StatusBadge tone={user.status === 'Active' ? 'success' : 'neutral'} label={STATUS_LABELS[user.status] ?? user.status} />
                  {user.mustChangePassword && <span className="block text-xs text-signal-500">Pendiente de primer acceso</span>}
                </td>
                <td className="p-3">
                  {manageable ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                      <button type="button" onClick={() => onEdit(user)} className="min-h-[32px] text-accent-600">Editar</button>
                      <button type="button" onClick={() => onReset(user)} className="min-h-[32px] text-accent-600">Restablecer clave</button>
                      <button type="button" onClick={() => onToggle(user)} className={`min-h-[32px] ${user.status === 'Active' ? 'text-status-danger' : 'text-status-success'}`}>
                        {user.status === 'Active' ? 'Desactivar' : 'Reactivar'}
                      </button>
                    </div>
                  ) : <span className="text-xs text-text-secondary-light">Gestionado por Superadministración</span>}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </StackedTable>
  );
}

/**
 * User administration of one department. Department administrators request new
 * accounts (validated by Human Resources) and manage their members; the super
 * administrator also creates administrators and members directly.
 */
export default function DepartmentUsersPage({ department }) {
  const { access } = useDepartmentAccess();
  const superAdministrator = Boolean(access?.isSuperAdministrator);
  const [tab, setTab] = useState('users');
  const [filters, setFilters] = useState({ search: '', kind: '', status: '', accessProfileId: '' });
  const [search, setSearch] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setFilters(current => (current.search === search ? current : { ...current, search })), 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const data = useDepartmentGovernance(department, filters);
  const [drawer, setDrawer] = useState(null);
  const [resetting, setResetting] = useState(null);
  const [password, setPassword] = useState('');
  const [toggling, setToggling] = useState(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const label = DEPARTMENT_LABELS[department] ?? department;

  const pendingRequests = useMemo(() => (data.requests?.requests ?? []).filter(item => item.status === 'Pending'), [data.requests]);

  function done(message) {
    setNotice(message);
    setError('');
    void data.refresh();
  }

  async function act(action, message) {
    setError('');
    try { await action(); done(message); return true; } catch (failure) {
      setError(failure.status === 409 ? 'El registro cambió. Actualice la lista antes de repetir la acción.' : failure.message);
      void data.refresh();
      return false;
    }
  }

  const canManage = user => user.id !== undefined && (superAdministrator || user.kind !== 'Administrator');

  const actions = superAdministrator ? (
    <>
      <button type="button" onClick={() => setDrawer({ mode: 'administrator' })} className="rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600">Crear administrador</button>
      <button type="button" onClick={() => setDrawer({ mode: 'member' })} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Crear sub-usuario</button>
    </>
  ) : (
    <button type="button" onClick={() => setDrawer({ mode: 'request' })} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Solicitar alta</button>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow={superAdministrator ? 'Usuarios internos' : label} title={superAdministrator ? label : 'Usuarios del departamento'}
        description={superAdministrator
          ? 'Todos los administradores, sub-usuarios y solicitudes del departamento.'
          : 'Solicite altas a Gestión Humana, administre permisos y plantillas de su equipo.'}
        actions={actions} />
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      {(error || (data.status === 'ready' && data.error)) && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error || data.error}</div>}
      {data.status === 'loading' && <p role="status" className="rounded-xl bg-white p-6 text-sm dark:bg-surface-dark-card">Cargando usuarios…</p>}
      {data.status === 'error' && (
        <div role="alert" className="rounded-xl border border-status-danger/30 bg-white p-6 text-sm dark:bg-surface-dark-card">
          <p>{data.error}</p>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 rounded-lg border px-3 py-1.5">Reintentar</button>
        </div>
      )}
      {data.status === 'ready' && (
        <>
          <SummaryStrip summary={data.summary} department={department} />
          <Tabs activeId={tab} onChange={setTab} tabs={[
            { id: 'users', label: 'Usuarios', count: data.users.total },
            { id: 'requests', label: 'Solicitudes', count: pendingRequests.length },
            { id: 'profiles', label: 'Plantillas', count: data.profiles.filter(profile => profile.isActive).length },
            ...(department === DEPARTMENTS.OPERATIONS ? [{ id: 'ramp', label: 'Perfiles operativos' }] : []),
          ]} />
          {tab === 'users' && (
            <section className="space-y-3">
              <FilterBar>
                <label className="text-xs font-semibold">Buscar<input type="search" value={search} placeholder="Nombre o correo" onChange={event => setSearch(event.target.value)} className={selectClass} /></label>
                <label className="text-xs font-semibold">Tipo<select value={filters.kind} onChange={event => setFilters(current => ({ ...current, kind: event.target.value }))} className={selectClass}>
                  <option value="">Todos</option><option value="Administrator">Administradores</option><option value="Member">Sub-usuarios</option>
                  {department === DEPARTMENTS.OPERATIONS && <option value="RampAgent">Agentes de rampa</option>}
                </select></label>
                <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={selectClass}>
                  <option value="">Todos</option><option value="Active">Activos</option><option value="Disabled">Inactivos</option>
                </select></label>
                <label className="text-xs font-semibold">Plantilla<select value={filters.accessProfileId} onChange={event => setFilters(current => ({ ...current, accessProfileId: event.target.value }))} className={selectClass}>
                  <option value="">Todas</option>{data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select></label>
              </FilterBar>
              <UsersTable users={data.users.users} catalog={data.catalog} canManage={canManage}
                onEdit={user => setDrawer({ mode: 'edit', user })}
                onReset={user => { setResetting(user); setPassword(''); }}
                onToggle={setToggling} />
              {data.users.hasMore && <p className="text-xs text-text-secondary-light">Mostrando {data.users.users.length} de {data.users.total}. Refine la búsqueda para ver el resto.</p>}
            </section>
          )}
          {tab === 'requests' && (
            <section className="space-y-3">
              {(data.requests?.requests ?? []).length === 0 ? (
                <EmptyState icon={UsersIcon} title="Sin solicitudes" description="Las altas que solicite aparecerán aquí con su estado y, si se rechazan, el motivo." />
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {data.requests.requests.map(request => (
                    <AccessRequestCard key={request.id} request={request} catalog={data.catalog}>
                      {request.status === 'Pending' && (
                        <button type="button" onClick={() => act(() => cancelAccessRequest(request.id, request.version), 'Solicitud cancelada.')}
                          className="mt-3 min-h-[36px] text-xs font-semibold text-status-danger">Cancelar solicitud</button>
                      )}
                    </AccessRequestCard>
                  ))}
                </div>
              )}
            </section>
          )}
          {tab === 'ramp' && (
            <RampProfilesPanel canEdit embedded stationFilter={superAdministrator ? null : access?.stations.map(station => station.id)} />
          )}
          {tab === 'profiles' && (
            <ProfilesPanel department={department} profiles={data.profiles} catalog={data.catalog} onChanged={done} />
          )}
        </>
      )}
      <AccountFormDrawer open={Boolean(drawer)} mode={drawer?.mode} user={drawer?.user} department={department}
        profiles={data.profiles} options={data.options} catalog={data.catalog}
        onClose={() => setDrawer(null)}
        onSaved={mode => {
          setDrawer(null);
          done(mode === 'request' ? 'Solicitud enviada. Gestión Humana la validará y entregará la contraseña temporal.'
            : mode === 'edit' ? 'Usuario actualizado.' : 'Cuenta creada. Entregue la contraseña temporal por un canal autorizado.');
          if (mode === 'request') setTab('requests');
        }} />
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title={`Restablecer clave de ${resetting?.firstName ?? ''} ${resetting?.lastName ?? ''}`}
        footer={<div className="flex justify-end gap-2">
          <button type="button" onClick={() => setResetting(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="department-reset-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Restablecer</button>
        </div>}>
        <form id="department-reset-form" onSubmit={async event => {
          event.preventDefault();
          const user = resetting;
          if (await act(() => resetDepartmentUserPassword(department, user.id, password), 'Contraseña restablecida. Entréguela por un canal autorizado; se pedirá cambiarla al ingresar.')) setResetting(null);
        }}>
          <PasswordField fieldClassName="text-sm font-semibold" inputClassName={selectClass} label="Nueva contraseña temporal" id="department-reset-password"
            required minLength={14} pattern={PASSWORD_PATTERN} title={PASSWORD_HINT} autoComplete="new-password" value={password} onChange={event => setPassword(event.target.value)} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toggling)} title={toggling?.status === 'Active' ? 'Desactivar usuario' : 'Reactivar usuario'}
        description={toggling?.status === 'Active'
          ? `${toggling?.firstName ?? ''} perderá el acceso de inmediato.`
          : `${toggling?.firstName ?? ''} recuperará el acceso con sus permisos actuales.`}
        confirmLabel={toggling?.status === 'Active' ? 'Desactivar' : 'Reactivar'}
        onClose={() => setToggling(null)}
        onConfirm={async () => {
          const user = toggling;
          setToggling(null);
          await act(() => setDepartmentUserStatus(department, user.id, user.status !== 'Active', user.version),
            user.status === 'Active' ? 'Usuario desactivado.' : 'Usuario reactivado.');
        }} />
    </div>
  );
}
