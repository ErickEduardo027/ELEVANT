import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import { ChecklistIcon } from '../shell/components/icons';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import { governanceMessage } from '../../services/humanResourcesEmployeesService';
import { fieldClass } from './EmployeeForms';

const ACTION_LABELS = {
  'auth.session.created': 'Inició sesión',
  'auth.session.failed': 'Intento de inicio de sesión fallido',
  'hr.employee.created': 'Registró un empleado',
  'hr.employee.updated': 'Actualizó un expediente',
  'hr.employee.transferred': 'Trasladó un empleado',
  'hr.employee.terminated': 'Dio de baja a un empleado',
  'hr.employee.registered': 'Registró el expediente de una cuenta existente',
  'hr.position.created': 'Creó un puesto',
  'hr.position.updated': 'Actualizó un puesto',
  'hr.requisition.created': 'Pidió personal',
  'hr.requisition.status_changed': 'Cambió una requisición',
  'hr.ramp_profile.created': 'Creó un perfil de rampa',
  'hr.ramp_profile.updated': 'Actualizó un perfil de rampa',
  'governance.access_request.requested': 'Solicitó un acceso',
  'governance.access_request.validated': 'Validó un acceso',
  'governance.access_request.rejected': 'Rechazó un acceso',
  'governance.access_request.cancelled': 'Canceló una solicitud de acceso',
  'governance.department_user.created': 'Creó una cuenta',
  'governance.department_user.administrator_created': 'Nombró un administrador',
  'governance.department_user.updated': 'Editó un usuario',
  'governance.department_user.deactivated': 'Desactivó una cuenta',
  'governance.department_user.reactivated': 'Reactivó una cuenta',
  'governance.department_user.password_reset': 'Restableció una contraseña',
  'governance.access_profile.created': 'Creó una plantilla',
  'governance.access_profile.updated': 'Editó una plantilla',
  'governance.access_profile.deactivated': 'Desactivó una plantilla',
  'governance.position.suggested_profile_set': 'Cambió el perfil sugerido de un puesto',
};
const CATEGORIES = { '': 'Todo', login: 'Inicios de sesión', governance: 'Usuarios y accesos', operation: 'Operación' };
const isoDate = date => date.toISOString().slice(0, 10);

export const actionLabel = action => ACTION_LABELS[action] ?? action;

/**
 * Audit trail reader shared by Human Resources, department administrators and the super administrator.
 * <paramref name="load"/> receives the filters plus the paging cursor and returns an ActivityPage.
 */
export default function ActivityPanel({ load, departmentFilter = false }) {
  const now = new Date();
  const [filters, setFilters] = useState({ from: isoDate(new Date(now.getTime() - 7 * 86400000)), to: isoDate(now), category: '', department: '' });
  const [entries, setEntries] = useState(null);
  const [cursor, setCursor] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const range = useCallback(() => ({
    from: new Date(`${filters.from}T00:00:00`).toISOString(),
    to: new Date(new Date(`${filters.to}T00:00:00`).getTime() + 86400000).toISOString(),
    category: filters.category || undefined, department: filters.department || undefined,
  }), [filters]);

  const read = useCallback(async () => {
    setBusy(true);
    try {
      const page = await load(range());
      setEntries(page.entries);
      setCursor(page.nextCursor);
      setError('');
    } catch (failure) {
      setEntries([]);
      setError(failure?.status === 403 ? 'El periodo no puede superar 90 días o no tiene acceso a esta actividad.' : governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }, [load, range]);
  useEffect(() => { void read(); }, [read]);

  async function more() {
    setBusy(true);
    try {
      const page = await load({ ...range(), cursor });
      setEntries(current => [...current, ...page.entries]);
      setCursor(page.nextCursor);
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4" aria-label="Actividad">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold">Desde<input type="date" value={filters.from} max={filters.to} onChange={event => setFilters(current => ({ ...current, from: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Hasta<input type="date" value={filters.to} min={filters.from} onChange={event => setFilters(current => ({ ...current, to: event.target.value }))} className={fieldClass} /></label>
        <label className="text-xs font-semibold">Tipo<select value={filters.category} onChange={event => setFilters(current => ({ ...current, category: event.target.value }))} className={fieldClass}>
          {Object.entries(CATEGORIES).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {departmentFilter && <label className="text-xs font-semibold">Departamento<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>}
      </div>
      {error && <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
      {!entries ? <p role="status" className="text-sm">Cargando actividad…</p> : entries.length === 0 ? (
        <EmptyState icon={ChecklistIcon} title="Sin actividad" description="No hay movimientos en el periodo elegido." />
      ) : (
        <ol className="divide-y divide-black/5 rounded-xl border border-black/5 bg-white dark:divide-white/5 dark:border-white/5 dark:bg-surface-dark-card">
          {entries.map(entry => (
            <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
              <div className="min-w-0">
                <strong>{entry.actorName ?? 'Sistema'}</strong> · {actionLabel(entry.action)}
                <span className="block text-xs text-text-secondary-light">
                  {entry.department ? DEPARTMENT_LABELS[entry.department] : ''}{entry.stationCode ? ` · ${entry.stationCode}` : ''}
                  {entry.reason ? ` · ${entry.reason}` : ''}
                </span>
              </div>
              <time className="text-xs tabular-nums text-text-secondary-light" dateTime={entry.occurredAt}>{new Date(entry.occurredAt).toLocaleString('es-DO')}</time>
            </li>
          ))}
        </ol>
      )}
      {cursor && <button type="button" disabled={busy} onClick={() => void more()} className="min-h-[40px] rounded-lg border px-4 text-sm font-semibold disabled:opacity-60">Cargar más</button>}
    </section>
  );
}
