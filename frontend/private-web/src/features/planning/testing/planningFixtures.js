export const STATION_ID = '20000000-0000-0000-0000-000000000001';

export const STATION = {
  id: STATION_ID,
  code: 'PUJ',
  name: 'Punta Cana',
  ianaTimeZone: 'America/Santo_Domingo',
};

export const STATION_SCOPES = [{ stationId: STATION_ID, stationCode: 'PUJ' }];

export function createPlanningFlight(overrides = {}) {
  return {
    id: '91000000-0000-0000-0000-000000000002',
    turnaroundId: '91000000-0000-0000-0000-000000000002',
    operationCode: 'DEV-TAT-0002',
    operationDate: '2026-08-19',
    status: 'Confirmed',
    operationStatus: 'Planned',
    station: STATION,
    airline: { id: 'airline-1', iataCode: 'ZZ', icaoCode: 'DZZ', name: 'Demo Airlines' },
    airlineIata: 'ZZ',
    airlineName: 'Demo Airlines',
    aircraft: { id: 'aircraft-1', icaoCode: 'A320', iataCode: '320', manufacturer: 'Airbus', model: 'A320-200', registration: 'HI-DEV2' },
    aircraftType: 'A320',
    stand: { id: 'stand-1', code: 'A02', terminal: { id: 'terminal-1', code: 'A', name: 'Terminal A' } },
    position: 'A02',
    terminal: { id: 'terminal-1', code: 'A', name: 'Terminal A' },
    terminalCode: 'A',
    arrival: {
      id: 'leg-arrival',
      flightNumber: 'ZZ102',
      origin: { id: 'airport-sdq', iataCode: 'SDQ', icaoCode: 'MDSD', name: 'Las Américas' },
      destination: { id: 'airport-puj', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' },
      scheduledAt: '2026-08-19T12:00:00-04:00',
      estimatedAt: '2026-08-19T12:10:00-04:00',
      actualAt: null,
    },
    departure: {
      id: 'leg-departure',
      flightNumber: 'ZZ103',
      origin: { id: 'airport-puj', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' },
      destination: { id: 'airport-jfk', iataCode: 'JFK', icaoCode: 'KJFK', name: 'John F. Kennedy' },
      scheduledAt: '2026-08-19T15:00:00-04:00',
      estimatedAt: null,
      actualAt: null,
    },
    operation: { id: 'operation-1', status: 'Planned', plannedStartAt: '2026-08-19T12:15:00-04:00', plannedEndAt: '2026-08-19T14:30:00-04:00', actualStartAt: null, actualEndAt: null },
    timelineTime: '2026-08-19T12:15:00-04:00',
    timelineTimeSource: 'operation.plannedStartAt',
    scheduledTime: '2026-08-19T12:15:00-04:00',
    flightNumber: 'ZZ102 / ZZ103',
    origin: 'SDQ',
    destination: 'JFK',
    assignedAgents: [{ assignmentId: 'assignment-agent-1', agentId: 'agent-1', displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001', positionId: 'position-1', positionCode: 'RAMP', positionName: 'Ramp Agent', assignmentRole: 'primary', assignedAt: '2026-08-19T10:00:00-04:00' }],
    assignedEquipment: [{ assignmentId: 'assignment-equipment-1', equipmentId: 'equipment-1', assetCode: 'GPU-DEV-01', equipmentTypeId: 'equipment-type-1', equipmentTypeCode: 'GPU', equipmentTypeName: 'Ground power unit', status: 'Available', assignedAt: '2026-08-19T10:05:00-04:00' }],
    assignedServices: [{ id: 'service-1', lineNumber: 1, serviceDefinitionId: 'service-definition-1', code: 'BAGGAGE', name: 'Baggage handling', contractedQuantity: 1, executedQuantity: 0, billingUnit: 'operation', status: 'Planned' }],
    agents: ['Riley Ramp'],
    equipment: ['GPU-DEV-01'],
    services: ['Baggage handling'],
    resourceState: { standAssigned: true, agentsAssigned: true, equipmentAssigned: true, servicesPlanned: true },
    hasAssignmentGap: false,
    ...overrides,
  };
}

export function createPlanningSnapshot(flights = [createPlanningFlight()]) {
  return { station: STATION, date: '2026-08-19', flights };
}

export const PLANNING_OPTIONS = {
  turnaround: { id: '91000000-0000-0000-0000-000000000002', operationCode: 'DEV-TAT-0002', operationDate: '2026-08-19', station: STATION, stand: null, referenceTime: '2026-08-19T12:00:00-04:00' },
  contract: { id: 'contract-1', code: 'DEV-CONTRACT', version: 1, validFrom: '2026-01-01', validTo: null, currencyCode: 'USD' },
  services: [{ id: 'service-option-1', serviceDefinitionId: 'service-definition-1', code: 'BAGGAGE', name: 'Baggage handling', billingUnit: 'operation', minimumQuantity: 1, unitPrice: 25, currencyCode: 'USD' }],
  agents: [
    { id: 'agent-1', displayName: 'Riley Ramp', employeeNumber: 'DEV-RA-001', eligible: true, eligibilityReasons: [] },
    { id: 'agent-2', displayName: 'Morgan Ramp', employeeNumber: 'DEV-RA-002', eligible: false, eligibilityReasons: ['shift_not_compatible'] },
  ],
};

export const OPTIONS_STATE_SUCCESS = {
  status: 'success',
  data: PLANNING_OPTIONS,
  error: null,
  reason: null,
  recoverable: false,
};
