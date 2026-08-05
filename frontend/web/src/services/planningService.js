const OPERATION_DATE = '2026-08-05';

const FLIGHT_TEMPLATES = [
  { id: 'flt-1', flightNumber: 'DM161', airlineIata: 'DM', airlineName: 'ARAJET', status: 'scheduled', hour: 8, minute: 5, origin: 'PUJ', destination: 'JFK', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo', 'R. Peña'], teams: ['Rampa 2'], services: ['Combustible', 'Catering'], conflictReason: null, observations: '', history: [{ at: `${OPERATION_DATE}T07:00:00-04:00`, note: 'Planificación creada' }] },
  { id: 'flt-2', flightNumber: 'AA904', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'delayed', hour: 8, minute: 20, delayMinutes: 30, origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', position: 'B21', supervisor: 'K. Objío', agents: [], teams: [], services: [], conflictReason: 'Posición B21 con doble asignación (ver DL2210)', observations: 'Pendiente de asignación de agentes.', history: [] },
  { id: 'flt-3', flightNumber: 'DL2210', airlineIata: 'DL', airlineName: 'DELTA', status: 'scheduled', hour: 8, minute: 20, origin: 'MIA', destination: 'PUJ', aircraftType: 'A321neo', position: 'B21', supervisor: 'R. Peña', agents: ['J. Fermín'], teams: ['Rampa 1'], services: ['Equipaje'], conflictReason: 'Posición B21 con doble asignación (ver AA904)', observations: '', history: [] },
  { id: 'flt-4', flightNumber: 'B6289', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'boarding', hour: 9, minute: 10, origin: 'PUJ', destination: 'JFK', aircraftType: 'B787', position: 'A1', supervisor: 'M. Castillo', agents: ['K. Objío', 'R. Peña'], teams: ['Rampa 3'], services: ['Equipaje', 'Limpieza'], conflictReason: null, observations: '', history: [{ at: `${OPERATION_DATE}T08:40:00-04:00`, note: 'Abordaje iniciado' }] },
  { id: 'flt-5', flightNumber: 'UA1470', airlineIata: 'UA', airlineName: 'UNITED', status: 'scheduled', hour: 9, minute: 40, origin: 'PUJ', destination: 'EWR', aircraftType: 'A330', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Pendiente de asignación de posición y agentes.', history: [] },
  { id: 'flt-6', flightNumber: 'AC1876', airlineIata: 'AC', airlineName: 'AIRCANADA', status: 'taxiing', hour: 10, minute: 0, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A320', position: 'A5', supervisor: 'J. Ramírez', agents: ['M. Castillo'], teams: ['Rampa 2'], services: ['Combustible'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-7', flightNumber: 'CM345', airlineIata: 'CM', airlineName: 'COPA', status: 'arrived', hour: 10, minute: 15, origin: 'PTY', destination: 'PUJ', aircraftType: 'B737 MAX', position: 'BN8', supervisor: 'K. Objío', agents: ['R. Peña', 'J. Fermín'], teams: ['Rampa 2'], services: ['Desembarque'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-8', flightNumber: 'WG654', airlineIata: 'WG', airlineName: 'SUNWING', status: 'scheduled', hour: 10, minute: 45, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A321neo', position: 'B32', supervisor: 'M. Castillo', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-9', flightNumber: 'B6812', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'cancelled', hour: 11, minute: 0, origin: 'PUJ', destination: 'BOS', aircraftType: 'A320', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Cancelado por mantenimiento de aeronave.', history: [{ at: `${OPERATION_DATE}T09:30:00-04:00`, note: 'Vuelo cancelado por la aerolínea' }] },
  { id: 'flt-10', flightNumber: 'AA123', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'scheduled', hour: 11, minute: 20, origin: 'PUJ', destination: 'MIA', aircraftType: 'B737-800', position: 'A5', supervisor: 'J. Ramírez', agents: ['K. Objío'], teams: ['Rampa 1'], services: ['Combustible'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-11', flightNumber: 'DL879', airlineIata: 'DL', airlineName: 'DELTA', status: 'delayed', hour: 11, minute: 35, delayMinutes: 50, origin: 'ATL', destination: 'PUJ', aircraftType: 'B787', position: 'B21', supervisor: 'R. Peña', agents: [], teams: [], services: [], conflictReason: null, observations: 'Retraso por congestión en origen.', history: [] },
  { id: 'flt-12', flightNumber: 'TS234', airlineIata: 'TS', airlineName: 'AIRTRANSAT', status: 'scheduled', hour: 12, minute: 0, origin: 'PUJ', destination: 'YUL', aircraftType: 'A330', position: 'A1', supervisor: 'M. Castillo', agents: ['R. Peña'], teams: ['Rampa 3'], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-13', flightNumber: 'DM220', airlineIata: 'DM', airlineName: 'ARAJET', status: 'boarding', hour: 12, minute: 15, origin: 'PUJ', destination: 'SDQ', aircraftType: 'A320', position: 'A5', supervisor: 'K. Objío', agents: ['R. Peña'], teams: ['Rampa 2'], services: ['Catering'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-14', flightNumber: 'B6417', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'scheduled', hour: 12, minute: 40, origin: 'PUJ', destination: 'JFK', aircraftType: 'B787', position: 'BN8', supervisor: 'J. Ramírez', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-15', flightNumber: 'UA987', airlineIata: 'UA', airlineName: 'UNITED', status: 'enRoute', hour: 13, minute: 0, origin: 'PUJ', destination: 'IAH', aircraftType: 'A321neo', position: null, supervisor: null, agents: [], teams: [], services: [], conflictReason: null, observations: 'Pendiente de asignación de posición.', history: [] },
  { id: 'flt-16', flightNumber: 'AA455', airlineIata: 'AA', airlineName: 'AMERICAN', status: 'taxiing', hour: 13, minute: 20, origin: 'MIA', destination: 'PUJ', aircraftType: 'B737 MAX', position: 'A5', supervisor: 'M. Castillo', agents: ['K. Objío', 'J. Fermín'], teams: ['Rampa 1'], services: ['Desembarque'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-17', flightNumber: 'CM110', airlineIata: 'CM', airlineName: 'COPA', status: 'scheduled', hour: 13, minute: 45, origin: 'PUJ', destination: 'PTY', aircraftType: 'A320', position: 'B32', supervisor: 'R. Peña', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-18', flightNumber: 'DL500', airlineIata: 'DL', airlineName: 'DELTA', status: 'landed', hour: 14, minute: 0, origin: 'JFK', destination: 'PUJ', aircraftType: 'B787', position: 'B21', supervisor: 'J. Ramírez', agents: ['M. Castillo'], teams: ['Rampa 2'], services: ['Desembarque', 'Equipaje'], conflictReason: null, observations: '', history: [] },
  { id: 'flt-19', flightNumber: 'WG100', airlineIata: 'WG', airlineName: 'SUNWING', status: 'delayed', hour: 14, minute: 20, delayMinutes: 25, origin: 'PUJ', destination: 'YYZ', aircraftType: 'A330', position: 'A1', supervisor: 'K. Objío', agents: [], teams: [], services: [], conflictReason: null, observations: '', history: [] },
  { id: 'flt-20', flightNumber: 'B6900', airlineIata: 'B6', airlineName: 'JETBLUE', status: 'scheduled', hour: 14, minute: 45, origin: 'PUJ', destination: 'JFK', aircraftType: 'A321neo', position: 'BN8', supervisor: 'M. Castillo', agents: ['R. Peña', 'J. Fermín'], teams: ['Rampa 3'], services: ['Limpieza'], conflictReason: null, observations: '', history: [] },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function addMinutesIso(iso, minutes) {
  const date = new Date(iso);
  date.setMinutes(date.getMinutes() + minutes);
  return date.toISOString();
}

function buildFlight(template, stationCode, dateISO) {
  const scheduledTime = `${dateISO}T${pad(template.hour)}:${pad(template.minute)}:00-04:00`;
  const estimatedTime = template.delayMinutes ? addMinutesIso(scheduledTime, template.delayMinutes) : scheduledTime;

  return {
    id: template.id,
    flightNumber: template.flightNumber,
    airlineIata: template.airlineIata,
    airlineName: template.airlineName,
    status: template.status,
    scheduledTime,
    estimatedTime,
    origin: template.origin,
    destination: template.destination,
    aircraftType: template.aircraftType,
    position: template.position,
    station: stationCode,
    supervisor: template.supervisor,
    agents: template.agents,
    teams: template.teams,
    services: template.services,
    conflict: template.conflictReason ? { reason: template.conflictReason } : null,
    observations: template.observations,
    history: template.history ?? [],
  };
}

export async function getPlanningSnapshot(stationCode = 'PUJ', dateISO = OPERATION_DATE) {
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    date: dateISO,
    flights: FLIGHT_TEMPLATES.map(template => buildFlight(template, stationCode, dateISO)),
  };
}
