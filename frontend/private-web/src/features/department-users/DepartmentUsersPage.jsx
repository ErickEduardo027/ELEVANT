import { useEffect, useMemo, useRef, useState } from 'react';
import ConfirmDialog from '../../components/ConfirmDialog';
import EmptyState from '../../components/EmptyState';
import FilterBar from '../../components/FilterBar';
import Modal from '../../components/Modal';
import PageHeader from '../../components/PageHeader';
import StackedTable from '../../components/StackedTable';
import StatusBadge from '../../components/StatusBadge';
import Tabs from '../../components/Tabs';
import { useTranslation } from '../../i18n/LanguageScope';
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
import { departmentUsersMessages, enumLabel } from './departmentUsersMessages';
import { permissionLabels } from './PermissionMatrix';
import ProfilesPanel from './ProfilesPanel';
import GeneratePasswordField from './GeneratePasswordField';
import { DepartmentActivityPanel, DepartmentPositionsPanel, DepartmentRequisitionsPanel } from './DepartmentStaffPanels';
import RampProfilesPanel from '../human-resources/users/RampProfilesPanel';
import { useDepartmentGovernance } from './useDepartmentGovernance';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { governanceMessage } from '../../services/humanResourcesEmployeesService';

const selectClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function SummaryStrip({ summary, department }) {
  const { t } = useTranslation(departmentUsersMessages);
  const items = [
    [t('summary.administrators'), summary.administrators],
    [t('summary.members'), summary.members],
    ...(department === DEPARTMENTS.OPERATIONS ? [[t('summary.rampAgents'), summary.rampAgents]] : []),
    [t('summary.inactive'), summary.inactive, 'warning'],
    [t('summary.pendingRequests'), summary.pendingRequests, 'warning'],
    [t('summary.pendingFirstLogin'), summary.pendingFirstLogin, 'info'],
    [t('summary.activeProfiles'), summary.activeProfiles],
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
  const { t } = useTranslation(departmentUsersMessages);
  if (users.length === 0) {
    return <EmptyState icon={UsersIcon} title={t('table.emptyTitle')} description={t('table.emptyDescription')} />;
  }
  return (
    <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
      <table className="table-stack w-full min-w-[640px] text-left text-sm">
        <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03] dark:text-text-secondary-dark">
          <tr><th className="p-3">{t('table.user')}</th><th className="p-3">{t('common.type')}</th><th className="p-3">{t('table.permissions')}</th><th className="p-3">{t('common.stations')}</th><th className="p-3">{t('common.status')}</th><th className="p-3">{t('table.actions')}</th></tr>
        </thead>
        <tbody>
          {users.map(user => {
            const manageable = canManage(user);
            const permissions = user.kind === 'Administrator' ? [t('table.allModules')]
              : user.kind === 'RampAgent' ? [t('table.rampApp')]
                : user.accessProfileName ? [t('table.templatePrefix', { name: user.accessProfileName })] : permissionLabels(catalog, user.permissions);
            return (
              <tr key={user.id} className="border-t border-black/5 align-top dark:border-white/5">
                <td className="p-3"><strong>{user.firstName} {user.lastName}</strong><span className="block text-xs text-text-secondary-light">{user.email}</span></td>
                <td className="p-3">{enumLabel(t, 'kinds', user.kind)}</td>
                <td className="p-3 text-xs">{permissions.length ? permissions.map(label => <span key={label} className="block">{label}</span>) : <span className="text-status-warning">{t('table.noPermissions')}</span>}</td>
                <td className="p-3 text-xs">{user.stations.map(station => station.code).join(', ') || '—'}</td>
                <td className="p-3">
                  <StatusBadge tone={user.status === 'Active' ? 'success' : 'neutral'} label={enumLabel(t, 'statuses', user.status)} />
                  {user.mustChangePassword && <span className="block text-xs text-signal-500">{t('table.pendingFirstLogin')}</span>}
                </td>
                <td className="p-3">
                  {manageable ? (
                    <div className="flex flex-wrap gap-x-3 gap-y-1 text-xs font-semibold">
                      <button type="button" onClick={() => onEdit(user)} className="min-h-[32px] text-accent-600">{t('common.edit')}</button>
                      <button type="button" onClick={() => onReset(user)} className="min-h-[32px] text-accent-600">{t('table.resetPassword')}</button>
                      <button type="button" onClick={() => onToggle(user)} className={`min-h-[32px] ${user.status === 'Active' ? 'text-status-danger' : 'text-status-success'}`}>
                        {user.status === 'Active' ? t('common.deactivate') : t('common.reactivate')}
                      </button>
                    </div>
                  ) : <span className="text-xs text-text-secondary-light">{t('table.managedBySuperadmin')}</span>}
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
  const { t } = useTranslation(departmentUsersMessages);
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
  const statusKeys = useRef(createCommandKeyHolder());

  const pendingRequests = useMemo(() => (data.requests?.requests ?? []).filter(item => item.status === 'Pending'), [data.requests]);

  function done(message) {
    setNotice(message);
    setError('');
    void data.refresh();
  }

  async function act(action, message) {
    setError('');
    try { await action(); done(message); return true; } catch (failure) {
      setError(governanceMessage(failure, t('common.conflict')));
      void data.refresh();
      return false;
    }
  }

  const canManage = user => user.id !== undefined && (superAdministrator || user.kind !== 'Administrator');

  const actions = superAdministrator ? (
    <>
      <button type="button" onClick={() => setDrawer({ mode: 'administrator' })} className="rounded-lg border border-accent-600 px-4 py-2 text-sm font-semibold text-accent-600">{t('page.nameAdministrator')}</button>
      <button type="button" onClick={() => setDrawer({ mode: 'request' })} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{t('page.requestAccess')}</button>
    </>
  ) : (
    <button type="button" onClick={() => setDrawer({ mode: 'request' })} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{t('page.requestAccess')}</button>
  );

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow={superAdministrator ? t('page.superEyebrow') : label} title={superAdministrator ? label : t('page.title')}
        description={superAdministrator ? t('page.superDescription') : t('page.description')}
        actions={actions} />
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      {(error || (data.status === 'ready' && data.error)) && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error || data.error}</div>}
      {data.status === 'loading' && <p role="status" className="rounded-xl bg-white p-6 text-sm dark:bg-surface-dark-card">{t('page.loading')}</p>}
      {data.status === 'error' && (
        <div role="alert" className="rounded-xl border border-status-danger/30 bg-white p-6 text-sm dark:bg-surface-dark-card">
          <p>{data.error}</p>
          <button type="button" onClick={() => void data.refresh()} className="mt-3 rounded-lg border px-3 py-1.5">{t('common.retry')}</button>
        </div>
      )}
      {data.status === 'ready' && (
        <>
          <SummaryStrip summary={data.summary} department={department} />
          <Tabs activeId={tab} onChange={setTab} tabs={[
            { id: 'users', label: t('tabs.users'), count: data.users.total },
            { id: 'requests', label: t('tabs.requests'), count: pendingRequests.length },
            { id: 'profiles', label: t('tabs.profiles'), count: data.profiles.filter(profile => profile.isActive).length },
            ...(department === DEPARTMENTS.OPERATIONS ? [{ id: 'ramp', label: t('tabs.ramp') }] : []),
            { id: 'positions', label: t('tabs.positions') },
            { id: 'requisitions', label: t('tabs.requisitions') },
            { id: 'activity', label: t('tabs.activity') },
          ]} />
          {tab === 'users' && (
            <section className="space-y-3">
              <FilterBar>
                <label className="text-xs font-semibold">{t('common.search')}<input type="search" value={search} placeholder={t('filters.searchPlaceholder')} onChange={event => setSearch(event.target.value)} className={selectClass} /></label>
                <label className="text-xs font-semibold">{t('common.type')}<select value={filters.kind} onChange={event => setFilters(current => ({ ...current, kind: event.target.value }))} className={selectClass}>
                  <option value="">{t('common.all')}</option><option value="Administrator">{t('filters.administrators')}</option><option value="Member">{t('filters.members')}</option>
                  {department === DEPARTMENTS.OPERATIONS && <option value="RampAgent">{t('filters.rampAgents')}</option>}
                </select></label>
                <label className="text-xs font-semibold">{t('common.status')}<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={selectClass}>
                  <option value="">{t('common.all')}</option><option value="Active">{t('filters.active')}</option><option value="Disabled">{t('filters.inactive')}</option>
                </select></label>
                <label className="text-xs font-semibold">{t('common.template')}<select value={filters.accessProfileId} onChange={event => setFilters(current => ({ ...current, accessProfileId: event.target.value }))} className={selectClass}>
                  <option value="">{t('common.allFeminine')}</option>{data.profiles.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                </select></label>
              </FilterBar>
              <UsersTable users={data.users.users} catalog={data.catalog} canManage={canManage}
                onEdit={user => setDrawer({ mode: 'edit', user })}
                onReset={user => { setResetting(user); setPassword(''); }}
                onToggle={setToggling} />
              {data.users.hasMore && <p className="text-xs text-text-secondary-light">{t('filters.showing', { shown: data.users.users.length, total: data.users.total })}</p>}
            </section>
          )}
          {tab === 'requests' && (
            <section className="space-y-3">
              {(data.requests?.requests ?? []).length === 0 ? (
                <EmptyState icon={UsersIcon} title={t('requests.emptyTitle')} description={t('requests.emptyDescription')} />
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {data.requests.requests.map(request => (
                    <AccessRequestCard key={request.id} request={request} catalog={data.catalog}>
                      {request.status === 'Pending' && (
                        <button type="button" onClick={() => act(() => cancelAccessRequest(request.id, request.version), t('requests.cancelled'))}
                          className="mt-3 min-h-[36px] text-xs font-semibold text-status-danger">{t('requests.cancel')}</button>
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
          {tab === 'positions' && <DepartmentPositionsPanel department={department} profiles={data.profiles} />}
          {tab === 'requisitions' && <DepartmentRequisitionsPanel department={department} stations={data.options?.stations} />}
          {tab === 'activity' && <DepartmentActivityPanel department={department} />}
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
          done(mode === 'request' ? t('notices.requestSent')
            : mode === 'edit' ? t('notices.userUpdated') : t('notices.accountCreated'));
          if (mode === 'request') setTab('requests');
        }} />
      <Modal open={Boolean(resetting)} onClose={() => setResetting(null)} title={t('reset.title', { name: `${resetting?.firstName ?? ''} ${resetting?.lastName ?? ''}` })}
        footer={<div className="flex justify-end gap-2">
          <button type="button" onClick={() => setResetting(null)} className="rounded-lg border px-4 py-2 text-sm">{t('common.cancel')}</button>
          <button type="submit" form="department-reset-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">{t('reset.submit')}</button>
        </div>}>
        <form id="department-reset-form" onSubmit={async event => {
          event.preventDefault();
          const user = resetting;
          if (await act(() => resetDepartmentUserPassword(department, user.id, password), t('notices.passwordReset'))) setResetting(null);
        }}>
          <GeneratePasswordField fieldClassName="text-sm font-semibold" inputClassName={selectClass} label={t('reset.newPassword')}
            id="department-reset-password" value={password} onChange={setPassword} />
        </form>
      </Modal>
      <ConfirmDialog open={Boolean(toggling)} title={toggling?.status === 'Active' ? t('toggle.deactivateTitle') : t('toggle.reactivateTitle')}
        description={toggling?.status === 'Active'
          ? t('toggle.deactivateDescription', { name: toggling?.firstName ?? '' })
          : t('toggle.reactivateDescription', { name: toggling?.firstName ?? '' })}
        confirmLabel={toggling?.status === 'Active' ? t('common.deactivate') : t('common.reactivate')}
        onClose={() => setToggling(null)}
        onConfirm={async () => {
          const user = toggling;
          setToggling(null);
          await act(() => statusKeys.current.run('department-user.status',
            { id: user.id, active: user.status !== 'Active', version: user.version },
            key => setDepartmentUserStatus(department, user.id, user.status !== 'Active', user.version, key)),
            user.status === 'Active' ? t('notices.userDeactivated') : t('notices.userReactivated'));
        }} />
    </div>
  );
}
