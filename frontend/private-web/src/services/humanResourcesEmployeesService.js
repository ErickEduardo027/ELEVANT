import { commercialApi } from './commercialGovernanceApi';
import { COMMON_PROBLEM_MESSAGES, problemMessage } from './problemMessages';

const json = (method, body) => ({ method, body: JSON.stringify(body) });
const query = params => {
  const search = new URLSearchParams();
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== '') search.set(key, String(value));
  });
  const text = search.toString();
  return text ? `?${text}` : '';
};
const hr = '/human-resources';
const dept = department => `/governance/departments/${encodeURIComponent(department)}`;

// Human Resources records (ADR-0017).
export const listEmployees = (filters = {}) => commercialApi(`${hr}/employees${query({ page: 1, limit: 50, ...filters })}`);
export const getEmployee = id => commercialApi(`${hr}/employees/${id}`);
export const getEmployeeOptions = () => commercialApi(`${hr}/employees/options`);
export const createEmployee = values => commercialApi(`${hr}/employees`, json('POST', values));
export const updateEmployee = (id, values) => commercialApi(`${hr}/employees/${id}`, json('PUT', values));
const keyed = idempotencyKey => (idempotencyKey ? { headers: { 'Idempotency-Key': idempotencyKey } } : {});
/**
 * Transfers the employee with the `version` on screen and the intent's Idempotency-Key. Leaving the ramp releases the
 * agent's coverages, unstarted operations and shifts (2-N06), or fails with `agent_has_operation_in_progress`.
 */
export const transferEmployee = (id, values, idempotencyKey) =>
  commercialApi(`${hr}/employees/${id}/transfer`, { ...json('POST', values), ...keyed(idempotencyKey) });
/**
 * Terminates the employee on a date up to AVIAM's today (2-N31) with the intent's Idempotency-Key; their ramp work is
 * released the same way (2-N06).
 */
export const terminateEmployee = (id, values, idempotencyKey) =>
  commercialApi(`${hr}/employees/${id}/termination`, { ...json('POST', values), ...keyed(idempotencyKey) });
export const listUnregisteredPersons = () => commercialApi(`${hr}/employees/unregistered`);
export const registerEmployee = values => commercialApi(`${hr}/employees/registrations`, json('POST', values));

export const listPositions = department => commercialApi(`${hr}/positions${query({ department })}`);
export const savePosition = (id, values) =>
  commercialApi(id ? `${hr}/positions/${id}` : `${hr}/positions`, json(id ? 'PUT' : 'POST', values));

export const listRequisitions = (filters = {}) => commercialApi(`${hr}/requisitions${query(filters)}`);
export const changeRequisitionStatus = (id, values) =>
  commercialApi(`${hr}/requisitions/${id}/status`, json('POST', values));

export const listAudit = (filters = {}) => commercialApi(`${hr}/audit${query({ limit: 50, ...filters })}`);

// Department side: candidates, suggested profile of positions, requisitions and activity.
export const listAccessCandidates = (department, search) =>
  commercialApi(`${dept(department)}/access-candidates${query({ search })}`);
export const listDepartmentPositions = department => commercialApi(`${dept(department)}/positions`);
export const setSuggestedProfile = (department, positionId, values) =>
  commercialApi(`${dept(department)}/positions/${positionId}/suggested-access-profile`, json('PUT', values));
export const listDepartmentRequisitions = (department, status) =>
  commercialApi(`${dept(department)}/requisitions${query({ status })}`);
export const createRequisition = (department, values) =>
  commercialApi(`${dept(department)}/requisitions`, json('POST', values));
export const cancelRequisition = (id, values) =>
  commercialApi(`/governance/requisitions/${id}/cancel`, json('POST', values));
export const listDepartmentActivity = (department, filters = {}) =>
  commercialApi(`${dept(department)}/activity${query({ limit: 50, ...filters })}`);

export const IDENTIFICATION_LABELS = { CEDULA: 'Cédula', PASAPORTE: 'Pasaporte', RESIDENCIA: 'Residencia' };
export const EMPLOYEE_STATUS = {
  Active: { label: 'Activo', tone: 'success' },
  Terminated: { label: 'Baja', tone: 'neutral' },
};
export const REQUISITION_STATUS = {
  Open: { label: 'Abierta', tone: 'warning' },
  InProgress: { label: 'En proceso', tone: 'info' },
  Fulfilled: { label: 'Cubierta', tone: 'success' },
  Rejected: { label: 'Rechazada', tone: 'danger' },
  Cancelled: { label: 'Cancelada', tone: 'neutral' },
};

const MESSAGES = {
  identification_invalid: 'La identificación no tiene el formato real de su tipo (cédula o residencia con dígito verificador, o pasaporte).',
  identification_in_use: 'Ya existe una persona con esa identificación.',
  identification_mismatch: 'La identificación no coincide con la que ya tiene registrada la persona.',
  employee_number_invalid: 'El número de empleado solo admite letras, números y guiones (2 a 32).',
  employee_number_in_use: 'Ese número de empleado ya está asignado.',
  phone_invalid: 'El teléfono no es válido: use 10 dígitos dominicanos (809, 829 o 849) o el prefijo internacional.',
  email_invalid: 'El correo no es válido.',
  email_in_use: 'Ese correo ya pertenece a otra persona o cuenta.',
  hire_date_invalid: 'La fecha de ingreso no es válida.',
  position_invalid: 'El puesto no existe, está inactivo o es de otro departamento.',
  position_name_in_use: 'Ya existe un puesto con ese nombre en el departamento.',
  position_in_use: 'El puesto tiene empleados activos; no puede cambiar su tipo.',
  position_department_fixed: 'El departamento de un puesto no se puede cambiar.',
  ramp_position_outside_operations: 'Los puestos de rampa solo existen en el Centro de Operaciones.',
  ramp_position_has_no_profile: 'Los puestos de rampa usan la app móvil y no llevan perfil de acceso.',
  stations_invalid: 'Alguna estación no está activa o no está bajo su alcance.',
  stations_outside_employee: 'Solo puede otorgar estaciones donde trabaja el empleado.',
  requisition_invalid: 'La requisición no está abierta o no corresponde a ese puesto.',
  use_transfer: 'Para cambiar de departamento use «Trasladar».',
  same_department: 'El empleado ya pertenece a ese departamento.',
  employee_terminated: 'El empleado está dado de baja; su cuenta no puede reactivarse.',
  employee_email_locked: 'El correo no puede cambiar mientras el empleado tenga cuenta.',
  ramp_position_requires_inactive_account: 'Desactive la cuenta antes de cambiar entre un puesto de rampa y uno de oficina.',
  termination_before_hire: 'La fecha de baja es anterior al ingreso.',
  already_registered: 'Esa persona ya tiene expediente.',
  ramp_agent_requires_ramp_position: 'Un agente de rampa necesita un puesto de rampa.',
  employee_not_found: 'El empleado no existe en su departamento.',
  employee_has_account: 'El empleado ya tiene una cuenta activa.',
  employee_without_email: 'El empleado no tiene correo corporativo; Gestión Humana debe registrarlo.',
  employee_changed: 'El empleado cambió de departamento o fue dado de baja después de la solicitud.',
  request_pending: 'Ya hay una solicitud pendiente para ese empleado.',
  ramp_agents_have_no_profile: 'Los agentes de rampa no llevan perfil de acceso web.',
  terminals_invalid: 'Alguna terminal no pertenece a las estaciones elegidas.',
  supervisor_invalid: 'El supervisor no es un agente activo.',
  permissions_invalid: 'Elija una plantilla activa o al menos un permiso del departamento.',
  password_policy: 'La contraseña temporal no cumple la política (14+ caracteres, mayúscula, minúscula, número y símbolo).',
  profile_inactive: 'La plantilla de la solicitud ya no está activa.',
  profile_invalid: 'La plantilla no existe o está inactiva.',
  members_are_requested: 'Los usuarios se solicitan y Gestión Humana los valida.',
  administrators_use_back_office: 'Un administrador debe ocupar un puesto de oficina, no de rampa.',
  employee_record_managed_by_hr: 'El nombre y el correo los gestiona Gestión Humana en el expediente.',
  reason_required: 'Indique el motivo (3 a 500 caracteres).',
  department_mismatch: 'El puesto y el expediente deben pertenecer al departamento elegido.',
  permissions_required: 'Un sub-usuario necesita una plantilla o al menos un permiso.',
  ramp_agents_use_requests: 'Los agentes de rampa se solicitan desde Centro de Operaciones (requieren supervisor y terminales).',
  stations_outside_employee: 'Las estaciones de la cuenta deben ser estaciones del empleado.',
  // Phase 2, block D: the release of a ramp agent's work on termination or transfer (2-N06, 2-N31).
  agent_has_operation_in_progress:
    'El agente tiene una operación en curso o devuelta para corrección. Pida a OCC que la cierre antes de continuar.',
  termination_date_invalid: 'La fecha de baja no puede ser posterior a hoy.',
  invalid_transfer: 'Elija el departamento de destino y entre 1 y 20 estaciones.',
  protected_person: 'Nadie puede trasladarse o darse de baja a sí mismo ni al superadministrador.',
  version_conflict: 'El expediente cambió mientras lo revisaba. Vuelva a abrirlo e intente de nuevo.',
  idempotency_conflict: 'Ese envío ya se usó con otros datos. Vuelva a abrir el expediente e intente de nuevo.',
  not_found: 'El empleado ya no existe o no está en su alcance.',
  // Phase 2, block E: governance commands always answer a code (2-N39).
  employee_transferred: 'El empleado se trasladó a otro departamento: solo ese departamento solicita su acceso y Gestión Humana lo valida.',
  requester_no_longer_administrator: 'Quien pidió este acceso ya no administra el departamento. Rechace la solicitud o pida al departamento una nueva.',
  access_request_closed: 'La solicitud ya fue resuelta o cancelada. Se actualizó la bandeja.',
  invalid_department_user: 'Revise el nombre, el correo y elija entre 1 y 20 estaciones.',
  invalid_access_request: 'Revise el empleado, las estaciones y las terminales de la solicitud.',
  invalid_access_profile: 'La plantilla necesita un nombre de 3 a 80 caracteres y al menos un permiso del departamento.',
  invalid_internal_user: 'Revise el tipo de cuenta, la contraseña temporal y las estaciones.',
  avatar_invalid: 'La foto ya no está disponible; vuelva a cargarla.',
  profile_name_in_use: 'Ya existe una plantilla activa con ese nombre.',
  profile_has_pending_requests: 'La plantilla tiene solicitudes pendientes; resuélvalas antes de desactivarla.',
  legacy_role_converted: 'El rol ya se convirtió en plantilla.',
  legacy_role_empty: 'El rol no tiene permisos que convertir.',
  role_missing: 'Falta el rol base del departamento. Contacte a soporte.',
  legacy_governance_retired: 'Esta función se retiró: el acceso se solicita para un empleado y Gestión Humana lo valida.',
  governance_conflict: 'Los datos cambiaron mientras los editaba. Actualice e intente de nuevo.',
  invalid_governance_data: 'Revise los datos e intente de nuevo.',
  protected_user: 'Esa cuenta está protegida: no puede modificarla desde aquí.',
  forbidden: 'No tiene permiso para esta acción.',
};

/** The rule messages of the employee commands, for screens that resolve them with `problemMessage`. */
export const EMPLOYEE_MESSAGES = Object.freeze({ ...MESSAGES });

const known = code => typeof code === 'string' &&
  (Object.prototype.hasOwnProperty.call(MESSAGES, code) || Object.prototype.hasOwnProperty.call(COMMON_PROBLEM_MESSAGES, code));

const DEFAULT_CONFLICT = 'Los datos cambiaron mientras los editaba. Se actualizó la vista.';
/** Codes that only say «it changed»: a screen that names its own conflict explains them in its words. */
const GENERIC_CONFLICTS = new Set(['version_conflict', 'governance_conflict']);

/**
 * Message for a governance failure from its code (2-N39): the server title and any exception text are never shown.
 * `conflictFallback` explains a 409 whose code the screen does not know or that only says the record changed.
 */
export function governanceMessage(error, conflictFallback) {
  if (error?.status === 409 &&
      (!known(error?.code) || (conflictFallback && GENERIC_CONFLICTS.has(error.code))))
    return conflictFallback ?? DEFAULT_CONFLICT;
  return problemMessage(error, MESSAGES);
}
