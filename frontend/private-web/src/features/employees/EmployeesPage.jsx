import { useCallback, useEffect, useState } from 'react';
import Drawer from '../../components/Drawer';
import EmptyState from '../../components/EmptyState';
import FilterBar from '../../components/FilterBar';
import PageHeader from '../../components/PageHeader';
import StackedTable from '../../components/StackedTable';
import StatusBadge from '../../components/StatusBadge';
import Tabs from '../../components/Tabs';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { UsersIcon } from '../shell/components/icons';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import {
  EMPLOYEE_STATUS, getEmployee, getEmployeeOptions, governanceMessage, IDENTIFICATION_LABELS, listEmployees,
  listUnregisteredPersons,
} from '../../services/humanResourcesEmployeesService';
import { EmployeeDrawer, fieldClass, RegisterDrawer, TerminateModal, TransferModal } from './EmployeeForms';

const ACCOUNT_STATUS = { Active: { label: 'Con cuenta', tone: 'success' }, Disabled: { label: 'Cuenta inactiva', tone: 'neutral' } };

function EmployeeDetail({ employee, canManage, canTerminate, onEdit, onTransfer, onTerminate }) {
  const { summary } = employee;
  const active = summary.status === 'Active';
  return (
    <div className="space-y-4 text-sm">
      <dl className="grid grid-cols-2 gap-3">
        {[
          ['Número', summary.employeeNumber],
          ['Departamento', DEPARTMENT_LABELS[summary.department]],
          ['Puesto', summary.position.name + (summary.position.isRampPosition ? ' (rampa)' : '')],
          ['Ingreso', summary.hireDate],
          ['Documento', `${IDENTIFICATION_LABELS[employee.identificationType] ?? 'Provisional'} ${employee.identificationIsPlaceholder ? '— pendiente' : employee.identificationNumber}`],
          ['Teléfono', employee.phoneNumber ?? '—'],
          ['Correo', summary.corporateEmail ?? '—'],
          ['Estaciones', summary.stations.map(station => station.code).join(', ') || '—'],
          ['Cuenta', summary.account ? ACCOUNT_STATUS[summary.account.status]?.label ?? summary.account.status : 'Sin cuenta'],
          ['Baja', employee.terminatedOn ? `${employee.terminatedOn} · ${employee.terminationReason}` : '—'],
        ].map(([label, value]) => (
          <div key={label}><dt className="text-[11px] font-semibold uppercase text-text-secondary-light">{label}</dt><dd className="mt-0.5 break-words">{value}</dd></div>
        ))}
      </dl>
      {active && (canManage || canTerminate) && (
        <div className="flex flex-wrap gap-2">
          {canManage && <button type="button" onClick={onEdit} className="min-h-[40px] rounded-lg border border-accent-600 px-4 text-sm font-semibold text-accent-600">Editar expediente</button>}
          {canTerminate && <button type="button" onClick={onTransfer} className="min-h-[40px] rounded-lg border border-black/15 px-4 text-sm font-semibold dark:border-white/15">Trasladar</button>}
          {canTerminate && <button type="button" onClick={onTerminate} className="min-h-[40px] rounded-lg border border-status-danger/40 px-4 text-sm font-semibold text-status-danger">Dar de baja</button>}
        </div>
      )}
      <section>
        <h3 className="text-sm font-semibold">Historial de departamento y puesto</h3>
        <ol className="mt-2 space-y-2">
          {employee.assignments.map(item => (
            <li key={item.validFrom} className="rounded-lg bg-black/[.03] p-3 text-xs dark:bg-white/[.04]">
              <strong>{DEPARTMENT_LABELS[item.department]} · {item.position}</strong>
              <span className="block text-text-secondary-light">
                {new Date(item.validFrom).toLocaleDateString('es-DO')} — {item.validTo ? new Date(item.validTo).toLocaleDateString('es-DO') : 'actual'} · {item.changedBy}
                {item.reason ? ` · ${item.reason}` : ''}
              </span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}

/** Human Resources employee records (ADR-0017): accounts are only issued to employees registered here. */
export default function EmployeesPage({ initialRequisition = null, onRequisitionConsumed }) {
  const access = useOptionalDepartmentAccess();
  const canManage = Boolean(access?.can('human_resources.employees.manage'));
  const canTerminate = Boolean(access?.can('human_resources.employees.terminate'));
  const [tab, setTab] = useState('employees');
  const [filters, setFilters] = useState({ department: '', status: 'Active', search: '' });
  const [page, setPage] = useState(null);
  const [options, setOptions] = useState(null);
  const [selected, setSelected] = useState(null);
  const [detail, setDetail] = useState(null);
  const [editing, setEditing] = useState(null);
  const [transfer, setTransfer] = useState(null);
  const [terminate, setTerminate] = useState(null);
  const [unregistered, setUnregistered] = useState(null);
  const [registering, setRegistering] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });

  const load = useCallback(async () => {
    try {
      setPage(await listEmployees({ ...filters, limit: 100 }));
    } catch (failure) {
      setPage({ employees: [], total: 0 });
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { getEmployeeOptions().then(setOptions).catch(() => setOptions(null)); }, []);
  useEffect(() => {
    if (!initialRequisition) return;
    setEditing({ requisition: initialRequisition });
    onRequisitionConsumed?.();
  }, [initialRequisition, onRequisitionConsumed]);
  useEffect(() => {
    if (tab !== 'pending' || !canManage) return;
    listUnregisteredPersons().then(setUnregistered).catch(failure => {
      setUnregistered([]);
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    });
  }, [tab, canManage]);
  const loadDetail = useCallback(async id => {
    try { setDetail(await getEmployee(id)); } catch (failure) { setMessage({ tone: 'error', text: governanceMessage(failure) }); }
  }, []);
  useEffect(() => {
    if (selected) void loadDetail(selected); else setDetail(null);
  }, [selected, loadDetail]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('employees')) { void load(); if (selected) void loadDetail(selected); }
    });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [load, loadDetail, selected]);

  function done(text) {
    setMessage({ tone: 'success', text });
    setEditing(null);
    setTransfer(null);
    setTerminate(null);
    setRegistering(null);
    void load();
    if (selected) void loadDetail(selected);
    if (tab === 'pending') listUnregisteredPersons().then(setUnregistered).catch(() => {});
    getEmployeeOptions().then(setOptions).catch(() => {});
  }

  const employees = page?.employees ?? [];
  return (
    <div className="mx-auto max-w-[1440px] space-y-5 3xl:max-w-[1760px]">
      <PageHeader eyebrow="Gestión Humana" title="Empleados"
        description="Expediente de cada persona que trabaja en AVIAM. Solo los empleados registrados pueden recibir acceso a ELEVANT."
        actions={canManage && <button type="button" onClick={() => setEditing({})} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Registrar empleado</button>} />
      {canManage && <Tabs activeId={tab} onChange={setTab} tabs={[{ id: 'employees', label: 'Empleados' }, { id: 'pending', label: 'Expedientes pendientes' }]} />}
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}

      {tab === 'employees' ? (
        <>
          <FilterBar>
            <label className="text-xs font-semibold">Buscar<input value={filters.search} placeholder="Nombre, número o correo" onChange={event => setFilters(current => ({ ...current, search: event.target.value }))} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Departamento<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
              <option value="">Todos</option>{Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
            <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={fieldClass}>
              <option value="">Todos</option><option value="Active">Activos</option><option value="Terminated">De baja</option></select></label>
          </FilterBar>
          {!page ? <p role="status" className="text-sm">Cargando empleados…</p> : employees.length === 0 ? (
            <EmptyState icon={UsersIcon} title="Sin empleados" description="No hay empleados con esos filtros." />
          ) : (
            <StackedTable className="rounded-xl border border-black/5 bg-white dark:border-white/5 dark:bg-surface-dark-card">
              <table className="table-stack w-full min-w-[820px] text-left text-sm">
                <thead className="bg-black/[.03] text-xs uppercase text-text-secondary-light dark:bg-white/[.03]">
                  <tr><th className="p-3">Empleado</th><th className="p-3">Departamento</th><th className="p-3">Puesto</th><th className="p-3">Estaciones</th><th className="p-3">Acceso</th><th className="p-3">Estado</th></tr>
                </thead>
                <tbody>{employees.map(employee => {
                  const status = EMPLOYEE_STATUS[employee.status];
                  const account = employee.account ? ACCOUNT_STATUS[employee.account.status] : null;
                  return (
                    <tr key={employee.id} className="border-t border-black/5 dark:border-white/5">
                      <td className="p-3"><button type="button" onClick={() => setSelected(employee.id)} className="text-left font-semibold text-accent-600">{employee.firstName} {employee.lastName}</button>
                        <span className="block text-xs text-text-secondary-light">{employee.employeeNumber}</span></td>
                      <td className="p-3">{DEPARTMENT_LABELS[employee.department]}</td>
                      <td className="p-3">{employee.position.name}</td>
                      <td className="p-3 text-xs">{employee.stations.map(station => station.code).join(', ') || '—'}</td>
                      <td className="p-3">{account ? <StatusBadge tone={account.tone} label={account.label} /> : <span className="text-xs text-text-secondary-light">{employee.corporateEmail ? 'Sin cuenta' : 'Sin correo'}</span>}</td>
                      <td className="p-3"><StatusBadge tone={status.tone} label={status.label} /></td>
                    </tr>
                  );
                })}</tbody>
              </table>
            </StackedTable>
          )}
        </>
      ) : (
        <section className="space-y-3">
          <p className="text-sm text-text-secondary-light">Cuentas y agentes creados antes de los expedientes. Registre su documento real y su puesto.</p>
          {!unregistered ? <p role="status" className="text-sm">Cargando…</p> : unregistered.length === 0 ? (
            <EmptyState icon={UsersIcon} title="Todo registrado" description="Todas las cuentas internas tienen expediente." />
          ) : (
            <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {unregistered.map(person => (
                <li key={person.accountId ?? person.rampAgentId} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
                  <div className="min-w-0"><strong>{person.firstName} {person.lastName}</strong>
                    <span className="block text-xs text-text-secondary-light">{DEPARTMENT_LABELS[person.department] ?? 'Sin departamento'} · {person.email ?? 'sin correo'}{person.employeeNumber ? ` · ${person.employeeNumber}` : ''}</span></div>
                  <button type="button" onClick={() => setRegistering(person)} className="min-h-[40px] rounded-lg border border-accent-600 px-3 text-sm font-semibold text-accent-600">Registrar expediente</button>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <Drawer open={Boolean(detail)} onClose={() => setSelected(null)} title={detail ? `${detail.summary.firstName} ${detail.summary.lastName}` : ''}
        description={detail ? EMPLOYEE_STATUS[detail.summary.status].label : ''} widthClassName="lg:w-[560px]">
        {detail && <EmployeeDetail employee={detail} canManage={canManage} canTerminate={canTerminate}
          onEdit={() => setEditing({ employee: detail })} onTransfer={() => setTransfer(detail)} onTerminate={() => setTerminate(detail)} />}
      </Drawer>
      <EmployeeDrawer open={Boolean(editing)} employee={editing?.employee ?? null} requisition={editing?.requisition ?? null}
        options={options} onClose={() => setEditing(null)} onSaved={done} />
      <TransferModal employee={transfer} options={options} onClose={() => setTransfer(null)} onDone={done} />
      <TerminateModal employee={terminate} onClose={() => setTerminate(null)} onDone={done} />
      <RegisterDrawer person={registering} options={options} onClose={() => setRegistering(null)} onSaved={done} />
    </div>
  );
}
