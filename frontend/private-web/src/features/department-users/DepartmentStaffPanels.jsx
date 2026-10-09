import { useCallback, useEffect, useRef, useState } from 'react';
import EmptyState from '../../components/EmptyState';
import Modal from '../../components/Modal';
import { BriefcaseIcon } from '../shell/components/icons';
import ActivityPanel from '../employees/ActivityPanel';
import { RequisitionCard } from '../employees/RequisitionsPage';
import {
  cancelRequisition, createRequisition, governanceMessage, listDepartmentActivity, listDepartmentPositions,
  listDepartmentRequisitions, setSuggestedProfile,
} from '../../services/humanResourcesEmployeesService';
import { newRequestId } from './useDepartmentGovernance';

const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';

function Notice({ message }) {
  return message.text ? (
    <p role={message.tone === 'error' ? 'alert' : 'status'} className={`rounded-lg p-3 text-sm ${message.tone === 'error' ? 'bg-status-danger/10 text-status-danger' : 'bg-status-success/10'}`}>{message.text}</p>
  ) : null;
}

/** Positions come from Human Resources; the department chooses which access template each one starts with. */
export function DepartmentPositionsPanel({ department, profiles }) {
  const [positions, setPositions] = useState(null);
  const [message, setMessage] = useState({ tone: '', text: '' });
  const load = useCallback(async () => {
    try { setPositions(await listDepartmentPositions(department)); }
    catch (failure) { setPositions([]); setMessage({ tone: 'error', text: governanceMessage(failure) }); }
  }, [department]);
  useEffect(() => { void load(); }, [load]);
  const active = (profiles ?? []).filter(profile => profile.isActive);

  async function change(position, accessProfileId) {
    try {
      await setSuggestedProfile(department, position.id, { accessProfileId: accessProfileId || null, expectedVersion: position.version });
      setMessage({ tone: 'success', text: `Plantilla sugerida de «${position.name}» actualizada.` });
    } catch (failure) {
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    }
    await load();
  }

  return (
    <section className="space-y-3">
      <p className="text-sm text-text-secondary-light">Gestión Humana define los puestos. Elija la plantilla con la que empieza cada uno al solicitar un acceso.</p>
      <Notice message={message} />
      {!positions ? <p role="status" className="text-sm">Cargando puestos…</p> : positions.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title="Sin puestos" description="Gestión Humana aún no ha registrado puestos para este departamento." />
      ) : (
        <ul className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {positions.map(position => (
            <li key={position.id} className="space-y-2 rounded-xl border border-black/5 bg-white p-4 dark:border-white/5 dark:bg-surface-dark-card">
              <div><strong>{position.name}</strong>{!position.isActive && <span className="ml-2 text-xs text-text-secondary-light">(inactivo)</span>}
                <span className="block text-xs text-text-secondary-light">{position.employees} empleado(s){position.description ? ` · ${position.description}` : ''}</span></div>
              {position.isRampPosition ? (
                <p className="text-xs text-text-secondary-light">Puesto de rampa: usa la app móvil, sin plantilla web.</p>
              ) : (
                <label className="block text-xs font-semibold">Plantilla sugerida
                  <select aria-label={`Plantilla sugerida de ${position.name}`} value={position.suggestedAccessProfileId ?? ''} onChange={event => void change(position, event.target.value)} className={fieldClass}>
                    <option value="">Sin sugerencia</option>
                    {active.map(profile => <option key={profile.id} value={profile.id}>{profile.name}</option>)}
                  </select></label>
              )}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The department asks Human Resources for people in one of its positions. */
export function DepartmentRequisitionsPanel({ department, stations }) {
  const [items, setItems] = useState(null);
  const [positions, setPositions] = useState([]);
  const [form, setForm] = useState(null);
  const [cancelling, setCancelling] = useState(null);
  const [reason, setReason] = useState('');
  const [message, setMessage] = useState({ tone: '', text: '' });
  const requestId = useRef(newRequestId());
  const load = useCallback(async () => {
    try { setItems(await listDepartmentRequisitions(department)); }
    catch (failure) { setItems([]); setMessage({ tone: 'error', text: governanceMessage(failure) }); }
  }, [department]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { listDepartmentPositions(department).then(setPositions).catch(() => setPositions([])); }, [department]);

  async function submit(event) {
    event.preventDefault();
    try {
      await createRequisition(department, { requestId: requestId.current, positionId: form.positionId, quantity: Number(form.quantity),
        reason: form.reason.trim(), stationId: form.stationId || null, desiredStartOn: form.desiredStartOn || null });
      setForm(null);
      setMessage({ tone: 'success', text: 'Requisición enviada a Gestión Humana.' });
      await load();
    } catch (failure) {
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    }
  }

  async function cancel(event) {
    event.preventDefault();
    try {
      await cancelRequisition(cancelling.id, { reason: reason.trim(), expectedVersion: cancelling.version });
      setCancelling(null);
      setMessage({ tone: 'success', text: 'Requisición cancelada.' });
    } catch (failure) {
      setMessage({ tone: 'error', text: governanceMessage(failure) });
    }
    await load();
  }

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-text-secondary-light">Pida personal a Gestión Humana según el organigrama. Cuando contrate, el empleado aparecerá para solicitar su acceso.</p>
        <button type="button" onClick={() => { requestId.current = newRequestId(); setForm({ positionId: '', quantity: 1, reason: '', stationId: '', desiredStartOn: '' }); }}
          className="min-h-[40px] rounded-lg bg-accent-600 px-4 text-sm font-semibold text-white">Pedir personal</button>
      </div>
      <Notice message={message} />
      {!items ? <p role="status" className="text-sm">Cargando requisiciones…</p> : items.length === 0 ? (
        <EmptyState icon={BriefcaseIcon} title="Sin requisiciones" description="Aún no ha pedido personal." />
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {items.map(item => (
            <RequisitionCard key={item.id} requisition={item} actions={(item.status === 'Open' || item.status === 'InProgress') && (
              <button type="button" onClick={() => { setReason(''); setCancelling(item); }} className="min-h-[36px] rounded-lg border border-status-danger/40 px-3 text-xs font-semibold text-status-danger">Cancelar requisición</button>
            )} />
          ))}
        </div>
      )}
      <Modal open={Boolean(form)} onClose={() => setForm(null)} title="Pedir personal"
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setForm(null)} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
          <button type="submit" form="requisition-form" className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white">Enviar a Gestión Humana</button></div>}>
        {form && (
          <form id="requisition-form" onSubmit={submit} className="space-y-3">
            <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => setForm(current => ({ ...current, positionId: event.target.value }))} className={fieldClass}>
              <option value="">Seleccione…</option>{positions.filter(position => position.isActive).map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <label className="text-xs font-semibold">Cantidad<input required type="number" min="1" max="50" value={form.quantity} onChange={event => setForm(current => ({ ...current, quantity: event.target.value }))} className={fieldClass} /></label>
              <label className="text-xs font-semibold">Estación<select value={form.stationId} onChange={event => setForm(current => ({ ...current, stationId: event.target.value }))} className={fieldClass}>
                <option value="">Cualquiera</option>{(stations ?? []).map(station => <option key={station.id} value={station.id}>{station.code}</option>)}</select></label>
              <label className="text-xs font-semibold">Desde<input type="date" min={new Date().toISOString().slice(0, 10)} value={form.desiredStartOn} onChange={event => setForm(current => ({ ...current, desiredStartOn: event.target.value }))} className={fieldClass} /></label>
            </div>
            <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={1000} rows={3} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
          </form>
        )}
      </Modal>
      <Modal open={Boolean(cancelling)} tone="danger" onClose={() => setCancelling(null)} title="Cancelar requisición"
        footer={<div className="flex justify-end gap-2"><button type="button" onClick={() => setCancelling(null)} className="rounded-lg border px-4 py-2 text-sm">Volver</button>
          <button type="submit" form="cancel-requisition" className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white">Cancelar requisición</button></div>}>
        <form id="cancel-requisition" onSubmit={cancel}>
          <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={3} value={reason} onChange={event => setReason(event.target.value)} className={fieldClass} /></label>
        </form>
      </Modal>
    </section>
  );
}

/** Activity of the department's people: sign-ins, access changes and operational actions. */
export function DepartmentActivityPanel({ department }) {
  const load = useCallback(filters => listDepartmentActivity(department, filters), [department]);
  return <ActivityPanel load={load} />;
}
