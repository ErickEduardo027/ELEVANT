import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { checkIdentityDocument, DOMINICAN_PASSPORT_PREFIX, normalizePhone } from '@elevant/api-client';
import Drawer from '../../components/Drawer';
import Modal from '../../components/Modal';
import IdentityDocumentFields from './IdentityDocumentFields';
import { DEFAULT_IDENTIFICATION_TYPE, identificationForSubmit } from './identityDocumentValue';
import { formatPhone } from '../../components/inputMasks';
import { trimmedLengthProblem, withRule } from '../../components/formValidation';
import { DEPARTMENTS, DEPARTMENT_LABELS } from '../../services/departmentGovernanceService';
import {
  createEmployee, EMPLOYEE_MESSAGES, governanceMessage, registerEmployee, terminateEmployee,
  transferEmployee, updateEmployee,
} from '../../services/humanResourcesEmployeesService';
import { addDays, businessToday } from '../../services/businessDay';
import { createCommandKeyHolder } from '../../services/commandKeys';
import { problemMessage } from '../../services/problemMessages';

export const fieldClass = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
// AVIAM's business day, never the UTC one: from 20:00 in the Dominican Republic it is already tomorrow (2-N31).
const today = () => businessToday();
// A transfer or a termination never shows the server's title: its rule, or a Spanish message by status.
const commandMessage = failure => problemMessage(failure, EMPLOYEE_MESSAGES);

const DOCUMENT_KINDS = { CEDULA: 'Cedula', RESIDENCIA: 'Residence', PASAPORTE: 'Passport' };

/** Message for an identification that does not have the real format of its type, or ''. */
export function identificationProblem(type, number) {
  const kind = DOCUMENT_KINDS[type];
  if (!kind || !number.trim()) return '';
  // Same rule as IdentificationTypes.Check: a passport starting with RD is Dominican.
  const dominican = kind === 'Passport' && number.replace(/[ .-]/g, '').toUpperCase().startsWith(DOMINICAN_PASSPORT_PREFIX);
  return checkIdentityDocument(kind, number, dominican ? 'DO' : null).problem ?? '';
}

/** Message for a phone that is neither a Dominican number nor an international one, or ''. */
export function phoneProblem(phone) {
  return phone.trim() && !normalizePhone(phone)
    ? 'Use un teléfono dominicano de 10 dígitos (809, 829 o 849) o uno extranjero con su prefijo (+ o 00).' : '';
}

/** Stations an employee, a transfer or a registered record may have: the server takes 1 to 20. */
export const MAX_STATIONS = 20;

/** Message for a station selection outside 1 to 20, or ''. */
export function stationsProblem(stationIds) {
  const count = stationIds?.length ?? 0;
  if (count === 0) return 'Marca al menos una estación.';
  if (count > MAX_STATIONS) return `Máximo ${MAX_STATIONS} estaciones.`;
  return '';
}

/** Oldest hire date the server takes, and the message of the range ending 30 days after AVIAM's today. */
export const EARLIEST_HIRE_DATE = '1950-01-01';
export const latestHireDate = () => addDays(today(), 30);
const formatDay = iso => iso.split('-').reverse().join('/');
const hireDateError = () => `La fecha de ingreso va del 01/01/1950 al ${formatDay(latestHireDate())} (hasta 30 días después de hoy).`;

/** Reason of a transfer or a termination: 3 to 500 characters after trimming, like the server. */
export const reasonProblem = reason => trimmedLengthProblem(reason, 3, 500);

/** The phone input of a record: tel keyboard and autofill, the Dominican mask and the normalizePhone rule. */
function PhoneInput({ value, onChange }) {
  return <input type="tel" inputMode="tel" autoComplete="tel" maxLength={32} placeholder="809-555-0100"
    ref={withRule(phoneProblem(value ?? ''))} value={value ?? ''} onChange={event => onChange(formatPhone(event.target.value))}
    className={fieldClass} />;
}

function HireDateInput({ value, onChange }) {
  return <input required type="date" min={EARLIEST_HIRE_DATE} max={latestHireDate()} data-error={hireDateError()}
    ref={withRule(value && (value < EARLIEST_HIRE_DATE || value > latestHireDate()) ? hireDateError() : '')}
    value={value} onChange={event => onChange(event.target.value)} className={fieldClass} />;
}

/**
 * The stations of a record. The server takes 1 to 20: more than 20 is said at once, none once the person unmarked the
 * last one or tried to save (`attempted`), next to the group.
 */
function StationChecks({ stations, value, onChange, attempted = false }) {
  const [touched, setTouched] = useState(false);
  const messageId = useId();
  const problem = stationsProblem(value);
  const visible = problem && (touched || attempted || value.length > MAX_STATIONS);
  return (
    <fieldset aria-describedby={visible ? messageId : undefined}>
      <legend className="text-xs font-semibold">Estaciones donde trabaja</legend>
      <div className="mt-1 flex flex-wrap gap-2">
        {stations.map(station => (
          <label key={station.id} className="flex min-h-[36px] items-center gap-2 rounded-lg border border-black/10 px-3 text-sm dark:border-white/10">
            <input type="checkbox" checked={value.includes(station.id)} aria-invalid={visible ? true : undefined}
              onChange={() => {
                setTouched(true);
                onChange(value.includes(station.id) ? value.filter(id => id !== station.id) : [...value, station.id]);
              }} />
            {station.code}
          </label>
        ))}
      </div>
      {/* Never the layer's `form-validation-message` class: its observer removes messages that no field of its own names. */}
      {visible && <p id={messageId} role="alert" className="mt-1 text-xs font-medium text-status-danger">{problem}</p>}
    </fieldset>
  );
}

function ErrorLine({ text }) {
  return text ? <p role="alert" className="rounded-lg bg-status-danger/10 p-3 text-sm text-status-danger">{text}</p> : null;
}

const blank = () => ({
  firstName: '', lastName: '', identificationType: DEFAULT_IDENTIFICATION_TYPE, identificationNumber: '', phoneNumber: '', corporateEmail: '',
  employeeNumber: '', department: DEPARTMENTS.OPERATIONS, positionId: '', stationIds: [], hireDate: today(),
});

/** Create or edit an employee record. Changing department is a transfer, so it is fixed when editing. */
export function EmployeeDrawer({ open, employee, options, onClose, onSaved }) {
  const [form, setForm] = useState(blank);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  const intent = useRef(createCommandKeyHolder());
  useEffect(() => {
    if (!open) return;
    setError('');
    setAttempted(false);
    setForm(employee ? {
      firstName: employee.summary.firstName, lastName: employee.summary.lastName,
      identificationType: employee.identificationIsPlaceholder ? DEFAULT_IDENTIFICATION_TYPE : employee.identificationType,
      identificationNumber: employee.identificationIsPlaceholder ? '' : employee.identificationNumber,
      phoneNumber: employee.phoneNumber ?? '', corporateEmail: employee.summary.corporateEmail ?? '',
      employeeNumber: employee.summary.employeeNumber, department: employee.summary.department,
      positionId: employee.summary.position.id, stationIds: employee.summary.stations.map(station => station.id),
      hireDate: employee.summary.hireDate,
    } : blank());
  }, [open, employee]);
  const set = patch => setForm(current => ({ ...current, ...patch }));
  const positions = useMemo(() => (options?.positions ?? []).filter(position =>
    position.department === form.department && (position.isActive || position.id === form.positionId)), [options, form.department, form.positionId]);
  const emailLocked = Boolean(employee?.summary.account);

  async function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (stationsProblem(form.stationIds)) return;
    setBusy(true);
    setError('');
    const values = {
      ...form, identificationNumber: identificationForSubmit(form.identificationType, form.identificationNumber),
      phoneNumber: form.phoneNumber.trim() || null, corporateEmail: form.corporateEmail.trim() || null,
      // Requisitions left the version 1 interface (ADR-0047): a new record never covers one.
      requisitionId: null,
    };
    try {
      if (employee) {
        const body = { ...values, expectedVersion: employee.summary.version };
        // One intent per body: an uncertain answer repeats the same key, so a release that moving to an office
        // position already did is never repeated (2-N06).
        await intent.current.run('update', [employee.summary.id, body], key =>
          updateEmployee(employee.summary.id, body, key));
      } else await createEmployee(values);
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
            <IdentityDocumentFields type={form.identificationType} number={form.identificationNumber} required
              types={options?.identificationTypes} fieldClass={fieldClass} onChange={set}
              inputRef={withRule(identificationProblem(form.identificationType, form.identificationNumber))} />
          </div>
          {employee?.identificationIsPlaceholder && <p className="text-xs text-status-warning">Este expediente tiene una identificación provisional: registre la real.</p>}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Correo corporativo{emailLocked ? ' (bloqueado: tiene cuenta)' : ' (necesario para dar acceso)'}
              <input type="email" maxLength={256} disabled={emailLocked} value={form.corporateEmail} onChange={event => set({ corporateEmail: event.target.value })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Teléfono<PhoneInput value={form.phoneNumber} onChange={phoneNumber => set({ phoneNumber })} /></label>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <label className="text-xs font-semibold">Número de empleado<input required pattern="[A-Za-z0-9\-]{2,32}" data-error="Usa de 2 a 32 letras, dígitos o guiones, p. ej. QA-FIN-010." value={form.employeeNumber} onChange={event => set({ employeeNumber: event.target.value.toUpperCase() })} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Fecha de ingreso<HireDateInput value={form.hireDate} onChange={hireDate => set({ hireDate })} /></label>
            <label className="text-xs font-semibold">Departamento<select disabled={Boolean(employee)} value={form.department} onChange={event => set({ department: event.target.value, positionId: '' })} className={fieldClass}>
              {Object.values(DEPARTMENTS).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
          </div>
          <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => set({ positionId: event.target.value })} className={fieldClass}>
            <option value="">Selecciona…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}{position.isRampPosition ? ' · rampa' : ''}</option>)}</select></label>
          <StationChecks stations={options?.stations ?? []} value={form.stationIds} attempted={attempted} onChange={stationIds => set({ stationIds })} />
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
  const [attempted, setAttempted] = useState(false);
  const intent = useRef(createCommandKeyHolder());
  useEffect(() => {
    if (employee) setForm({ department: '', positionId: '', stationIds: employee.summary.stations.map(station => station.id), reason: '' });
    setError('');
    setAttempted(false);
  }, [employee]);
  if (!employee) return null;
  const positions = (options?.positions ?? []).filter(position => position.department === form.department && position.isActive);
  async function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (stationsProblem(form.stationIds) || reasonProblem(form.reason)) return;
    setBusy(true);
    try {
      const body = { ...form, reason: form.reason.trim(), expectedVersion: employee.summary.version };
      // One intent per body: an uncertain answer repeats the same key (expand phase of 2-N06).
      await intent.current.run('transfer', [employee.summary.id, body], key =>
        transferEmployee(employee.summary.id, body, key));
      onDone('Empleado trasladado. Su cuenta quedó desactivada hasta que el nuevo departamento solicite el acceso.');
    } catch (failure) {
      setError(commandMessage(failure));
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
        {employee.summary.position.isRampPosition && positions.some(position => position.id === form.positionId &&
          !position.isRampPosition) && <p className="text-sm">Al salir de rampa se liberan sus coberturas de posición, las
          operaciones que aún no empiezan y sus turnos futuros, y OCC recibe un aviso por cada operación liberada. Si tiene
          una operación en curso o devuelta para corrección, el traslado no se registra hasta que el agente la envíe desde
          la tablet.</p>}
        <label className="block text-xs font-semibold">Departamento de destino<select required value={form.department} onChange={event => setForm(current => ({ ...current, department: event.target.value, positionId: '' }))} className={fieldClass}>
          <option value="">Selecciona…</option>{Object.values(DEPARTMENTS).filter(key => key !== employee.summary.department).map(key => <option key={key} value={key}>{DEPARTMENT_LABELS[key]}</option>)}</select></label>
        <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => setForm(current => ({ ...current, positionId: event.target.value }))} className={fieldClass}>
          <option value="">Selecciona…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
        <StationChecks stations={options?.stations ?? []} value={form.stationIds} attempted={attempted} onChange={stationIds => setForm(current => ({ ...current, stationIds }))} />
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={2} ref={withRule(reasonProblem(form.reason))} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
      </form>
    </Modal>
  );
}

/** Termination: shows what it will revoke before confirming. */
export function TerminateModal({ employee, onClose, onDone }) {
  const [form, setForm] = useState({ terminatedOn: today(), reason: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const intent = useRef(createCommandKeyHolder());
  useEffect(() => { setForm({ terminatedOn: today(), reason: '' }); setError(''); }, [employee]);
  if (!employee) return null;
  const account = employee.summary.account;
  async function submit(event) {
    event.preventDefault();
    if (reasonProblem(form.reason)) return;
    setBusy(true);
    try {
      const body = { ...form, reason: form.reason.trim(), expectedVersion: employee.summary.version };
      await intent.current.run('terminate', [employee.summary.id, body], key =>
        terminateEmployee(employee.summary.id, body, key));
      // The answer does not say what was released: an agent without coverages, operations or shifts releases
      // nothing, and OCC is only notified of each released operation. The copy never claims that OCC was told.
      onDone(employee.summary.position.isRampPosition
        ? 'Baja registrada. La cuenta quedó desactivada y sin alcances. Si tenía coberturas, operaciones sin iniciar o turnos futuros, se liberaron; OCC recibe un aviso por cada operación liberada.'
        : 'Baja registrada. La cuenta quedó desactivada y sin alcances.');
    } catch (failure) {
      setError(commandMessage(failure));
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
          {employee.summary.position.isRampPosition && <li>Su perfil de agente de rampa queda inactivo: se liberan sus
            coberturas de posición y las operaciones que aún no empiezan, y OCC recibe un aviso por cada operación
            liberada. Si tiene una operación en curso o devuelta para corrección, la baja no se registra hasta que el
            agente la envíe desde la tablet.</li>}
          {employee.futureShifts > 0 && <li>Se quitan sus turnos que aún no empiezan (tiene {employee.futureShifts} desde hoy).</li>}
          <li>La baja es definitiva: la cuenta no podrá reactivarse.</li>
        </ul>
        <label className="block text-xs font-semibold">Fecha de baja<input required type="date" max={today()} min={employee.summary.hireDate} value={form.terminatedOn} onChange={event => setForm(current => ({ ...current, terminatedOn: event.target.value }))} className={fieldClass} /></label>
        <label className="block text-xs font-semibold">Motivo<textarea required minLength={3} maxLength={500} rows={2} ref={withRule(reasonProblem(form.reason))} value={form.reason} onChange={event => setForm(current => ({ ...current, reason: event.target.value }))} className={fieldClass} /></label>
      </form>
    </Modal>
  );
}

/** Creates the record of an account or ramp agent that predates employees. */
export function RegisterDrawer({ person, options, onClose, onSaved }) {
  const [form, setForm] = useState({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [attempted, setAttempted] = useState(false);
  useEffect(() => {
    if (!person) return;
    setError('');
    setAttempted(false);
    setForm({ identificationType: DEFAULT_IDENTIFICATION_TYPE, identificationNumber: '', employeeNumber: person.employeeNumber ?? '',
      positionId: '', hireDate: today(), phoneNumber: '', stationIds: person.stations.map(station => station.id) });
  }, [person]);
  const positions = (options?.positions ?? []).filter(position => position.department === person?.department &&
    position.isActive && (!person?.rampAgentId || position.isRampPosition));
  async function submit(event) {
    event.preventDefault();
    setAttempted(true);
    if (stationsProblem(form.stationIds)) return;
    setBusy(true);
    try {
      await registerEmployee({ ...form,
        identificationNumber: identificationForSubmit(form.identificationType, form.identificationNumber),
        phoneNumber: form.phoneNumber?.trim() || null,
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
            {form.identificationType && (
              <IdentityDocumentFields type={form.identificationType} number={form.identificationNumber ?? ''} required
                types={options?.identificationTypes ?? []} fieldClass={fieldClass}
                onChange={patch => setForm(current => ({ ...current, ...patch }))}
                inputRef={withRule(identificationProblem(form.identificationType, form.identificationNumber ?? ''))} />
            )}
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <label className="text-xs font-semibold">Número de empleado<input required disabled={Boolean(person.employeeNumber)} pattern="[A-Za-z0-9\-]{2,32}"
              data-error="Usa de 2 a 32 letras, dígitos o guiones, p. ej. QA-FIN-010." value={form.employeeNumber} onChange={event => setForm(current => ({ ...current, employeeNumber: event.target.value.toUpperCase() }))} className={fieldClass} /></label>
            <label className="text-xs font-semibold">Fecha de ingreso<HireDateInput value={form.hireDate} onChange={hireDate => setForm(current => ({ ...current, hireDate }))} /></label>
          </div>
          <label className="block text-xs font-semibold">Puesto<select required value={form.positionId} onChange={event => setForm(current => ({ ...current, positionId: event.target.value }))} className={fieldClass}>
            <option value="">Selecciona…</option>{positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}</select></label>
          <label className="block text-xs font-semibold">Teléfono<PhoneInput value={form.phoneNumber} onChange={phoneNumber => setForm(current => ({ ...current, phoneNumber }))} /></label>
          <StationChecks stations={options?.stations ?? []} value={form.stationIds ?? []} attempted={attempted} onChange={stationIds => setForm(current => ({ ...current, stationIds }))} />
        </form>
      )}
    </Drawer>
  );
}
