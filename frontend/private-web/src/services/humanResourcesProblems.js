/**
 * Spanish messages of the Gestión Humana commands of phase 2 (block D), by Problem Details code: the release of a
 * ramp agent's work (bajas, traslados y ausencias), the availability requests and the amendment of an approved
 * absence, and the shifts. Screens resolve them with `problemMessage(error, HUMAN_RESOURCES_PROBLEMS)`; the server
 * title is never shown.
 */
export const HUMAN_RESOURCES_PROBLEMS = Object.freeze({
  agent_has_operation_in_progress:
    'El agente tiene una operación en curso o devuelta para corrección en esos días. Ciérrela en OCC antes de continuar.',
  invalid_availability_request: 'Revise las fechas, el tipo y el motivo de la solicitud.',
  agent_unavailable: 'El agente ya no está activo en rampa.',
  availability_overlap: 'Ya hay una solicitud pendiente o aprobada del mismo tipo en esas fechas.',
  availability_request_closed: 'La solicitud ya fue decidida. Actualizamos la lista.',
  absence_not_approved: 'Solo se cancela o acorta una ausencia aprobada. Actualizamos la lista.',
  absence_started: 'La ausencia ya empezó: no se cancela, pero puede acortarla.',
  absence_ended: 'La ausencia ya terminó y queda en el historial.',
  absence_end_invalid:
    'El nuevo último día debe ser anterior al actual, no antes de su primer día ni antes de ayer.',
  invalid_absence_amendment: 'Elija cancelar o acortar e indique el nuevo último día solo al acortar.',
  invalid_shift: 'Revise los datos del turno.',
  shift_scope_missing: 'El agente no tiene esa estación o terminal vigente ese día.',
  shift_day_taken: 'El agente ya tiene un turno ese día.',
  shift_on_approved_absence: 'El agente tiene una ausencia aprobada ese día: no se le programa turno.',
  shift_in_past: 'Los turnos de días pasados no se quitan: quedan en el historial.',
  shift_in_use:
    'El agente ya cubre posiciones o tiene operaciones asignadas en ese turno. Pida a OCC que las libere antes de quitarlo.',
  termination_date_invalid: 'La fecha de baja no puede ser posterior a hoy.',
  termination_before_hire: 'La fecha de baja es anterior al ingreso.',
  invalid_transfer: 'Elija el departamento de destino y entre 1 y 20 estaciones.',
  protected_person: 'Nadie puede trasladarse o darse de baja a sí mismo ni al superadministrador.',
  employee_terminated: 'El empleado ya está dado de baja.',
  same_department: 'El empleado ya pertenece a ese departamento.',
  position_invalid: 'El puesto no existe, está inactivo o es de otro departamento.',
  stations_invalid: 'Alguna estación no está activa o no está bajo su alcance.',
  reason_required: 'Indique el motivo del cambio.',
});

/** Why an assigned agent cannot do the operation on its date (planning board, 2-N25). */
export const ASSIGNMENT_UNFIT_LABELS = Object.freeze({
  agent_inactive: 'Ya no trabaja en rampa',
  approved_absence: 'Ausencia aprobada',
  airport_id_not_current: 'Carnet aeroportuario no vigente',
  ramp_driver_license_not_current: 'Licencia de rampa no vigente',
});

/** The marks of an assignment in Spanish, in the server's order; an unknown reason keeps a generic text. */
export function describeUnfitReasons(reasons) {
  return (Array.isArray(reasons) ? reasons : [])
    .map(reason => ASSIGNMENT_UNFIT_LABELS[reason] ?? 'No apto para la operación');
}
