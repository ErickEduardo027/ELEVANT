import { useEffect, useMemo, useState } from 'react';
import { identityDocumentExample, normalizeIdentityDocument, normalizePhone } from '@elevant/api-client';
import Drawer from '../../components/Drawer';
import Modal from '../../components/Modal';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import {
  createEmployee, governanceMessage, IDENTIFICATION_LABELS, registerEmployee, terminateEmployee, transferEmployee,
  updateEmployee,
} from '../../services/humanResourcesEmployeesService';

export const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const today = () => new Date().toISOString().slice(0, 10);

const DOCUMENT_KINDS = { CEDULA: 'Cedula', RESIDENCIA: 'Residence', PASAPORTE: 'Passport' };

/** Message for an identification that does not have the real format of its type, or ''. */
export function identificationProblem(type, number) {
  const kind = DOCUMENT_KINDS[type];
  if (!kind || !number.trim() || normalizeIdentityDocument(kind, number)) return '';
  return kind === 'Passport'
    ? `El pasaporte no tiene un formato válido: ${identityDocumentExample(kind)}.`
    : `El número no es válido: revise los 11 dígitos y el dígito verificador (${identityDocumentExample(kind)}).`;
}

/** Message for a phone that is neither a Dominican number nor an international one, or ''. */
export function phoneProblem(phone) {
  return phone.trim() && !normalizePhone(phone)
    ? 'Use un teléfono dominicano de 10 dígitos (809, 829 o 849) o uno extranjero con su prefijo (+ o 00).' : '';
}

/** Keeps the browser's constraint validation in sync with a rule the form computes itself. */
const withRule = (problem) => (element) => element?.setCustomValidity(problem);

function StationChecks({ stations, value, onChange }) {
  return (
    <fieldset>
      <legend className="text-xs font-semibold">Estaciones donde trabaja</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {stations.map(station => (
          <label key={station.id} className="flex min-h-[36px] items-center gap-2 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10">
            <input type="checkbox" checked={value.includes(station.id)}
              onChange={() => onChange(value.includes(station.id) ? value.filter(id => id !== station.id) : [...value, station.id])} />
            {station.code}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

function ErrorLine({ text }) {
  return text ? <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{text}</p> : null;
}

const blank = requisition => ({
  firstName: '', lastName: '', identificationType: 'CEDULA', identificationNumber: '', phoneNumber: '', corporateEmail: '',
  employeeNumber: '', department: requisition?.department ?? DEPARTMENTS.OPERATIONS, positionId: requisition?.position.id ?? '',
  stationIds: requisition?.station ? [requisition.station.id] : [], hireDate: today(), requisitionId: requisition?.id ?? '',
});

/** Create or edit an employee record. Changing department is a transfer, so it is fixed when editing. */
export function EmployeeDrawer({ open, employee, requisition, options, onClose, onSaved }) {
  const [form, setForm] = useState(() => blank(requisition));
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setError('');
    setForm(employee ? {
      firstName: employee.summary.firstName, lastName: employee.summary.lastName,
      identificationType: employee.identificationIsPlaceholder ? 'CEDULA' : employee.identificationType,
      identificationNumber: employee.identificationIsPlaceholder ? '' : employee.identificationNumber,
      phoneNumber: employee.phoneNumber ?? '', corporateEmail: employee.summary.corporateEmail ?? '',
      employeeNumber: employee.summary.employeeNumber, department: employee.summary.department,
      positionId: employee.summary.position.id, stationIds: employee.summary.stations.map(station => station.id),
      hireDate: employee.summary.hireDate, requisitionId: '',
    } : blank(requisition));
  }, [open, employee, requisition]);
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const positions = useMemo(() => (options?.positions ?? []).filter(position =>
    position.department === form.department && (position.isActive || position.id === form.positionId)), [options, form.department, form.positionId]);
  const requisitions = (options?.openRequisitions ?? []).filter(item =>
    item.department === form.department && item.position.id === form.positionId);
  const emailLocked = Boolean(employee?.summary.account);

  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    const values = {
      ...form, phoneNumber: form.phoneNumber.trim() || null, corporateEmail: form.corporateEmail.trim() || null,
      requisitionId: form.requisitionId || null,
    };
    try {
      if (employee) await updateEmployee(employee.summary.id, { ...values, expectedVersion: employee.summary.version });
      else await createEmployee(values);
      onSaved(employee ? 'Expediente actualizado.' : 'Empleado registrado.');
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title={employee ? 'Editar expediente' : 'Registrar empleado'} widthClassName="lg:w-[600px]"
      description="Datos del empleado en AVIAM. El acceso a ELEVANT lo solicita después su departamento."
      footer={<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="employee-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">{busy ? 'Guardando…' : 'Guardar'}</button></div>}>
      {open && (
        <form id="employee-form" onSubmit={submit} className="space-y-4">
          <ErrorLine text={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Nombre<input required minLength={2} maxLength={100} value={form.firstName} onChange={event => set({ firstName: event.target.value })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Apellido<input required minLength={2} maxLength={100} value={form.lastName} onChange={event => set({ lastName: event.target.value })} className={fieldClass} /></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="text-xs font-semibold">Documento<select value={form.identificationType} onChange={event => set({ identificationType: event.target.value })} className={fieldClass}>
              {(options?.identificationTypes ?? Object.keys(IDENTIFICATION_LABELS)).map(type => <option key={type} value={type}>{IDENTIFICATION_LABELS[type] ?? type}</option>)}</select></label>
            <label className="text-xs font-semibold">Número de documento<input required maxLength={40}
              ref={withRule(identificationProblem(form.identificationType, form.identificationNumber))}
              placeholder={identityDocumentExample(DOCUMENT_KINDS[form.identificationType] ?? 'Cedula')} value={form.identificationNumber} onChange={event => set({ identificationNumber: event.target.value })} className={fieldClass} /></label>
          </div>
          {employee?.identificationIsPlaceholder && <p className="text-xs text-status-warning">Este expediente tiene una identificación provisional: registre la real.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Correo corporativo{emailLocked ? ' (bloqueado: tiene cuenta)' : ' (necesario para dar acceso)'}
              <input type="email" maxLength={256} disabled={emailLocked} value={form.corporateEmail} onChange={event => set({ corporateEmail: event.target.value })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Teléfono<input type="tel" maxLength={32} placeholder="809-555-0100"
              ref={withRule(phoneProblem(form.phoneNumber))} value={form.phoneNumber} onChange={event => set({ phoneNumber: event.target.value })} className={fieldClass} /></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">Número de empleado<input required pattern="[A-Za-z0-9\-]{2,32}" data-error="Use de 2 a 32 letras, dígitos o guiones, p. ej. QA-FIN-010." value={form.employeeNumber} onChange={event => set({ employeeNumber: event.target.value.toUpperCase() })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Fecha de ingreso<input required type="date" value={form.hireDate} onChange={event => set({ hireDate: event.target.value })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Departamento<select disabled={Boolean(employee)} value={form.department} onChange={event => set({ department: event.target.value, positionId: '', requisitionId: '' })} className={fieldClass}>
              {Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
          </div>
          <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => set({ positionId: event.target.value, requisitionId: '' })} className={fieldClass}>
            <option value="">Seleccione…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}{position.isRampPosition ? ' · rampa' : ''}</option>)}</select></label>
          {!employee && requisitions.length > 0 && (
            <label className="block text-xs font-semibold">Cubre la requisición (opcional)<select value={form.requisitionId} onChange={event => set({ requisitionId: event.target.value })} className={fieldClass}>
              <option value="">Ninguna</option>{requisitions.map(item => <option key={item.id} value={item.id}>{item.position.name} · {item.filled}/{item.quantity} · {item.reason}</option>)}</select></label>
          )}
          <StationChecks stations={options?.stations ?? []} value={form.stationIds} onChange={stationIds => set({ stationIds })} />
        </form>
      )}
    </Drawer>
  );
}

/** Transfer to another department: the current access ends until the new department requests it. */
export function TransferModal({ employee, options, onClose, onDone }) {
  const [form, setForm] = useState({ department: '', positionId: '', stationIds: [], reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (employee) setForm({ department: '', positionId: '', stationIds: employee.summary.stations.map(station => station.id), reason: '' });
    setError('');
  }, [employee]);
  if (!employee) return null;
  const positions = (options?.positions ?? []).filter(position => position.department === form.department && position.isActive);
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await transferEmployee(employee.summary.id, { ...form, reason: form.reason.trim(), expectedVersion: employee.summary.version });
      onDone('Empleado trasladado. Su cuenta quedó desactivada hasta que el nuevo departamento solicite el acceso.');
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open onClose={onClose} title={`Trasladar a ${employee.summary.firstName} ${employee.summary.lastName}`}
      footer={<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="transfer-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Trasladar</button></div>}>
      <form id="transfer-form" onSubmit={submit} className="space-y-3">
        <ErrorLine text={error} />
        <p className="text-sm">El acceso actual termina: el departamento de destino deberá solicitarlo de nuevo.</p>
        <label className="block text-xs font-semibold">Departamento de destino<select required value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value, positionId: '' }))} className={fieldClass}>
          <option value="">Seleccione…</option>{Object.values(DEPARTMENTS).filter(key => key !== employee.summary.department).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
        <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => setForm(current => ({ ...current, positionId: event.target.value }))} className={fieldClass}>
          <option value="">Seleccione…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
        <StationChecks stations={options?.stations ?? []} value={form.stationIds} onChange={stationIds => setForm(current => ({ ...current, stationIds }))} />
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={2} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
      </form>
    </Modal>
  );
}

/** Termination: shows what it will revoke before confirming. */
export function TerminateModal({ employee, onClose, onDone }) {
  const [form, setForm] = useState({ terminatedOn: today(), reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { setForm({ terminatedOn: today(), reason: '' }); setError(''); }, [employee]);
  if (!employee) return null;
  const account = employee.summary.account;
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await terminateEmployee(employee.summary.id, { ...form, reason: form.reason.trim(), expectedVersion: employee.summary.version });
      onDone('Baja registrada. La cuenta quedó desactivada y sin alcances.');
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal open tone="danger" onClose={onClose} title={`Dar de baja a ${employee.summary.firstName} ${employee.summary.lastName}`}
      footer={<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="terminate-form" disabled={busy} className="rounded-lg bg-status-danger px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Dar de baja</button></div>}>
      <form id="terminate-form" onSubmit={submit} className="space-y-3">
        <ErrorLine text={error} />
        <ul className="list-disc space-y-1 pl-5 text-sm">
          <li>{account ? `Su cuenta (${account.status === 'Active' ? 'activa' : 'inactiva'}) se desactiva y pierde sus estaciones.` : 'No tiene cuenta en ELEVANT.'}</li>
          {employee.pendingAccessRequests > 0 && <li>Se cancelan {employee.pendingAccessRequests} solicitud(es) de acceso pendientes.</li>}
          {employee.summary.position.isRampPosition && <li>Su perfil de agente de rampa queda inactivo.</li>}
          {employee.futureShifts > 0 && <li>Tiene {employee.futureShifts} turno(s) futuros programados: reasígnelos.</li>}
          <li>La baja es definitiva: la cuenta no podrá reactivarse.</li>
        </ul>
        <label className="block text-xs font-semibold">Fecha de baja<input required type="date" max={today()} min={employee.summary.hireDate} value={form.terminatedOn} onChange={event => setForm(current => ({ ...current, terminatedOn: event.target.value }))} className={fieldClass} /></label>
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={2} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
      </form>
    </Modal>
  );
}

/** Creates the record of an account or ramp agent that predates employees. */
export function RegisterDrawer({ person, options, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!person) return;
    setError('');
    setForm({ identificationType: 'CEDULA', identificationNumber: '', employeeNumber: person.employeeNumber ?? '',
      positionId: '', hireDate: today(), phoneNumber: '', stationIds: person.stations.map(station => station.id) });
  }, [person]);
  const positions = (options?.positions ?? []).filter(position => position.department === person?.department &&
    position.isActive && (!person?.rampAgentId || position.isRampPosition));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    try {
      await registerEmployee({ ...form, phoneNumber: form.phoneNumber?.trim() || null,
        accountId: person.accountId ?? null, rampAgentId: person.accountId ? null : person.rampAgentId });
      onSaved('Expediente registrado.');
    } catch (failure) {
      setError(governanceMessage(failure));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Drawer open={Boolean(person)} onClose={onClose} title="Registrar expediente" widthClassName="lg:w-[560px]"
      description={person ? `${person.firstName} ${person.lastName} · ${DEPARTMENT_LABELS[person.department] ?? 'Sin departamento'}` : ''}
      footer={<div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="register-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-60">Registrar</button></div>}>
      {person && (
        <form id="register-form" onSubmit={submit} className="space-y-4">
          <ErrorLine text={error} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[10rem_minmax(0,1fr)]">
            <label className="text-xs font-semibold">Documento<select value={form.identificationType} onChange={event => setForm(current => ({ ...current, identificationType: event.target.value }))} className={fieldClass}>
              {(options?.identificationTypes ?? []).map(type => <option key={type} value={type}>{IDENTIFICATION_LABELS[type] ?? type}</option>)}</select></label>
            <label className="text-xs font-semibold">Número de documento<input required value={form.identificationNumber} onChange={event => setForm(current => ({ ...current, identificationNumber: event.target.value }))} className={fieldClass} /></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Número de empleado<input required disabled={Boolean(person.employeeNumber)} value={form.employeeNumber} onChange={event => setForm(current => ({ ...current, employeeNumber: event.target.value.toUpperCase() }))} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Fecha de ingreso<input required type="date" value={form.hireDate} onChange={event => setForm(current => ({ ...current, hireDate: event.target.value }))} className={fieldClass} /></label>
          </div>
          <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => setForm(current => ({ ...current, positionId: event.target.value }))} className={fieldClass}>
            <option value="">Seleccione…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
          <label className="block text-xs font-semibold">Teléfono<input value={form.phoneNumber} onChange={event => setForm(current => ({ ...current, phoneNumber: event.target.value }))} className={fieldClass} /></label>
          <StationChecks stations={options?.stations ?? []} value={form.stationIds ?? []} onChange={stationIds => setForm(current => ({ ...current, stationIds }))} />
        </form>
      )}
    </Drawer>
  );
}
