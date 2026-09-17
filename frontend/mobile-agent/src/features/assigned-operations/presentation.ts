import type { RampAssignedOperationResponse } from '@elevant/api-client';

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

export function serviceStatusTone(status: string): OperationStatusTone {
  if (status === 'Completed') return 'green';
  if (status === 'InProgress' || status === 'Planned') return 'orange';
  if (status === 'NotPerformed' || status === 'Exception') return 'red';
  return 'orange';
}

export function formatOperationTime(
  value: string | null | undefined,
  timeZone?: string,
) {
  if (!value) return '—';

  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || !timeZone) return '—';

  try {
    return new Intl.DateTimeFormat('es-DO', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(date);
  } catch {
    return '—';
  }
}

export function formatOperationDate(value: string) {
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;

  return new Intl.DateTimeFormat('es-DO', {
    weekday: 'short',
    day: '2-digit',
    month: 'short',
    timeZone: 'UTC',
  }).format(date);
}

export function operationFlightLabel(operation: RampAssignedOperationResponse) {
  const { arrival, departure, operationCode } = operation.turnaround;
  if (arrival && departure) return `${arrival.flightNumber} · ${departure.flightNumber}`;
  return arrival?.flightNumber ?? departure?.flightNumber ?? operationCode;
}

export function operationRoute(operation: RampAssignedOperationResponse) {
  const { arrival, departure, station } = operation.turnaround;

  if (!arrival && !departure) {
    return {
      origin: station.code,
      station: station.code,
      destination: 'Ruta por confirmar',
    };
  }

  return {
    origin: arrival?.origin.iataCode ?? station.code,
    station: station.code,
    destination: departure?.destination.iataCode ?? station.code,
  };
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
