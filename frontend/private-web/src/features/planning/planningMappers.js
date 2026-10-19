import { createTranslator } from '../../i18n/languageStore';
import { planningMessages } from './planningMessages';

function copyAirport(airport) {
  return airport ? { ...airport } : null;
}

function copyFlightLeg(leg) {
  if (!leg) return null;

  return {
    ...leg,
    origin: copyAirport(leg.origin),
    destination: copyAirport(leg.destination),
  };
}

function copyStand(stand) {
  if (!stand) return null;

  return {
    ...stand,
    terminal: stand.terminal ? { ...stand.terminal } : null,
  };
}

function selectTimelineTime(turnaround, arrival, departure) {
  if (turnaround.operation?.plannedStartAt) {
    return {
      timelineTime: turnaround.operation.plannedStartAt,
      timelineTimeSource: 'operation.plannedStartAt',
    };
  }

  if (arrival?.scheduledAt) {
    return {
      timelineTime: arrival.scheduledAt,
      timelineTimeSource: 'arrival.scheduledAt',
    };
  }

  if (departure?.scheduledAt) {
    return {
      timelineTime: departure.scheduledAt,
      timelineTimeSource: 'departure.scheduledAt',
    };
  }

  return { timelineTime: null, timelineTimeSource: null };
}

function uniqueText(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))];
}

function mapTurnaround(turnaround, station) {
  const airline = { ...turnaround.airline };
  const aircraft = turnaround.aircraft ? { ...turnaround.aircraft } : null;
  const stand = copyStand(turnaround.stand);
  const arrival = copyFlightLeg(turnaround.arrival);
  const departure = copyFlightLeg(turnaround.departure);
  const operation = turnaround.operation ? { ...turnaround.operation } : null;
  const assignedAgents = turnaround.agents.map(agent => ({ ...agent }));
  const assignedEquipment = turnaround.equipment.map(equipment => ({ ...equipment }));
  const assignedServices = turnaround.services.map(service => ({ ...service }));
  const { timelineTime, timelineTimeSource } = selectTimelineTime(turnaround, arrival, departure);
  const flightNumbers = uniqueText([arrival?.flightNumber, departure?.flightNumber]);
  const resourceState = {
    standAssigned: stand !== null,
    agentsAssigned: assignedAgents.length > 0,
    equipmentAssigned: assignedEquipment.length > 0,
    servicesPlanned: assignedServices.length > 0,
  };

  return {
    id: turnaround.id,
    turnaroundId: turnaround.id,
    operationCode: turnaround.operationCode,
    operationDate: turnaround.operationDate,
    status: turnaround.status,
    operationStatus: operation?.status ?? null,
    station: { ...station },
    airline,
    airlineIata: airline.iataCode,
    airlineName: airline.name,
    aircraft,
    aircraftType: aircraft?.icaoCode ?? null,
    stand,
    position: stand?.code ?? null,
    terminal: stand?.terminal ?? null,
    terminalCode: stand?.terminal?.code ?? null,
    arrival,
    departure,
    operation,
    timelineTime,
    timelineTimeSource,
    scheduledTime: timelineTime,
    flightNumber: flightNumbers.join(' / ') || null,
    origin: arrival?.origin?.iataCode ?? departure?.origin?.iataCode ?? null,
    destination: departure?.destination?.iataCode ?? arrival?.destination?.iataCode ?? null,
    assignedAgents,
    assignedEquipment,
    assignedServices,
    agents: assignedAgents.map(agent => agent.displayName),
    equipment: assignedEquipment.map(equipment => equipment.assetCode),
    services: assignedServices.map(service => service.name),
    resourceState,
    hasAssignmentGap: !resourceState.standAssigned || !resourceState.agentsAssigned,
  };
}

export function mapOccPlanningSnapshot(snapshot) {
  const station = { ...snapshot.station };

  return {
    station,
    date: snapshot.date,
    flights: snapshot.turnarounds.map(turnaround => mapTurnaround(turnaround, station)),
  };
}

export function isPendingAssignment(flight) {
  if (flight.resourceState) {
    return !flight.resourceState.standAssigned || !flight.resourceState.agentsAssigned;
  }

  const hasStand = Boolean(flight.stand ?? flight.position);
  const agents = flight.assignedAgents ?? flight.agents;
  return !hasStand || !Array.isArray(agents) || agents.length === 0;
}

export function isInitialAssignmentCandidate(flight) {
  const turnaroundStatus = String(flight?.status).toLowerCase();
  const plannedStart = validTimestamp(flight?.operation?.plannedStartAt);
  const plannedEnd = validTimestamp(flight?.operation?.plannedEndAt);

  return (
    (turnaroundStatus === 'scheduled' || turnaroundStatus === 'confirmed') &&
    String(flight?.operationStatus).toLowerCase() === 'planned' &&
    (flight?.assignedAgents?.length ?? 0) === 0 &&
    plannedStart !== null &&
    plannedEnd !== null &&
    plannedStart < plannedEnd
  );
}

function validTimestamp(value) {
  if (typeof value !== 'string' || value.length === 0) return null;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function hasEstimatedDelay(flight) {
  if (String(flight.status).toLowerCase() === 'delayed') return true;

  return [flight.arrival, flight.departure].some(leg => {
    const scheduledAt = validTimestamp(leg?.scheduledAt);
    const observedAt = validTimestamp(leg?.actualAt ?? leg?.estimatedAt);
    return scheduledAt !== null && observedAt !== null && observedAt > scheduledAt;
  });
}

export function computeKpis(flights) {
  const assignedPositions = new Set(
    flights.map(flight => flight.stand?.code ?? flight.position).filter(Boolean)
  );
  const flightLegs = flights.reduce(
    (count, flight) => count + Number(Boolean(flight.arrival)) + Number(Boolean(flight.departure)),
    0
  );

  return {
    turnarounds: flights.length,
    flightLegs,
    pendingAssignment: flights.filter(isPendingAssignment).length,
    positionsAssigned: assignedPositions.size,
    conflicts: null,
    conflictsAvailable: false,
  };
}

export function extractDateFromIso(iso) {
  if (typeof iso !== 'string') return '';
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function hourLabel(iso, timeZone, t) {
  if (typeof iso !== 'string' || Number.isNaN(Date.parse(iso))) return t('time.none');

  try {
    const hour = new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      hour12: false,
      ...(timeZone ? { timeZone } : {}),
    }).format(new Date(iso));
    return `${hour}:00`;
  } catch {
    return t('time.none');
  }
}

function compareTimelineTime(left, right) {
  const leftTime = left.timelineTime ?? left.scheduledTime;
  const rightTime = right.timelineTime ?? right.scheduledTime;
  if (!leftTime && !rightTime) return 0;
  if (!leftTime) return 1;
  if (!rightTime) return -1;
  return leftTime.localeCompare(rightTime);
}

export function groupFlightsByHour(flights, timeZone, language = 'es') {
  const t = createTranslator(planningMessages, language);
  const sorted = [...flights].sort(compareTimelineTime);
  const groups = [];

  for (const flight of sorted) {
    const label = hourLabel(flight.timelineTime ?? flight.scheduledTime, timeZone, t);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.hourLabel === label) {
      currentGroup.flights.push(flight);
    } else {
      groups.push({ hourLabel: label, flights: [flight] });
    }
  }

  return groups;
}

export function formatCountdown(scheduledIso, nowIso, language = 'es') {
  const t = createTranslator(planningMessages, language);
  const scheduled = validTimestamp(scheduledIso);
  const now = validTimestamp(nowIso);
  if (scheduled === null || now === null) return t('time.none');

  const diffMinutes = Math.round((scheduled - now) / 60000);
  if (diffMinutes === 0) return t('time.now');
  const absoluteMinutes = Math.abs(diffMinutes);
  const direction = diffMinutes > 0 ? 'time.in' : 'time.ago';

  if (absoluteMinutes < 60) return t(direction, { value: `${absoluteMinutes} min` });
  if (absoluteMinutes < 1440) return t(direction, { value: `${Math.round(absoluteMinutes / 60)} h` });

  const days = Math.round(absoluteMinutes / 1440);
  return t(direction, { value: `${days} ${t(days === 1 ? 'time.day' : 'time.days')}` });
}

function uniqueSorted(values) {
  return [...new Set(values.filter(value => typeof value === 'string' && value.length > 0))].sort();
}

export function getFilterOptions(flights) {
  return {
    airlines: uniqueSorted(flights.map(flight => flight.airline?.iataCode ?? flight.airlineIata)),
    statuses: uniqueSorted(flights.map(flight => flight.status)),
    aircraftTypes: uniqueSorted(flights.map(flight => flight.aircraft?.icaoCode ?? flight.aircraftType)),
    positions: uniqueSorted(flights.map(flight => flight.stand?.code ?? flight.position)),
    terminals: uniqueSorted(flights.map(flight => flight.terminal?.code ?? flight.terminalCode)),
    agents: uniqueSorted(
      flights.flatMap(flight =>
        flight.assignedAgents?.map(agent => agent.displayName) ?? flight.agents ?? []
      )
    ),
  };
}
