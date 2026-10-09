import { useCallback, useEffect, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import PageHeader from '../../components/PageHeader';
import StatusBadge from '../../components/StatusBadge';
import { useOptionalDepartmentAccess } from '../access/DepartmentAccessContext';
import { BriefcaseIcon } from '../shell/components/icons';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import {
  changeRequisitionStatus, getEmployeeOptions, governanceMessage, listRequisitions, REQUISITION_STATUS,
} from '../../services/humanResourcesEmployeesService';
import { EmployeeDrawer, fieldClass } from './EmployeeForms';

export function RequisitionCard({ requisition, actions }) {
  const status = REQUISITION_STATUS[requisition.status] ?? { label: requisition.status, tone: 'info' };
  return (
    <article className="space-y-2 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <strong>{requisition.position.name}</strong>
          <span className="block text-xs text-text-secondary-light">
            {DEPARTMENT_LABELS[requisition.department]}{requisition.station ? ` · ${requisition.station.code}` : ''}
            {requisition.desiredStartOn ? ` · desde ${requisition.desiredStartOn}` : ''}
          </span>
        </div>
        <StatusBadge tone={status.tone} label={status.label} />
      </div>
      <p className="text-sm">{requisition.reason}</p>
      <p className="text-xs text-text-secondary-light">
        {requisition.filled} de {requisition.quantity} cubiertos · pedida por {requisition.requestedBy} el {new Date(requisition.requestedAt).toLocaleDateString('es-DO')}
        {requisition.attendedBy ? ` · atiende ${requisition.attendedBy}` : ''}
        {requisition.closureReason ? ` · ${requisition.closureReason}` : ''}
      </p>
      {requisition.employees.length > 0 && (
        <ul className="flex flex-wrap gap-1 text-xs">{requisition.employees.map(item => <li key={item.id} className="rounded bg-black/5 px-2 py-0.5 dark:bg-white/10">{item.name} · {item.employeeNumber}</li>)}</ul>
      )}
      {actions}
    </article>
  );
}

/** Requests for personnel from the departments; Human Resources attends and fills them. */
export default function RequisitionsPage() {
  const access = useOptionalDepartmentAccess();
  const canAttend = Boolean(access?.can('human_resources.requisitions.attend'));
  const canHire = Boolean(access?.can('human_resources.employees.manage'));
  const [filters, setFilters] = useState({ department: '', status: '' });
  const [items, setItems] = useState(null);
  const [closing, setClosing] = useState(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });
  const [hiring, setHiring] = useState(null);
  const [options, setOptions] = useState(null);

  async function hire(requisition) {
    if (!options) setOptions(await getEmployeeOptions().catch(() => null));
    setHiring(requisition);
  }

  const load = useCallback(async () => {
    try { setItems(await listRequisitions(filters)); }
    catch (failure) { setItems([]); setMessage({ tone: 'error', text: governanceMessage(failure) }); }
  }, [filters]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (process.env.NODE_ENV === 'test') return undefined;
    const observer = createPrivateWebAccountChangeObserver(resources => { if (resources.includes('requisitions')) void load(); });
    void observer.start().catch(() => {});
    return () => { void observer.stop(); };
  }, [load]);

  async function move(requisition, status, closureReason) {
    try {
      await changeRequisitionStatus(requisition.id, { status, reason: closureReason ?? null, expectedVersion: requisition.version });
      setMessage({ tone: 'success', text: `Requisición ${REQUISITION_STATUS[status].label.toLowerCase()}.` });
      setClosing(null);
      await load();
    } catch (failure) {
      setMessage({ tone: 'error', text: governanceMessage(failure) });
      await load();
    }
  }

  return (
    <div className="mx-auto max-w-[1200px] space-y-5">
      <PageHeader eyebrow="Gestión Humana" title="Requisiciones de personal"
        description="Personal que piden los departamentos. Atiéndalas y registre a cada contratado como empleado vinculado." />
      <div className="flex flex-wrap gap-3">
        <label className="text-xs font-semibold">Departamento<select value={filters.department} onChange={event => setFilters(current => ({ ...current, department: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
        <label className="text-xs font-semibold">Estado<select value={filters.status} onChange={event => setFilters(current => ({ ...current, status: event.target.value }))} className={fieldClass}>
          <option value="">Todos</option>{Object.entries(REQUISITION_STATUS).map(([value, item]) => <option key={value} value={value}>{item.label}</option>)}</select></label>
      </div>
      {message.text && <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>}
      {!items ? <p role="status" className="text-sm">Cargando requisiciones…</p> : items.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title="Sin requisiciones" description="Los departamentos aún no han pedido personal." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map(requisition => {
            const open = requisition.status === 'Open' || requisition.status === 'InProgress';
            return (
              <RequisitionCard key={requisition.id} requisition={requisition} actions={open && (canAttend || canHire) && (
                <div className="flex flex-wrap gap-2">
                  {canHire && <button type="button" onClick={() => void hire(requisition)} className="min-h-[36px] rounded-lg bg-accent-600 px-3 text-xs font-semibold text-white">Registrar contratado</button>}
                  {canAttend && requisition.status === 'Open' && <button type="button" onClick={() => void move(requisition, 'InProgress')} className="min-h-[36px] rounded-lg border px-3 text-xs font-semibold">Atender</button>}
                  {canAttend && <button type="button" onClick={() => void move(requisition, 'Fulfilled')} className="min-h-[36px] rounded-lg border border-status-success px-3 text-xs font-semibold text-status-success">Marcar cubierta</button>}
                  {canAttend && <button type="button" onClick={() => { setReason(''); setClosing(requisition); }} className="min-h-[36px] rounded-lg border border-status-danger/40 px-3 text-xs font-semibold text-status-danger">Rechazar</button>}
                </div>
              )} />
            );
          })}
        </div>
      )}
      <EmployeeDrawer open={Boolean(hiring)} employee={null} requisition={hiring} options={options}
        onClose={() => setHiring(null)}
        onSaved={text => { setHiring(null); setMessage({ tone: 'success', text }); void load(); }} />
      <Modal open={Boolean(closing)} tone="danger" onClose={() => setClosing(null)} title="Rechazar requisición"
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setClosing(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="reject-requisition" className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white">Rechazar</button></div>}>
        <form id="reject-requisition" onSubmit={event => { event.preventDefault(); void move(closing, 'Rejected', reason.trim()); }}>
          <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} className={fieldClass} /></label>
        </form>
      </Modal>
    </div>
  );
}
