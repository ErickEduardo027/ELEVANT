import { commercialApi } from './commercialGovernanceApi';

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
export const transferEmployee = (id, values) => commercialApi(`${hr}/employees/${id}/transfer`, json('POST', values));
export const terminateEmployee = (id, values) => commercialApi(`${hr}/employees/${id}/termination`, json('POST', values));
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
};

/** Message for a governance failure: the server's rule code wins over the generic title. */
export function governanceMessage(error, fallback) {
  if (error?.code && MESSAGES[error.code]) return MESSAGES[error.code];
  if (error?.status === 409) return fallback ?? 'Los datos cambiaron mientras los editaba. Se actualizó la vista.';
  if (error?.status === 403) return 'No tiene permiso para esta acción.';
  return error?.message ?? 'No se pudo completar la acción.';
}
