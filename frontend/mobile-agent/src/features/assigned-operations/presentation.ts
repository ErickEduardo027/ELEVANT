import type { RampAssignedOperationResponse } from '@elevant/api-client';
import { formatStationDate, formatStationTime } from '../../utils/date-format';

export type OperationStatusTone = 'blue' | 'green' | 'orange' | 'red';

const operationStatusLabels: Record<string, string> = {
  Planned: 'Planificada',
  Assigned: 'Asignada',
  InProgress: 'En atención',
  PendingReview: 'Pendiente de revisión',
  InReview: 'En revisión',
  Approved: 'Aprobada',
  Returned: 'Devuelta',
  Cancelled: 'Cancelada',
};

const serviceStatusLabels: Record<string, string> = {
  Planned: 'Planificado',
  InProgress: 'En ejecución',
  Completed: 'Completado',
  NotPerformed: 'No realizado',
  Exception: 'Excepción',
};

export function operationStatusLabel(status: string) {
  return operationStatusLabels[status] ?? 'Estado por confirmar';
}

export function operationStatusTone(status: string): OperationStatusTone {
  if (status === 'Approved') return 'green';
  if (status === 'InProgress' || status === 'PendingReview' || status === 'InReview') {
    return 'orange';
  }
  if (status === 'Returned' || status === 'Cancelled') return 'red';
  return 'blue';
}

export function serviceStatusLabel(status: string) {
  return serviceStatusLabels[status] ?? 'Estado por confirmar';
}

// 3-G: OCC takes an incident into review, resolves it or closes it while the flight is still on the ramp.
const incidentStatusLabels: Record<string, string> = {
  Open: 'Registrada',
  InReview: 'En revisión de OCC',
  Resolved: 'Resuelta',
  Closed: 'Cerrada',
};

/** The state of an incident in Spanish, never its code. */
export function incidentStatusLabel(status: string) {
  return Object.prototype.hasOwnProperty.call(incidentStatusLabels, status)
    ? incidentStatusLabels[status]
    : 'Estado por confirmar';
}

export function serviceStatusTone(status: string): OperationStatusTone {
  if (status === 'Completed') return 'green';
  if (status === 'InProgress' || status === 'Planned') return 'orange';
  if (status === 'NotPerformed' || status === 'Exception') return 'red';
  return 'orange';
}

/** «19:46» at the station (N11); a station without a known zone uses AVIAM's calendar. */
export function formatOperationTime(
  value: string | null | undefined,
  timeZone?: string,
) {
  return formatStationTime(value, timeZone);
}

/** The operation's business day as «lun, 16 nov» (N11): the date itself, whatever the zone. */
export function formatOperationDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return formatStationDate(date, 'UTC');
}

/**
 * Each station's IANA zone by its code, from the operations the tablet holds (N11): the only place the tablet learns
 * it. A station missing here shows its times in AVIAM's calendar.
 */
export function stationTimeZonesByCode(
  operations: readonly RampAssignedOperationResponse[],
): ReadonlyMap<string, string> {
  return new Map(operations.map(item => [item.turnaround.station.code, item.turnaround.station.ianaTimeZone]));
}

export function operationFlightLabel(operation: RampAssignedOperationResponse) {
  const { arrival, departure, operationCode } = operation.turnaround;
  if (arrival && departure) return `${arrival.flightNumber} · ${departure.flightNumber}`;
  return arrival?.flightNumber ?? departure?.flightNumber ?? operationCode;
}

/** A stop of the route: where the aircraft comes from, the station where the agent works or where it goes next. */
export type OperationRouteStop = Readonly<{ code: string; kind: 'origin' | 'station' | 'destination' }>;

/**
 * The stops in the order the aircraft makes them (N10, D-N10): «BWI → PUJ → BWI» for a turnaround at PUJ. A missing
 * leg is left out, never replaced by the station, so a turnaround without flights is the station alone.
 */
export function operationRouteStops(operation: RampAssignedOperationResponse): readonly OperationRouteStop[] {
  const { arrival, departure, station } = operation.turnaround;
  return [
    ...(arrival ? [{ code: arrival.origin.iataCode, kind: 'origin' as const }] : []),
    { code: station.code, kind: 'station' as const },
    ...(departure ? [{ code: departure.destination.iataCode, kind: 'destination' as const }] : []),
  ];
}

/** The route as a screen reader says it: «llega de BWI a PUJ y sale hacia BWI» (N10). */
export function operationRouteDescription(operation: RampAssignedOperationResponse) {
  const { arrival, departure, station } = operation.turnaround;
  if (arrival && departure) {
    return `llega de ${arrival.origin.iataCode} a ${station.code} y sale hacia ${departure.destination.iataCode}`;
  }
  if (arrival) return `llega de ${arrival.origin.iataCode} a ${station.code}`;
  if (departure) return `sale de ${station.code} hacia ${departure.destination.iataCode}`;
  return `estación ${station.code}, ruta por confirmar`;
}

// N9 (D-N9): the role OCC writes on an assignment; «primary» is the only one it writes today.
const assignmentRoleLabels: Record<string, string> = {
  primary: 'Agente principal',
};

/** The assignment's role in Spanish, whatever its casing; null for a role this version does not know. */
export function assignmentRoleLabel(role: string): string | null {
  const key = role.toLowerCase();
  return Object.prototype.hasOwnProperty.call(assignmentRoleLabels, key) ? assignmentRoleLabels[key] : null;
}

export function operationStandLabel(operation: RampAssignedOperationResponse) {
  const { stand } = operation.turnaround;
  if (!stand) return 'Stand por confirmar';
  return stand.terminal ? `${stand.terminal.code} · ${stand.code}` : stand.code;
}

export function operationAircraftLabel(operation: RampAssignedOperationResponse) {
  const { aircraft } = operation.turnaround;
  if (!aircraft) return 'Aeronave por confirmar';
  return [aircraft.manufacturer, aircraft.model, aircraft.registration]
    .filter(Boolean)
    .join(' · ');
}

export function operationPrimaryTime(operation: RampAssignedOperationResponse) {
  return (
    operation.operation.actualStartAt ??
    operation.operation.plannedStartAt ??
    operation.turnaround.arrival?.actualAt ??
    operation.turnaround.arrival?.estimatedAt ??
    operation.turnaround.arrival?.scheduledAt ??
    operation.turnaround.departure?.actualAt ??
    operation.turnaround.departure?.estimatedAt ??
    operation.turnaround.departure?.scheduledAt ??
    null
  );
}

export function operationPrimaryTimeLabel(operation: RampAssignedOperationResponse) {
  if (operation.operation.actualStartAt) return 'Inicio real';
  if (operation.operation.plannedStartAt) return 'Inicio planificado';

  const arrival = operation.turnaround.arrival;
  if (arrival?.actualAt) return 'Llegada real';
  if (arrival?.estimatedAt) return 'Llegada estimada';
  if (arrival?.scheduledAt) return 'Llegada programada';

  const departure = operation.turnaround.departure;
  if (departure?.actualAt) return 'Salida real';
  if (departure?.estimatedAt) return 'Salida estimada';
  if (departure?.scheduledAt) return 'Salida programada';
  return 'Horario por confirmar';
}

export function flightLegTimeLabel(
  leg: RampAssignedOperationResponse['turnaround']['arrival'],
) {
  if (!leg) return { label: 'Sin horario', value: null } as const;
  if (leg.actualAt) return { label: 'Real', value: leg.actualAt } as const;
  if (leg.estimatedAt) return { label: 'Estimado', value: leg.estimatedAt } as const;
  return { label: 'Programado', value: leg.scheduledAt } as const;
}
