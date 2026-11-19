// N10 and N9 (D-N10, D-N9): the tablet writes a turnaround's route as the stops the aircraft makes, in order, with the
// station where the agent works between them («BWI → PUJ → BWI»), and the assignment's role in Spanish.
const {
  assignmentRoleLabel,
  operationRouteDescription,
  operationRouteStops,
} = require('../src/features/assigned-operations/presentation');

const airports = {
  BWI: { id: '72000000-0000-4000-8000-000000000001', iataCode: 'BWI', icaoCode: 'KBWI',
    name: 'Baltimore/Washington International' },
  PUJ: { id: '72000000-0000-4000-8000-000000000002', iataCode: 'PUJ', icaoCode: 'MDPC', name: 'Punta Cana' },
  MIA: { id: '72000000-0000-4000-8000-000000000003', iataCode: 'MIA', icaoCode: 'KMIA', name: 'Miami International' },
};

function leg(flightNumber, origin, destination) {
  return { id: '71000000-0000-4000-8000-000000000001', flightNumber, origin: airports[origin],
    destination: airports[destination], scheduledAt: '2026-11-16T23:30:00.000Z', estimatedAt: null, actualAt: null };
}

function operation({ arrival = null, departure = null } = {}) {
  return {
    operation: { id: '70000000-0000-4000-8000-000000000001', status: 'Assigned', plannedStartAt: null,
      plannedEndAt: null, actualStartAt: null, actualEndAt: null },
    assignment: { id: '70000000-0000-4000-8000-000000000002', agentId: '70000000-0000-4000-8000-000000000003',
      assignmentRole: 'primary', position: null, assignedAt: '2026-11-16T12:00:00.000Z' },
    services: [],
    review: null,
    milestones: [],
    turnaround: {
      id: '70000000-0000-4000-8000-000000000004', operationCode: 'EV-001', operationDate: '2026-11-16',
      status: 'Planned',
      station: { id: '20000000-0000-4000-8000-000000000003', code: 'PUJ', name: 'Punta Cana',
        ianaTimeZone: 'America/Santo_Domingo' },
      airline: { id: '20000000-0000-4000-8000-000000000004', iataCode: 'WN', icaoCode: 'SWA', name: 'Southwest' },
      aircraft: null, stand: null, arrival, departure,
    },
  };
}

const turnaround = operation({ arrival: leg('WN9001', 'BWI', 'PUJ'), departure: leg('WN9002', 'PUJ', 'BWI') });
const onward = operation({ arrival: leg('WN9001', 'BWI', 'PUJ'), departure: leg('WN9002', 'PUJ', 'MIA') });
const arrivalOnly = operation({ arrival: leg('WN9001', 'BWI', 'PUJ') });
const departureOnly = operation({ departure: leg('WN9002', 'PUJ', 'MIA') });
const withoutFlights = operation();

describe('the route as the aircraft flies it (N10, D-N10)', () => {
  test('a turnaround reads where the aircraft comes from, the station and where it goes next', () => {
    // «BWI ✈ BWI» hid the station where the agent works.
    expect(operationRouteStops(turnaround)).toEqual([
      { code: 'BWI', kind: 'origin' },
      { code: 'PUJ', kind: 'station' },
      { code: 'BWI', kind: 'destination' },
    ]);
  });

  test('the next destination is the departure’s, not the arrival’s origin', () => {
    expect(operationRouteStops(onward).map(stop => stop.code)).toEqual(['BWI', 'PUJ', 'MIA']);
  });

  test('a missing leg is left out instead of putting the station in its place', () => {
    expect(operationRouteStops(arrivalOnly)).toEqual([
      { code: 'BWI', kind: 'origin' },
      { code: 'PUJ', kind: 'station' },
    ]);
    expect(operationRouteStops(departureOnly)).toEqual([
      { code: 'PUJ', kind: 'station' },
      { code: 'MIA', kind: 'destination' },
    ]);
    expect(operationRouteStops(withoutFlights)).toEqual([{ code: 'PUJ', kind: 'station' }]);
  });

  test('the spoken route says where the aircraft arrives from and where it leaves for', () => {
    expect(operationRouteDescription(turnaround)).toBe('llega de BWI a PUJ y sale hacia BWI');
    expect(operationRouteDescription(onward)).toBe('llega de BWI a PUJ y sale hacia MIA');
    expect(operationRouteDescription(arrivalOnly)).toBe('llega de BWI a PUJ');
    expect(operationRouteDescription(departureOnly)).toBe('sale de PUJ hacia MIA');
    expect(operationRouteDescription(withoutFlights)).toBe('estación PUJ, ruta por confirmar');
  });
});

describe('the assignment role in Spanish (N9, D-N9)', () => {
  test('the primary agent reads «Agente principal» whatever the casing', () => {
    expect(['primary', 'Primary', 'PRIMARY'].map(assignmentRoleLabel))
      .toEqual(['Agente principal', 'Agente principal', 'Agente principal']);
  });

  test('a role this version does not know is not shown, never as its code', () => {
    expect(assignmentRoleLabel('RampAgent')).toBeNull();
    expect(assignmentRoleLabel('')).toBeNull();
    expect(assignmentRoleLabel('constructor')).toBeNull();
    expect(assignmentRoleLabel('toString')).toBeNull();
    expect(assignmentRoleLabel('__proto__')).toBeNull();
  });
});
