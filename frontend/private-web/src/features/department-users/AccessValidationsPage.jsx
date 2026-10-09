import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import FilterBar from '../../components/FilterBar';
import Modal from '../../components/Modal';
import PageHeader from '../../components/PageHeader';
import { ShieldCheckIcon } from '../shell/components/icons';
import { useDepartmentAccess } from '../access/DepartmentAccessContext';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import {
  DEPARTMENT_LABELS,
  getPermissionCatalog,
  listAccessRequests,
  rejectAccessRequest,
  validateAccessRequest,
} from '../../services/departmentGovernanceService';
import AccessRequestCard from './AccessRequestCard';
import GeneratePasswordField from './GeneratePasswordField';
import { governanceMessage } from '../../services/humanResourcesEmployeesService';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

/**
 * Human Resources (and the super administrator) resolve the accounts that
 * department administrators request: validating creates the account with the
 * temporary password typed here; rejecting returns the reason to the requester.
 */
export default function AccessValidationsPage() {
  const { access } = useDepartmentAccess();
  const canDecide = Boolean(access?.canValidateAccessRequests || access?.isSuperAdministrator);
  const [filters, setFilters] = useState({ status: 'Pending', department: '' });
  const [state, setState] = useState({ status: 'loading', page: null, catalogs: [], error: '' });
  const [deciding, setDeciding] = useState(null);
  const [password, setPassword] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const version = useRef(0);

  const refresh = useCallback(async () => {
    const current = ++version.current;
    try {
      const [page, catalogs] = await Promise.all([
        listAccessRequests({ status: filters.status || undefined, department: filters.department || undefined, limit: 50 }),
        getPermissionCatalog(),
      ]);
      if (current !== version.current) return;
      setState({ status: 'ready', page, catalogs, error: '' });
    } catch (failure) {
      if (current !== version.current) return;
      setState(previous => ({ ...previous, status: previous.page ? 'ready' : 'error', error: failure.message }));
    }
  }, [filters]);

  useEffect(() => {
    void refresh();
    return () => { version.current += 1; };
  }, [refresh]);

  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('access_requests')) void refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      void observer.stop();
    };
  }, [refresh]);

  function open(request, kind) {
    setDeciding({ request, kind });
    setPassword('');
    setReason('');
    setError('');
  }

  async function decide(event) {
    event.preventDefault();
    const { request, kind } = deciding;
    setBusy(true);
    setError('');
    try {
      if (kind === 'validate') await validateAccessRequest(request.id, password, request.version);
      else await rejectAccessRequest(request.id, reason.trim(), request.version);
      setDeciding(null);
      setNotice(kind === 'validate'
        ? `Cuenta de ${request.firstName} ${request.lastName} creada. Entregue la contraseña temporal por un canal autorizado; se pedirá cambiarla al ingresar.`
        : `Solicitud de ${request.firstName} ${request.lastName} rechazada. El administrador verá el motivo.`);
      await refresh();
    } catch (failure) {
      setError(failure.status === 403
        ? 'No puede resolver una solicitud que usted mismo envió.'
        : governanceMessage(failure, 'La solicitud cambió, ya fue resuelta o el correo ya existe. Se actualizó la bandeja.'));
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const requests = state.page?.requests ?? [];
  const catalogOf = department => state.catalogs.find(item => item.department === department) ?? null;

  return (
    <div className="mx-auto w-full max-w-[1400px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Gestión Humana" title="Validaciones de acceso"
        description="Altas solicitadas por los administradores de cada departamento. Valide definiendo la contraseña temporal o rechace con un motivo." />
      {notice && <div role="status" className="rounded-lg border border-status-success/30 bg-status-success/10 p-3 text-sm">{notice}</div>}
      {state.status === 'ready' && state.error && <div role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{state.error}</div>}
      <FilterBar>
        <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={fieldClass}>
          <option value="Pending">Pendientes</option><option value="Validated">Validadas</option><option value="Rejected">Rechazadas</option><option value="Cancelled">Canceladas</option><option value="">Todas</option>
        </select></label>
        <label className="text-xs font-semibold">Departamento<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.entries(DEPARTMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
        </select></label>
      </FilterBar>
      {state.status === 'loading' && <p role="status" className="rounded-xl bg-white p-6 text-sm dark:bg-surface-dark-card">Cargando solicitudes…</p>}
      {state.status === 'error' && (
        <div role="alert" className="rounded-xl border border-status-danger/30 bg-white p-6 text-sm dark:bg-surface-dark-card">
          <p>{state.error}</p>
          <button type="button" onClick={() => void refresh()} className="mt-3 rounded-lg border px-3 py-1.5">Reintentar</button>
        </div>
      )}
      {state.status === 'ready' && (requests.length === 0 ? (
        <EmptyState icon={ShieldCheckIcon} title="Sin solicitudes" description="No hay solicitudes con este filtro." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 2xl:grid-cols-3">
          {requests.map(request => (
            <AccessRequestCard key={request.id} request={request} catalog={catalogOf(request.department)} showDepartment>
              {canDecide && request.status === 'Pending' && (
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => open(request, 'validate')} className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Validar</button>
                  <button type="button" onClick={() => open(request, 'reject')} className="min-h-[40px] rounded-lg border border-status-danger/40 px-4 text-sm font-semibold text-status-danger">Rechazar</button>
                </div>
              )}
            </AccessRequestCard>
          ))}
        </div>
      ))}
      <Modal open={Boolean(deciding)} onClose={() => setDeciding(null)} tone={deciding?.kind === 'reject' ? 'danger' : 'default'}
        title={deciding?.kind === 'validate'
          ? `Validar a ${deciding?.request.firstName ?? ''} ${deciding?.request.lastName ?? ''}`
          : `Rechazar a ${deciding?.request.firstName ?? ''} ${deciding?.request.lastName ?? ''}`}
        footer={<div className="flex justify-end gap-2">
          <button type="button" onClick={() => setDeciding(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="access-decision-form" disabled={busy} className={`rounded-lg px-4 py-2 text-sm font-semibold text-white disabled:opacity-60 ${deciding?.kind === 'reject' ? 'bg-status-danger' : 'bg-accent-600'}`}>
            {busy ? 'Guardando…' : deciding?.kind === 'validate' ? 'Validar y crear cuenta' : 'Rechazar solicitud'}
          </button>
        </div>}>
        <form id="access-decision-form" onSubmit={decide} className="space-y-3">
          {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-sm text-status-danger">{error}</p>}
          {deciding?.kind === 'validate' ? (
            <>
              <p className="text-sm text-text-secondary-light dark:text-text-secondary-dark">La cuenta se crea con {deciding.request.kind === 'RampAgent' ? 'acceso a la app móvil de rampa y su perfil operativo' : 'los permisos solicitados'}. El usuario deberá cambiar la contraseña en su primer ingreso.</p>
              <GeneratePasswordField fieldClassName="text-sm font-semibold" inputClassName={fieldClass} id="access-validation-password"
                value={password} onChange={setPassword} />
            </>
          ) : (
            <label className="block text-sm font-semibold">Motivo del rechazo
              <textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} className={fieldClass} />
            </label>
          )}
        </form>
      </Modal>
    </div>
  );
}
