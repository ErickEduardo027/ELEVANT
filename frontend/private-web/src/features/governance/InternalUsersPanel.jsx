import { useCallback, useEffect, useRef, useState } from 'react';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { DEPARTMENTS, getDepartmentsOverview } from '../../services/departmentGovernanceService';
import DepartmentUsersPage from '../department-users/DepartmentUsersPage';
import InternalUserDrawer from './InternalUserDrawer';
import { CalendarIcon, ChevronDownIcon, ShieldCheckIcon, UsersIcon, LayoutGridIcon } from '../shell/components/icons';

const DEPARTMENT_ICONS = {
  [DEPARTMENTS.HUMAN_RESOURCES]: UsersIcon,
  [DEPARTMENTS.CONTRACTS]: ShieldCheckIcon,
  [DEPARTMENTS.OPERATIONS]: CalendarIcon,
  [DEPARTMENTS.FINANCE]: LayoutGridIcon,
};

function Count({ label, value, accent }) {
  return (
    <div className="flex items-baseline justify-between gap-2 border-t border-black/5 py-1.5 text-sm first:border-t-0 dark:border-white/5">
      <dt className="text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
      <dd className={`font-semibold tabular-nums ${accent && value > 0 ? accent : 'text-ink-900 dark:text-text-primary-dark'}`}>{value}</dd>
    </div>
  );
}

function DepartmentCard({ summary, onOpen }) {
  const Icon = DEPARTMENT_ICONS[summary.department] ?? UsersIcon;
  return (
    <button type="button" onClick={() => onOpen(summary.department)}
      className="group flex h-full flex-col rounded-2xl border border-black/5 bg-white p-5 text-left shadow-sm transition hover:border-accent-600/40 hover:shadow-md focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent-600 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex items-center gap-3">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-accent-600/10 text-accent-600"><Icon className="h-5 w-5" /></span>
        <div className="min-w-0 flex-1">
          <h3 className="truncate text-base font-bold">{summary.label}</h3>
          <p className="text-xs text-text-secondary-light dark:text-text-secondary-dark">{summary.administrators + summary.members + summary.rampAgents} usuarios activos</p>
        </div>
        <ChevronDownIcon className="h-4 w-4 -rotate-90 text-text-secondary-light transition-transform group-hover:translate-x-0.5" />
      </div>
      <dl className="mt-4">
        <Count label="Administradores" value={summary.administrators} />
        <Count label="Sub-usuarios" value={summary.members} />
        {summary.department === DEPARTMENTS.OPERATIONS && <Count label="Agentes de rampa" value={summary.rampAgents} />}
        <Count label="Inactivos" value={summary.inactive} accent="text-status-warning" />
        <Count label="Pendientes de validar" value={summary.pendingRequests} accent="text-status-warning" />
        <Count label="Pendientes de primer acceso" value={summary.pendingFirstLogin} accent="text-accent-600" />
        <Count label="Plantillas activas" value={summary.activeProfiles} />
      </dl>
    </button>
  );
}

/** Super administrator view of every internal user, grouped by department. */
export default function InternalUsersPanel() {
  const [department, setDepartment] = useState(null);
  const [creating, setCreating] = useState(false);
  const [notice, setNotice] = useState('');
  const [state, setState] = useState({ status: 'loading', overview: null, error: '' });
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const overview = await getDepartmentsOverview();
      if (current === version.current) setState({ status: 'ready', overview, error: '' });
    } catch (failure) {
      if (current === version.current) setState(previous => ({ ...previous, status: previous.overview ? 'ready' : 'error', error: failure.message }));
    }
  }, []);

  useEffect(() => {
    void refresh();
    return () => { version.current += 1; };
  }, [refresh, department]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.some(resource => ['department_users', 'access_requests'].includes(resource))) void refresh();
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [refresh]);

  if (department) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setDepartment(null)} className="inline-flex min-h-[40px] items-center gap-1.5 text-sm font-semibold text-accent-600">
          <ChevronDownIcon className="h-3.5 w-3.5 rotate-90" /> Todos los departamentos
        </button>
        <DepartmentUsersPage department={department} />
      </div>
    );
  }

  const overview = state.overview;
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="max-w-2xl text-sm text-text-secondary-light dark:text-text-secondary-dark">Crea el expediente y la cuenta de un empleado interno en un solo paso, con permisos por opción y subventana.</p>
        <button type="button" onClick={() => { setNotice(''); setCreating(true); }}
          className="min-h-[40px] rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Nuevo usuario interno</button>
      </div>
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      <InternalUserDrawer open={creating} onClose={() => setCreating(false)}
        onCreated={(_, message) => { setCreating(false); setNotice(message); void refresh(); }} />
      {state.status === 'loading' && <p role="status" className="rounded-xl bg-white p-6 text-sm dark:bg-surface-dark-card">Cargando usuarios internos…</p>}
      {state.status === 'error' && (
        <div role="alert" className="rounded-xl border border-status-danger/30 bg-white p-6 text-sm dark:bg-surface-dark-card">
          <p>{state.error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-3 rounded-lg border px-3 py-1.5">Reintentar</button>
        </div>
      )}
      {overview && (
        <>
          <dl className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            {[['Usuarios internos activos', overview.totalInternalUsers], ['Administradores', overview.administrators],
              ['Sub-usuarios', overview.members], ['Pendientes de validar en G.H.', overview.pendingRequests, true]].map(([label, value, warn]) => (
              <div key={label} className="rounded-2xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
                <dt className="text-[11px] font-semibold uppercase tracking-wide text-text-secondary-light dark:text-text-secondary-dark">{label}</dt>
                <dd className={`mt-1 text-3xl font-bold tabular-nums ${warn && value > 0 ? 'text-status-warning' : 'text-accent-600'}`}>{value}</dd>
              </div>
            ))}
          </dl>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 2xl:grid-cols-4">
            {overview.departments.map(summary => <DepartmentCard key={summary.department} summary={summary} onOpen={setDepartment} />)}
          </div>
        </>
      )}
    </div>
  );
}
