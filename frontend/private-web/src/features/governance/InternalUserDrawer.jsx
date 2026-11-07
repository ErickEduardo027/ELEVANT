import { useEffect, useMemo, useState, useRef } from 'react';
import Drawer from '../../components/Drawer';
import { identificationProblem } from '../employees/EmployeeForms';
import GeneratePasswordField from '../department-users/GeneratePasswordField';
import PermissionMatrix from '../department-users/PermissionMatrix';
import {
  createInternalUser, DEPARTMENT_LABELS, getDepartmentOptions, getPermissionCatalog,
} from '../../services/departmentGovernanceService';
import { governanceMessage, IDENTIFICATION_LABELS, listPositions } from '../../services/humanResourcesEmployeesService';
import { createCommandKeyHolder } from '../../services/commandKeys';

const field = 'mt-1 block w-full rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:border-white/10 dark:bg-surface-dark';
const today = () => new Date().toISOString().slice(0, 10);
const EMPTY = {
  firstName: '', lastName: '', identificationType: 'CEDULA', identificationNumber: '', employeeNumber: '',
  positionId: '', hireDate: today(), phoneNumber: '', corporateEmail: '', stationIds: [], kind: 'member',
  permissionCodes: [], temporaryPassword: '',
};

/**
 * Super administrator form that registers the employee and creates its account in one step
 * (no Human Resources request). Members get per-option and per-sub-window permissions from the
 * matrix; administrators hold the whole department.
 */
export default function InternalUserDrawer({ open, initialDepartment, onClose, onCreated }) {
  const [department, setDepartment] = useState(initialDepartment ?? 'contracts');
  const [form, setForm] = useState(EMPTY);
  const [reference, setReference] = useState({ status: 'loading', positions: [], stations: [], catalog: null });
  const [busy, setBusy] = useState(false);
  const keys = useRef(createCommandKeyHolder());
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) return undefined;
    let active = true;
    setReference(current => ({ ...current, status: 'loading' }));
    Promise.all([listPositions(department), getDepartmentOptions(department), getPermissionCatalog()])
      .then(([positions, options, catalogs]) => {
        if (!active) return;
        setReference({
          status: 'ready',
          positions: (positions ?? []).filter(position => position.isActive && !position.isRampPosition),
          stations: options?.stations ?? [],
          catalog: catalogs?.find(item => item.department === department) ?? null,
        });
      })
      .catch(failure => { if (active) setReference({ status: 'error', positions: [], stations: [], catalog: null, message: governanceMessage(failure) }); });
    return () => { active = false; };
  }, [open, department]);

  const set = values => { setForm(current => ({ ...current, ...values })); setError(''); };
  const changeDepartment = value => { setDepartment(value); set({ positionId: '', stationIds: [], permissionCodes: [] }); };
  const documentProblem = identificationProblem(form.identificationType, form.identificationNumber);
  const missing = useMemo(() => {
    if (form.firstName.trim().length < 2 || form.lastName.trim().length < 2) return 'Escribe el nombre y el apellido.';
    if (!form.identificationNumber.trim()) return 'Escribe el número de documento.';
    if (documentProblem) return documentProblem;
    if (!form.employeeNumber.trim()) return 'Escribe el número de empleado.';
    if (!form.positionId) return 'Elige el puesto.';
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(form.corporateEmail.trim())) return 'El correo corporativo es el usuario de acceso.';
    if (form.stationIds.length === 0) return 'Elige al menos una estación.';
    if (form.kind === 'member' && form.permissionCodes.length === 0) return 'Marca al menos un permiso en la matriz.';
    if (form.temporaryPassword.length < 14) return 'Define la contraseña temporal (14+ caracteres).';
    return '';
  }, [form, documentProblem]);

  async function submit(event) {
    event.preventDefault();
    if (missing) { setError(missing); return; }
    setBusy(true);
    try {
      const body = {
        employee: {
          firstName: form.firstName.trim(), lastName: form.lastName.trim(), identificationType: form.identificationType,
          identificationNumber: form.identificationNumber, employeeNumber: form.employeeNumber.trim(), department,
          positionId: form.positionId, stationIds: form.stationIds, hireDate: form.hireDate,
          phoneNumber: form.phoneNumber.trim() || null, corporateEmail: form.corporateEmail.trim(),
        },
        kind: form.kind,
        temporaryPassword: form.temporaryPassword,
        stationIds: form.stationIds,
        permissionCodes: form.kind === 'member' ? form.permissionCodes : [],
      };
      // The temporary password is part of the intent: a retry sends the same one with the same key.
      const created = await keys.current.run('internal-user.create', { department, ...body },
        key => createInternalUser(department, body, key));
      setForm(EMPTY);
      onCreated?.(created, `${form.firstName.trim()} ${form.lastName.trim()} ya puede entrar con su correo y la contraseña temporal; deberá cambiarla en el primer acceso.`);
    } catch (failure) {
      setError(governanceMessage(failure, 'Los datos cambiaron. Revisa e inténtalo de nuevo.'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Drawer open={open} onClose={onClose} widthClassName="lg:w-[880px]" title="Nuevo usuario interno"
      description="Registra el expediente del empleado y su cuenta en un solo paso, sin solicitud a Gestión Humana."
      footer={<div className="flex justify-end gap-2">
        <button type="button" onClick={onClose} className="rounded-lg border px-4 py-2 text-sm">Cancelar</button>
        <button type="submit" form="internal-user-form" disabled={busy} className="rounded-lg bg-accent-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{busy ? 'Creando…' : 'Crear usuario'}</button>
      </div>}>
      <form id="internal-user-form" onSubmit={submit} noValidate className="space-y-5 text-sm">
        <label className="block text-xs font-semibold">Departamento
          <select className={field} value={department} onChange={event => changeDepartment(event.target.value)}>
            {Object.entries(DEPARTMENT_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>

        <fieldset className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <legend className="mb-2 font-semibold">Expediente del empleado</legend>
          <label className="text-xs font-semibold">Nombre<input className={field} value={form.firstName} maxLength={100} onChange={event => set({ firstName: event.target.value })} /></label>
          <label className="text-xs font-semibold">Apellido<input className={field} value={form.lastName} maxLength={100} onChange={event => set({ lastName: event.target.value })} /></label>
          <label className="text-xs font-semibold">Tipo de documento
            <select className={field} value={form.identificationType} onChange={event => set({ identificationType: event.target.value })}>
              {Object.entries(IDENTIFICATION_LABELS).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Número de documento
            <input className={field} value={form.identificationNumber} maxLength={20} aria-invalid={Boolean(form.identificationNumber && documentProblem)}
              onChange={event => set({ identificationNumber: event.target.value })} />
            {form.identificationNumber && documentProblem && <span className="mt-1 block text-[11px] font-normal text-status-danger">{documentProblem}</span>}</label>
          <label className="text-xs font-semibold">Número de empleado<input className={field} value={form.employeeNumber} maxLength={20} onChange={event => set({ employeeNumber: event.target.value })} /></label>
          <label className="text-xs font-semibold">Puesto
            <select className={field} value={form.positionId} onChange={event => set({ positionId: event.target.value })}>
              <option value="">{reference.status === 'loading' ? 'Cargando puestos…' : 'Elige un puesto'}</option>
              {reference.positions.map(position => <option key={position.id} value={position.id}>{position.name}</option>)}
            </select></label>
          <label className="text-xs font-semibold">Fecha de ingreso<input type="date" className={field} value={form.hireDate} onChange={event => set({ hireDate: event.target.value })} /></label>
          <label className="text-xs font-semibold">Teléfono (opcional)<input className={field} value={form.phoneNumber} maxLength={20} onChange={event => set({ phoneNumber: event.target.value })} /></label>
          <label className="text-xs font-semibold sm:col-span-2">Correo corporativo (usuario de acceso)<input type="email" className={field} value={form.corporateEmail} maxLength={256} onChange={event => set({ corporateEmail: event.target.value })} /></label>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-semibold">Estaciones</legend>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {reference.stations.map(station => (
              <label key={station.id} className="flex min-h-[32px] items-center gap-2">
                <input type="checkbox" checked={form.stationIds.includes(station.id)}
                  onChange={event => set({ stationIds: event.target.checked ? [...form.stationIds, station.id] : form.stationIds.filter(id => id !== station.id) })} />
                {station.code} · {station.name}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset>
          <legend className="mb-2 font-semibold">Tipo de cuenta</legend>
          <div className="flex flex-wrap gap-4">
            {[['member', 'Sub-usuario con permisos por opción'], ['administrator', 'Administrador del departamento']].map(([value, label]) => (
              <label key={value} className="flex items-center gap-2"><input type="radio" name="internal-kind" value={value} checked={form.kind === value} onChange={() => set({ kind: value })} />{label}</label>
            ))}
          </div>
        </fieldset>

        {form.kind === 'member' && (
          <section aria-label="Permisos">
            <h3 className="mb-2 font-semibold">Permisos por opción y subventana</h3>
            <PermissionMatrix catalog={reference.catalog} value={form.permissionCodes} idPrefix="internal-perm"
              onChange={permissionCodes => set({ permissionCodes })} />
          </section>
        )}

        <GeneratePasswordField id="internal-user-password" value={form.temporaryPassword} label="Contraseña temporal"
          fieldClassName="text-xs font-semibold" inputClassName={field} onChange={temporaryPassword => set({ temporaryPassword })} />

        {reference.status === 'error' && <p role="alert" className="text-status-danger">{reference.message}</p>}
        {error && <p role="alert" className="rounded-lg border border-status-danger/30 bg-status-danger/10 p-3 text-status-danger">{error}</p>}
      </form>
    </Drawer>
  );
}
