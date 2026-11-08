import { describe, expect, it } from 'vitest';
import {
  computeKpis,
  extractDateFromIso,
  formatCountdown,
  getFilterOptions,
  groupFlightsByHour,
  hasEstimatedDelay,
  isInitialAssignmentCandidate,
  isPendingAssignment,
  isTurnaroundChangeCandidate,
  mapOccPlanningSnapshot,
} from './planningMappers';

const STATION = {
  id: 'station-id',
  code: 'PUJ',
  name: 'Punta Cana',
  ianaTimeZone: 'America/Santo_Domingo',
};

function airport(iataCode, name = iataCode) {
  return { id: `${iataCode}-id`, iataCode, icaoCode: `M${iataCode}`, name };
}

function turnaround(overrides = {}) {
  return {
    id: 'turnaround-1',
    operationCode: 'DEV-TAT-0002',
    operationDate: '2026-08-19',
    status: 'Confirmed',
    airline: { id: 'airline-id', iataCode: 'ZZ', icaoCode: 'DZZ', name: 'Demo Airlines' },
    aircraft: {
      id: 'aircraft-id',
      icaoCode: 'A320',
      iataCode: '320',
      manufacturer: 'Airbus',
      model: 'A320-200',
      registration: 'HI-DEV',
    },
    stand: {
      id: 'stand-id',
      code: 'A02',
      terminal: { id: 'terminal-id', code: 'A', name: 'Terminal A' },
    },
    arrival: {
      id: 'arrival-id',
      flightNumber: 'ZZ102',
      origin: airport('SDQ', 'Las Américas'),
      destination: airport('PUJ', 'Punta Cana'),
      scheduledAt: '2026-08-19T12:15:00-04:00',
      estimatedAt: '2026-08-19T12:20:00-04:00',
      actualAt: null,
    },
    departure: {
      id: 'departure-id',
      flightNumber: 'ZZ103',
      origin: airport('PUJ', 'Punta Cana'),
      destination: airport('JFK', 'John F. Kennedy'),
      scheduledAt: '2026-08-19T14:00:00-04:00',
      estimatedAt: null,
      actualAt: null,
    },
    operation: {
      id: 'operation-id',
      status: 'Planned',
      plannedStartAt: '2026-08-19T12:30:00-04:00',
      plannedEndAt: '2026-08-19T13:45:00-04:00',
      actualStartAt: null,
      actualEndAt: null,
    },
    agents: [
      {
        assignmentId: 'agent-assignment-id',
        agentId: 'agent-id',
        displayName: 'Riley Ramp',
        employeeNumber: 'DEV-RA-001',
        positionId: 'position-id',
        positionCode: 'RAMP',
        positionName: 'Ramp Agent',
        assignmentRole: 'Primary',
        assignedAt: '2026-08-19T11:45:00-04:00',
      },
    ],
    equipment: [
      {
        assignmentId: 'equipment-assignment-id',
        equipmentId: 'equipment-id',
        assetCode: 'GPU-DEV-01',
        equipmentTypeId: 'equipment-type-id',
        equipmentTypeCode: 'GPU',
        equipmentTypeName: 'Ground power unit',
        status: 'Available',
        assignedAt: '2026-08-19T11:46:00-04:00',
      },
    ],
    services: [
      {
        id: 'service-id',
        lineNumber: 1,
        serviceDefinitionId: 'service-definition-id',
        code: 'BAGGAGE',
        name: 'Baggage handling',
        contractedQuantity: 1,
        executedQuantity: 0,
        billingUnit: 'operation',
        status: 'Planned',
      },
    ],
    ...overrides,
  };
}

function snapshot(turnarounds = [turnaround()]) {
  return { station: STATION, date: '2026-08-19', turnarounds };
}

describe('mapOccPlanningSnapshot', () => {
  it('maps one canonical turnaround without losing either flight leg or resource details', () => {
    const source = snapshot();
    const mapped = mapOccPlanningSnapshot(source);
    const item = mapped.flights[0];

    expect(mapped.station).toEqual(STATION);
    expect(mapped.date).toBe('2026-08-19');
    expect(item).toEqual(expect.objectContaining({
      id: 'turnaround-1',
      turnaroundId: 'turnaround-1',
      operationCode: 'DEV-TAT-0002',
      operationDate: '2026-08-19',
      status: 'Confirmed',
      operationStatus: 'Planned',
      airlineIata: 'ZZ',
      airlineName: 'Demo Airlines',
      aircraftType: 'A320',
      position: 'A02',
      terminalCode: 'A',
      timelineTime: '2026-08-19T12:30:00-04:00',
      timelineTimeSource: 'operation.plannedStartAt',
      scheduledTime: '2026-08-19T12:30:00-04:00',
      flightNumber: 'ZZ102 / ZZ103',
      origin: 'SDQ',
      destination: 'JFK',
      agents: ['Riley Ramp'],
      equipment: ['GPU-DEV-01'],
      services: ['Baggage handling'],
      resourceState: {
        standAssigned: true,
        agentsAssigned: true,
        equipmentAssigned: true,
        servicesPlanned: true,
      },
      hasAssignmentGap: false,
    }));
    expect(item.arrival).toEqual(source.turnarounds[0].arrival);
    expect(item.departure).toEqual(source.turnarounds[0].departure);
    expect(item.assignedAgents).toEqual(source.turnarounds[0].agents);
    expect(item.assignedEquipment).toEqual(source.turnarounds[0].equipment);
    expect(item.assignedServices).toEqual(source.turnarounds[0].services);
  });

  it('does not manufacture conflict, history, observations, supervisor, or team facts', () => {
    const item = mapOccPlanningSnapshot(snapshot()).flights[0];

    expect(item).not.toHaveProperty('conflict');
    expect(item).not.toHaveProperty('history');
    expect(item).not.toHaveProperty('observations');
    expect(item).not.toHaveProperty('supervisor');
    expect(item).not.toHaveProperty('teams');
  });

  it('keeps nullable branches null and reports resource presence rather than fabricating defaults', () => {
    const sourceTurnaround = turnaround({
      id: 'empty-turnaround',
      operationCode: 'EMPTY-001',
      aircraft: null,
      stand: null,
      arrival: null,
      departure: null,
      operation: null,
      agents: [],
      equipment: [],
      services: [],
    });
    const item = mapOccPlanningSnapshot(snapshot([sourceTurnaround])).flights[0];

    expect(item).toEqual(expect.objectContaining({
      aircraft: null,
      stand: null,
      terminal: null,
      arrival: null,
      departure: null,
      operation: null,
      operationStatus: null,
      timelineTime: null,
      timelineTimeSource: null,
      scheduledTime: null,
      flightNumber: null,
      origin: null,
      destination: null,
      assignedAgents: [],
      assignedEquipment: [],
      assignedServices: [],
      resourceState: {
        standAssigned: false,
        agentsAssigned: false,
        equipmentAssigned: false,
        servicesPlanned: false,
      },
      hasAssignmentGap: true,
    }));
  });

  it('uses arrival then departure scheduled time only when no planned operation start exists', () => {
    const arrivalFallback = turnaround({ operation: null });
    const departureFallback = turnaround({ operation: null, arrival: null });
    const [arrivalItem, departureItem] = mapOccPlanningSnapshot(snapshot([
      arrivalFallback,
      { ...departureFallback, id: 'turnaround-2' },
    ])).flights;

    expect(arrivalItem.timelineTimeSource).toBe('arrival.scheduledAt');
    expect(arrivalItem.timelineTime).toBe(arrivalFallback.arrival.scheduledAt);
    expect(departureItem.timelineTimeSource).toBe('departure.scheduledAt');
    expect(departureItem.timelineTime).toBe(departureFallback.departure.scheduledAt);
  });
});

describe('resource and operational derivations', () => {
  it('detects assignment gaps from explicit mapped resource state', () => {
    expect(isPendingAssignment({ resourceState: { standAssigned: true, agentsAssigned: true } })).toBe(false);
    expect(isPendingAssignment({ resourceState: { standAssigned: false, agentsAssigned: true } })).toBe(true);
    expect(isPendingAssignment({ resourceState: { standAssigned: true, agentsAssigned: false } })).toBe(true);
  });

  it('never counts a cancelled, diverted or completed flight as pending assignment (3-A)', () => {
    const released = { resourceState: { standAssigned: false, agentsAssigned: false } };
    for (const status of ['Cancelled', 'Diverted', 'Completed'])
      expect(isPendingAssignment({ ...released, status })).toBe(false);
    expect(isPendingAssignment({ ...released, status: 'Confirmed' })).toBe(true);
    expect(isPendingAssignment({ ...released, status: 'InProgress' })).toBe(true);
  });

  it('offers initial assignment only for an assignable turnaround and planned window', () => {
    const candidate = {
      status: 'Confirmed',
      operationStatus: 'Planned',
      operation: {
        plannedStartAt: '2026-08-19T12:15:00-04:00',
        plannedEndAt: '2026-08-19T14:30:00-04:00',
      },
      assignedAgents: [],
    };

    expect(isInitialAssignmentCandidate(candidate)).toBe(true);
    // 3-C: the recorded arrival (InProgress) keeps the planned operation assignable.
    expect(isInitialAssignmentCandidate({ ...candidate, status: 'InProgress' })).toBe(true);
    expect(isInitialAssignmentCandidate({ ...candidate, status: 'Cancelled' })).toBe(false);
    expect(isInitialAssignmentCandidate({ ...candidate, status: 'Diverted' })).toBe(false);
    expect(isInitialAssignmentCandidate({ ...candidate, operationStatus: 'Assigned' })).toBe(false);
    expect(isInitialAssignmentCandidate({ ...candidate, assignedAgents: [{}] })).toBe(false);
    expect(
      isInitialAssignmentCandidate({
        ...candidate,
        operation: { ...candidate.operation, plannedEndAt: null },
      })
    ).toBe(false);
    expect(
      isInitialAssignmentCandidate({
        ...candidate,
        operation: {
          plannedStartAt: candidate.operation.plannedEndAt,
          plannedEndAt: candidate.operation.plannedStartAt,
        },
      })
    ).toBe(false);
    expect(isInitialAssignmentCandidate(null)).toBe(false);
  });

  it('offers the flight changes only before the operation starts on an open flight (3-A)', () => {
    const flight = { status: 'Confirmed', operationStatus: 'Planned' };

    expect(isTurnaroundChangeCandidate(flight)).toBe(true);
    expect(isTurnaroundChangeCandidate({ ...flight, operationStatus: 'Assigned' })).toBe(true);
    expect(isTurnaroundChangeCandidate({ ...flight, status: 'InProgress' })).toBe(true);
    expect(isTurnaroundChangeCandidate({ ...flight, operationStatus: 'InProgress' })).toBe(false);
    expect(isTurnaroundChangeCandidate({ ...flight, operationStatus: 'Completed' })).toBe(false);
    expect(isTurnaroundChangeCandidate({ ...flight, status: 'Cancelled' })).toBe(false);
    expect(isTurnaroundChangeCandidate({ ...flight, status: 'Diverted' })).toBe(false);
    expect(isTurnaroundChangeCandidate({ ...flight, status: 'Completed' })).toBe(false);
    expect(isTurnaroundChangeCandidate(null)).toBe(false);
  });

  it('detects a delay only from an explicit delayed status or a later estimate', () => {
    const [delayed, onTime] = mapOccPlanningSnapshot(snapshot([
      turnaround(),
      turnaround({
        id: 'turnaround-2',
        arrival: { ...turnaround().arrival, estimatedAt: '2026-08-19T12:10:00-04:00' },
      }),
    ])).flights;

    expect(hasEstimatedDelay(delayed)).toBe(true);
    expect(hasEstimatedDelay(onTime)).toBe(false);
    expect(hasEstimatedDelay({ status: 'delayed', arrival: null, departure: null })).toBe(true);
  });

  it('uses the actual leg time before a stale estimate when deriving delay', () => {
    expect(hasEstimatedDelay({
      status: 'Completed',
      arrival: {
        scheduledAt: '2026-08-19T12:15:00Z',
        estimatedAt: '2026-08-19T12:45:00Z',
        actualAt: '2026-08-19T12:10:00Z',
      },
      departure: null,
    })).toBe(false);

    expect(hasEstimatedDelay({
      status: 'Completed',
      arrival: {
        scheduledAt: '2026-08-19T12:15:00Z',
        estimatedAt: null,
        actualAt: '2026-08-19T12:20:00Z',
      },
      departure: null,
    })).toBe(true);
  });

  it('computes only metrics supported by the snapshot and marks conflicts unavailable', () => {
    const flights = mapOccPlanningSnapshot(snapshot([
      turnaround(),
      turnaround({
        id: 'turnaround-2',
        stand: null,
        arrival: null,
        agents: [],
        equipment: [],
        services: [],
      }),
    ])).flights;

    expect(computeKpis(flights)).toEqual({
      turnarounds: 2,
      flightLegs: 3,
      pendingAssignment: 1,
      positionsAssigned: 1,
      conflicts: null,
      conflictsAvailable: false,
    });
  });
});

describe('timeline helpers', () => {
  it('extracts the YYYY-MM-DD prefix without converting time zones', () => {
    expect(extractDateFromIso('2026-08-19T23:59:00-04:00')).toBe('2026-08-19');
    expect(extractDateFromIso(null)).toBe('');
  });

  it('sorts and groups by timeline time, keeping no-time items in an honest fallback group', () => {
    const flights = [
      { id: 'none', timelineTime: null },
      { id: 'nine', timelineTime: '2026-08-19T09:10:00-04:00' },
      { id: 'eight-b', timelineTime: '2026-08-19T08:45:00-04:00' },
      { id: 'eight-a', timelineTime: '2026-08-19T08:05:00-04:00' },
    ];
    const groups = groupFlightsByHour(flights, STATION.ianaTimeZone);

    expect(groups.map(group => group.hourLabel)).toEqual(['08:00', '09:00', 'Sin hora']);
    expect(groups[0].flights.map(flight => flight.id)).toEqual(['eight-a', 'eight-b']);
    expect(groups[2].flights.map(flight => flight.id)).toEqual(['none']);
  });

  it('groups UTC timestamps by the station local hour', () => {
    const groups = groupFlightsByHour([
      { id: 'utc', timelineTime: '2026-08-19T12:15:00Z' },
    ], STATION.ianaTimeZone);

    expect(groups[0].hourLabel).toBe('08:00');
  });

  it('formats valid countdowns and states when a reference time is unavailable', () => {
    expect(formatCountdown('2026-08-19T08:05:00-04:00', '2026-08-19T07:20:00-04:00')).toBe('En 45 min');
    expect(formatCountdown('2026-08-19T08:05:00-04:00', '2026-08-19T08:50:00-04:00')).toBe('Hace 45 min');
    expect(formatCountdown(null, '2026-08-19T08:50:00-04:00')).toBe('Sin hora');
    expect(formatCountdown('2026-08-19T12:00:00Z', '2026-08-19T10:00:00Z')).toBe('En 2 h');
    expect(formatCountdown('2026-08-19T12:00:00Z', '2026-09-16T12:00:00Z')).toBe('Hace 28 días');
  });

  it('formats the countdown and missing hour in English when requested', () => {
    expect(formatCountdown('2026-08-19T08:05:00-04:00', '2026-08-19T07:20:00-04:00', 'en')).toBe('In 45 min');
    expect(formatCountdown('2026-08-19T12:00:00Z', '2026-08-20T12:00:00Z', 'en')).toBe('1 day ago');
    expect(formatCountdown(null, '2026-08-19T08:50:00-04:00', 'en')).toBe('No time');
    expect(groupFlightsByHour([{ id: 'none', timelineTime: null }], STATION.ianaTimeZone, 'en')[0].hourLabel).toBe('No time');
  });
});

describe('getFilterOptions', () => {
  it('derives only client-side operational dimensions from canonical data', () => {
    const flights = mapOccPlanningSnapshot(snapshot([
      turnaround(),
      turnaround({
        id: 'turnaround-2',
        status: 'Scheduled',
        airline: { id: 'other-airline', iataCode: 'AA', icaoCode: 'AAL', name: 'American' },
        aircraft: null,
        stand: null,
        agents: [],
      }),
    ])).flights;
    const options = getFilterOptions(flights);

    expect(options).toEqual({
      airlines: ['AA', 'ZZ'],
      statuses: ['Confirmed', 'Scheduled'],
      aircraftTypes: ['A320'],
      positions: ['A02'],
      terminals: ['A'],
      agents: ['Riley Ramp'],
    });
    expect(options).not.toHaveProperty('dates');
    expect(options).not.toHaveProperty('airports');
    expect(options).not.toHaveProperty('supervisors');
  });
});