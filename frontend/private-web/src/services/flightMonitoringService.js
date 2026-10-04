import { readSession } from '../features/auth/authService';
import { getPlanningSnapshot } from './planningService';

function getOperationDate() {
  return new Date().toISOString().slice(0, 10);
}

const FLIGHT_TEMPLATES = [
  { id: 1, flightNumber: 'DM161', airline: 'Arajet', origin: 'MIA', destination: 'PUJ', registration: 'HI1024', aircraft: 'B737 MAX 8', status: 'approaching', etaHour: 14, etaMinute: 20, etdHour: 15, etdMinute: 5, stand: 'A5', supervisor: 'Juan Pérez', agents: 5, heading: 310, speed: 250, altitude: 8000, latitude: 18.7, longitude: -68.5, services: ['GPU', 'Baggage', 'Cleaning'] },
  { id: 2, flightNumber: 'AA904', airline: 'American', origin: 'PUJ', destination: 'MIA', registration: 'N904AA', aircraft: 'B737-800', status: 'delayed', etaHour: 8, etaMinute: 20, etdHour: 8, etdMinute: 50, stand: 'B21', supervisor: 'K. Objío', agents: 3, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 3, flightNumber: 'DL2210', airline: 'Delta', origin: 'MIA', destination: 'PUJ', registration: 'N2210DL', aircraft: 'A321neo', status: 'scheduled', etaHour: 9, etaMinute: 10, etdHour: 9, etdMinute: 45, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 25.79, longitude: -80.29, services: [] },
  { id: 4, flightNumber: 'B6289', airline: 'JetBlue', origin: 'PUJ', destination: 'JFK', registration: 'N289JB', aircraft: 'A320', status: 'leftGate', etaHour: 9, etaMinute: 40, etdHour: 9, etdMinute: 45, stand: 'A1', supervisor: 'M. Castillo', agents: 4, heading: 45, speed: 15, altitude: 0, latitude: 18.568, longitude: -68.362, services: ['Baggage'] },
  { id: 5, flightNumber: 'UA1470', airline: 'United', origin: 'PUJ', destination: 'EWR', registration: 'N1470UA', aircraft: 'A330', status: 'scheduled', etaHour: 10, etaMinute: 0, etdHour: 10, etdMinute: 5, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 6, flightNumber: 'AC1876', airline: 'Air Canada', origin: 'PUJ', destination: 'YYZ', registration: 'C-1876AC', aircraft: 'A320', status: 'taxiing', etaHour: 10, etaMinute: 20, etdHour: 10, etdMinute: 25, stand: 'A5', supervisor: 'J. Ramírez', agents: 2, heading: 270, speed: 12, altitude: 0, latitude: 18.567, longitude: -68.365, services: ['Fuel'] },
  { id: 7, flightNumber: 'CM345', airline: 'Copa', origin: 'PTY', destination: 'PUJ', registration: 'HP-345CM', aircraft: 'B737 MAX 8', status: 'arrived', etaHour: 10, etaMinute: 40, etdHour: 11, etdMinute: 15, stand: 'BN8', supervisor: 'K. Objío', agents: 5, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: ['Deplaning', 'Baggage'] },
  { id: 8, flightNumber: 'WG654', airline: 'Sunwing', origin: 'PUJ', destination: 'YYZ', registration: 'C-654WG', aircraft: 'A321neo', status: 'scheduled', etaHour: 11, etaMinute: 0, etdHour: 11, etdMinute: 5, stand: 'B32', supervisor: 'M. Castillo', agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 9, flightNumber: 'B6812', airline: 'JetBlue', origin: 'PUJ', destination: 'BOS', registration: 'N812JB', aircraft: 'A320', status: 'cancelled', etaHour: 11, etaMinute: 20, etdHour: 11, etdMinute: 25, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: [] },
  { id: 10, flightNumber: 'AA123', airline: 'American', origin: 'PUJ', destination: 'MIA', registration: 'N123AA', aircraft: 'B737-800', status: 'enRoute', etaHour: 11, etaMinute: 40, etdHour: 11, etdMinute: 45, stand: null, supervisor: 'J. Ramírez', agents: 3, heading: 315, speed: 430, altitude: 32000, latitude: 21.5, longitude: -72.8, services: [] },
  { id: 11, flightNumber: 'DL879', airline: 'Delta', origin: 'ATL', destination: 'PUJ', registration: 'N879DL', aircraft: 'B787', status: 'delayed', etaHour: 12, etaMinute: 0, etdHour: 12, etdMinute: 35, stand: 'B21', supervisor: 'R. Peña', agents: 2, heading: 150, speed: 470, altitude: 35000, latitude: 24.1, longitude: -75.3, services: [] },
  { id: 12, flightNumber: 'TS234', airline: 'Air Transat', origin: 'PUJ', destination: 'YUL', registration: 'C-234TS', aircraft: 'A330', status: 'diverted', etaHour: 12, etaMinute: 20, etdHour: 12, etdMinute: 25, stand: null, supervisor: null, agents: 0, heading: 20, speed: 460, altitude: 34000, latitude: 20.1, longitude: -69.9, services: [] },
  { id: 13, flightNumber: 'DM220', airline: 'Arajet', origin: 'PUJ', destination: 'SDQ', registration: 'HI1220', aircraft: 'A320', status: 'taxiingToGate', etaHour: 12, etaMinute: 40, etdHour: 13, etdMinute: 15, stand: 'A5', supervisor: 'K. Objío', agents: 3, heading: 180, speed: 10, altitude: 0, latitude: 18.566, longitude: -68.361, services: ['Baggage'] },
  { id: 14, flightNumber: 'B6417', airline: 'JetBlue', origin: 'JFK', destination: 'PUJ', registration: 'N417JB', aircraft: 'B787', status: 'landed', etaHour: 13, etaMinute: 0, etdHour: 13, etdMinute: 45, stand: 'BN8', supervisor: 'J. Ramírez', agents: 4, heading: 0, speed: 0, altitude: 0, latitude: 18.5674, longitude: -68.3634, services: ['Deplaning'] },
  { id: 15, flightNumber: 'UA987', airline: 'United', origin: 'SJU', destination: 'PUJ', registration: 'N987UA', aircraft: 'A321neo', status: 'unknown', etaHour: 13, etaMinute: 20, etdHour: 13, etdMinute: 55, stand: null, supervisor: null, agents: 0, heading: 0, speed: 0, altitude: 0, latitude: 18.4, longitude: -66.1, services: [] },
  { id: 16, flightNumber: 'AA455', airline: 'American', origin: 'MIA', destination: 'PUJ', registration: 'N455AA', aircraft: 'B737 MAX 8', status: 'scheduled', etaHour: 13, etaMinute: 40, etdHour: 14, etdMinute: 15, stand: 'A5', supervisor: 'M. Castillo', agents: 3, heading: 0, speed: 0, altitude: 0, latitude: 25.79, longitude: -80.29, services: [] },
  { id: 17, flightNumber: 'AA100', airline: 'American', origin: 'MIA', destination: 'JFK', registration: 'N100AA', aircraft: 'A321neo', status: 'enRoute', etaHour: 12, etaMinute: 0, etdHour: 12, etdMinute: 5, stand: null, supervisor: null, agents: 0, heading: 45, speed: 460, altitude: 33000, latitude: 27.5, longitude: -76.0, services: [] },
];

function pad(value) {
  return String(value).padStart(2, '0');
}

function buildFlight(template, dateISO) {
  return {
    id: template.id,
    flightNumber: template.flightNumber,
    airline: template.airline,
    origin: template.origin,
    destination: template.destination,
    registration: template.registration,
    aircraft: template.aircraft,
    status: template.status,
    eta: `${dateISO}T${pad(template.etaHour)}:${pad(template.etaMinute)}:00-04:00`,
    etd: `${dateISO}T${pad(template.etdHour)}:${pad(template.etdMinute)}:00-04:00`,
    actualArrival: null,
    actualDeparture: null,
    stand: template.stand,
    supervisor: template.supervisor,
    agents: template.agents,
    heading: template.heading,
    speed: template.speed,
    altitude: template.altitude,
    latitude: template.latitude,
    longitude: template.longitude,
    services: template.services,
  };
}

export async function getFlightMonitoringSnapshot(stationCode = 'PUJ') {
  if (process.env.NODE_ENV !== 'test') {
    const stationScope = readSession()?.stationScopes?.find(scope => scope.stationCode === stationCode);
    if (!stationScope?.stationId) throw new Error('Tu cuenta no tiene acceso a esta estación.');
    const snapshot = await getPlanningSnapshot({ stationId: stationScope.stationId });
    return {
      station: { code: snapshot.station.code, localAbbr: 'AST' },
      source: 'planning',
      flights: snapshot.turnarounds.flatMap(turnaround => [
        turnaround.arrival && mapOperationalFlight(turnaround, turnaround.arrival, 'arrival'),
        turnaround.departure && mapOperationalFlight(turnaround, turnaround.departure, 'departure'),
      ].filter(Boolean)),
    };
  }
  const dateISO = getOperationDate();
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    flights: FLIGHT_TEMPLATES.map(template => buildFlight(template, dateISO)),
  };
}

const ACTIVE_MOVEMENT_STATUSES = ['enRoute', 'approaching', 'taxiing', 'leftGate', 'taxiingToGate'];
const NUDGE_INTERVAL_MS = 4000;
const NUDGE_STEP_DEGREES = 0.02;

export function nudgePosition(flight, headingJitterDegrees = 0) {
  const headingRad = (flight.heading * Math.PI) / 180;
  return {
    latitude: flight.latitude + Math.cos(headingRad) * NUDGE_STEP_DEGREES,
    longitude: flight.longitude + Math.sin(headingRad) * NUDGE_STEP_DEGREES,
    heading: (flight.heading + headingJitterDegrees + 360) % 360,
  };
}

// Natural next status for a flight currently in an active-movement status — lets the simulated
// feed occasionally progress a flight's status (e.g. approaching -> landed) instead of only ever
// nudging its position, so useFlightAlerts has something real to diff against.
const STATUS_PROGRESSION = {
  enRoute: 'approaching',
  approaching: 'landed',
  taxiing: 'taxiingToGate',
  leftGate: 'taxiing',
  taxiingToGate: 'arrived',
};
const STAND_POOL = ['A1', 'A5', 'B21', 'B32', 'BN8'];
// Every Nth tick, one eligible flight gets a status/stand/eta change alongside its position
// nudge. Deterministic (tick-count based) rather than Math.random()-gated, so it stays
// independent of the `vi.spyOn(Math, 'random')` mock the existing tick tests rely on.
const MUTATION_TICK_INTERVAL = 3;
const MUTATION_FIELDS = ['status', 'stand', 'eta'];
const ETA_NUDGE_MINUTES = 5;

function applyMutation(flight, field) {
  if (field === 'status') {
    const nextStatus = STATUS_PROGRESSION[flight.status];
    if (!nextStatus) return null;
    flight.status = nextStatus;
    return { status: nextStatus };
  }
  if (field === 'stand') {
    if (flight.stand) return null;
    const stand = STAND_POOL[flight.id % STAND_POOL.length];
    flight.stand = stand;
    return { stand };
  }
  if (field === 'eta') {
    const nextEta = new Date(new Date(flight.eta).getTime() + ETA_NUDGE_MINUTES * 60000).toISOString();
    flight.eta = nextEta;
    return { eta: nextEta };
  }
  return null;
}

export function subscribeToFlightUpdates(onUpdate, stationCode = 'PUJ',
  { onSnapshot, onError } = {}) {
  if (process.env.NODE_ENV !== 'test') {
    const intervalId = setInterval(() => {
      getFlightMonitoringSnapshot(stationCode)
        .then(snapshot => {
          if (onSnapshot) onSnapshot(snapshot);
          else snapshot.flights.forEach(onUpdate);
        })
        .catch(error => onError?.(error));
    }, 30000);
    return () => clearInterval(intervalId);
  }
  const dateISO = getOperationDate();
  const simulatedFlights = FLIGHT_TEMPLATES.map(template => buildFlight(template, dateISO));
  let tickCount = 0;

  const intervalId = setInterval(() => {
    tickCount += 1;
    const eligible = simulatedFlights.filter(flight => ACTIVE_MOVEMENT_STATUSES.includes(flight.status));
    const shouldMutate = eligible.length > 0 && tickCount % MUTATION_TICK_INTERVAL === 0;
    const mutationTarget = shouldMutate ? eligible[tickCount % eligible.length] : null;
    const mutationField = MUTATION_FIELDS[(tickCount / MUTATION_TICK_INTERVAL) % MUTATION_FIELDS.length];

    eligible.forEach(flight => {
      const jitter = Math.random() * 6 - 3;
      const nudged = nudgePosition(flight, jitter);
      flight.latitude = nudged.latitude;
      flight.longitude = nudged.longitude;
      flight.heading = nudged.heading;

      const update = {
        id: flight.id,
        latitude: flight.latitude,
        longitude: flight.longitude,
        heading: flight.heading,
        speed: flight.speed,
        altitude: flight.altitude,
      };

      if (flight === mutationTarget) {
        const change = applyMutation(flight, mutationField);
        if (change) Object.assign(update, change);
      }

      onUpdate(update);
    });
  }, NUDGE_INTERVAL_MS);

  return () => clearInterval(intervalId);
}

function mapOperationalFlight(turnaround, leg, direction) {
  const scheduled = leg.scheduledAt;
  const expected = leg.estimatedAt ?? scheduled;
  const delayed = new Date(expected).getTime() - new Date(scheduled).getTime() > 5 * 60 * 1000;
  return {
    id: leg.id,
    turnaroundId: turnaround.id,
    direction,
    flightNumber: leg.flightNumber,
    airline: turnaround.airline.name,
    origin: leg.origin.iataCode,
    destination: leg.destination.iataCode,
    registration: turnaround.aircraft?.registration ?? 'Sin registrar',
    aircraft: turnaround.aircraft?.model ?? 'Sin registrar',
    // A recorded leg time is not proof of landing, pushback or stand occupancy.
    status: leg.actualAt ? 'actualRecorded' : delayed ? 'delayed' : 'scheduled',
    eta: direction === 'arrival' ? expected : null,
    etd: direction === 'departure' ? expected : null,
    actualArrival: direction === 'arrival' ? leg.actualAt : null,
    actualDeparture: direction === 'departure' ? leg.actualAt : null,
    stand: turnaround.stand?.code ?? null,
    supervisor: null,
    agents: turnaround.agents.length,
    heading: null,
    speed: null,
    altitude: null,
    latitude: null,
    longitude: null,
    services: turnaround.services.map(service => service.name),
  };
}

export async function updateFlightStatus(flightId, status) {
  void flightId;
  void status;
  throw new Error('La edición del estado del vuelo requiere un contrato aeronáutico revisado.');
}
