// Adaptador mock del módulo Mapa de posiciones. Sustituir por llamadas HTTP reales cuando exista backend.
//
// Endpoints conceptuales que este adaptador representa (ver Claude-skills/plan-mapa/skill.md):
//   GET /positions
//   GET /positions/{id}
//   GET /positions/{id}/status
//
// Las coordenadas provienen de RAMP_POSITIONS (src/features/dashboard/positionsData.js), la
// única fuente de verdad geográfica compartida con el preview del Dashboard. Este adaptador solo
// añade el estado operativo (mock) sobre esas coordenadas — no las modifica ni las reinventa.
import { RAMP_POSITIONS } from '../features/dashboard/positionsData';
import { readSession } from '../features/auth/authService';
import { getPlanningSnapshot } from './planningService';

// --- Estado operativo inicial (mock) ---
// Las únicas relaciones combinadas Alfa/Bravo son las declaradas aquí explícitamente:
// 9-Alfa (A9 bloquea A10) y 32-Bravo (B32 bloquea B33). No se inventan otras.
const INITIAL_OVERRIDES = {
  // flightId apunta al id numérico de flightMonitoringService.FLIGHT_TEMPLATES (no al
  // flightNumber) para que "Ver vuelo en Monitoreo" enfoque el vuelo correcto en ese módulo.
  A1: {
    status: 'occupied',
    flightId: 4,
    flightNumber: 'B6289',
    airline: 'JetBlue',
    aircraftRegistration: 'N289JB',
    aircraftType: 'A320',
    assignedAgent: 'M. Castillo',
  },
  A2: {
    status: 'releasing',
    flightId: 14,
    flightNumber: 'B6417',
    airline: 'JetBlue',
    aircraftRegistration: 'N417JB',
    aircraftType: 'B787',
    assignedAgent: 'J. Ramírez',
    releaseInMinutes: 25,
  },
  A5: {
    status: 'occupied',
    flightId: 6,
    flightNumber: 'AC1876',
    airline: 'Air Canada',
    aircraftRegistration: 'C-1876AC',
    aircraftType: 'A320',
    assignedAgent: 'J. Ramírez',
  },
  A9: {
    status: 'occupied',
    flightId: 13,
    flightNumber: 'DM220',
    airline: 'Arajet',
    aircraftRegistration: 'HI1055',
    aircraftType: 'A320',
    assignedAgent: 'Juan Pérez',
    combinedConfiguration: '9-Alfa',
    linkedPositionId: 'A10',
  },
  A10: {
    status: 'disabled',
    combinedConfiguration: '9-Alfa',
    linkedPositionId: 'A9',
  },
  B21: {
    status: 'occupied',
    flightId: 2,
    flightNumber: 'AA904',
    airline: 'American Airlines',
    aircraftRegistration: 'N904AA',
    aircraftType: 'B737-800',
    assignedAgent: 'K. Objío',
  },
  B24: {
    status: 'releasing',
    flightId: 1,
    flightNumber: 'DM161',
    airline: 'Arajet',
    aircraftRegistration: 'HI1024',
    aircraftType: 'B737 MAX 8',
    assignedAgent: 'Juan Pérez',
    releaseInMinutes: 18,
  },
  B32: {
    status: 'occupied',
    flightId: 8,
    flightNumber: 'WG654',
    airline: 'Sunwing',
    aircraftRegistration: 'C-654WG',
    aircraftType: 'A321neo',
    assignedAgent: 'M. Castillo',
    combinedConfiguration: '32-Bravo',
    linkedPositionId: 'B33',
  },
  B33: {
    status: 'disabled',
    combinedConfiguration: '32-Bravo',
    linkedPositionId: 'B32',
  },
  BN8: {
    status: 'occupied',
    flightId: 7,
    flightNumber: 'CM345',
    airline: 'Copa Airlines',
    aircraftRegistration: 'HP-345CM',
    aircraftType: 'B737 MAX 8',
    assignedAgent: 'K. Objío',
  },
};

function buildPosition(coords, overrides, nowIso) {
  const { releaseInMinutes, ...rest } = overrides;
  return {
    id: coords.id,
    terminal: coords.terminal,
    latitude: coords.lat,
    longitude: coords.lon,
    status: 'available',
    flightId: null,
    flightNumber: null,
    airline: null,
    aircraftRegistration: null,
    aircraftType: null,
    assignedAgent: null,
    estimatedReleaseTime: releaseInMinutes
      ? new Date(Date.now() + releaseInMinutes * 60000).toISOString()
      : null,
    updatedAt: nowIso,
    combinedConfiguration: null,
    linkedPositionId: null,
    ...rest,
  };
}

export async function getPositionsSnapshot(stationCode = 'PUJ') {
  if (import.meta.env.MODE !== 'test') {
    const stationScope = readSession()?.stationScopes?.find(scope => scope.stationCode === stationCode);
    if (!stationScope?.stationId) throw new Error('Tu cuenta no tiene acceso a esta estación.');
    const snapshot = await getPlanningSnapshot({ stationId: stationScope.stationId });
    if (snapshot.station?.id !== stationScope.stationId ||
        snapshot.station?.code !== stationCode) {
      throw new Error('La respuesta no coincide con la estación seleccionada.');
    }
    if (stationCode !== 'PUJ') {
      const plannedByStand = new Map();
      for (const turnaround of snapshot.turnarounds) {
        if (!turnaround.stand?.code) continue;
        const code = turnaround.stand.code;
        const flights = [turnaround.arrival?.flightNumber,
          turnaround.departure?.flightNumber].filter(Boolean);
        const existing = plannedByStand.get(code);
        if (existing) {
          existing.plannedFlights.push(...flights);
        } else {
          plannedByStand.set(code, {
            id: code, terminal: turnaround.stand.terminal?.code ?? null,
            status: 'planned', latitude: null, longitude: null,
            plannedFlights: flights,
          });
        }
      }
      return {
        station: { code: stationCode, name: snapshot.station.name },
        source: 'planning-no-map',
        positions: [...plannedByStand.values()],
      };
    }
    const plannedByStand = new Map(snapshot.turnarounds
      .filter(turnaround => turnaround.stand?.code)
      .map(turnaround => [turnaround.stand.code.toUpperCase(), turnaround]));
    const nowIso = new Date().toISOString();
    return {
      station: { code: snapshot.station.code, localAbbr: 'AST' },
      source: 'planning',
      positions: RAMP_POSITIONS.map(coords => {
        const planned = plannedByStand.get(coords.id);
        return {
          id: coords.id, terminal: coords.terminal,
          latitude: coords.lat, longitude: coords.lon,
          status: planned ? 'planned' : 'unverified',
          flightId: planned?.arrival?.id ?? planned?.departure?.id ?? null,
          flightNumber: planned?.arrival?.flightNumber ?? planned?.departure?.flightNumber ?? null,
          airline: planned?.airline?.name ?? null,
          aircraftRegistration: planned?.aircraft?.registration ?? null,
          aircraftType: planned?.aircraft?.model ?? null,
          assignedAgent: planned?.agents?.[0]?.displayName ?? null,
          estimatedReleaseTime: null,
          updatedAt: nowIso,
          combinedConfiguration: null,
          linkedPositionId: null,
        };
      }),
    };
  }
  const nowIso = new Date().toISOString();
  return {
    station: { code: stationCode, localAbbr: 'AST' },
    positions: RAMP_POSITIONS.map(coords => buildPosition(coords, INITIAL_OVERRIDES[coords.id] ?? {}, nowIso)),
  };
}

export async function getPositionById(id) {
  const snapshot = await getPositionsSnapshot();
  const position = snapshot.positions.find(item => item.id === id);
  if (!position) throw new Error(`No existe la posición ${id}`);
  return position;
}

export async function getPositionStatus(id) {
  const position = await getPositionById(id);
  return { id: position.id, status: position.status, updatedAt: position.updatedAt };
}

// --- Simulación de push en vivo (REST-ready hoy, WebSocket/polling-ready mañana) ---
// Tras unos ciclos, activa una NUEVA configuración combinada (29-Bravo: B29 bloquea B30) para que
// el toast de inhabilitación tenga un evento real que reportar durante la sesión — el frontend
// solo reacciona a este cambio de datos, nunca inventa la relación.
const ACTIVATION_TICK = 2;
const UPDATE_INTERVAL_MS = 6000;

export function subscribeToPositionUpdates(onUpdate, stationCode = 'PUJ',
  { onSnapshot, onError } = {}) {
  if (import.meta.env.MODE !== 'test') {
    const intervalId = setInterval(() => {
      getPositionsSnapshot(stationCode)
        .then(snapshot => {
          if (onSnapshot) onSnapshot(snapshot);
          else snapshot.positions.forEach(onUpdate);
        })
        .catch(error => onError?.(error));
    }, 30000);
    return () => clearInterval(intervalId);
  }
  let tickCount = 0;
  let activated = false;

  const intervalId = setInterval(() => {
    tickCount += 1;
    const nowIso = new Date().toISOString();

    if (!activated && tickCount >= ACTIVATION_TICK) {
      activated = true;
      onUpdate({
        id: 'B29',
        status: 'occupied',
        flightId: 10,
        flightNumber: 'AA100',
        airline: 'American Airlines',
        aircraftRegistration: 'N100AA',
        aircraftType: 'A321neo',
        assignedAgent: 'J. Ramírez',
        combinedConfiguration: '29-Bravo',
        linkedPositionId: 'B30',
        updatedAt: nowIso,
      });
      onUpdate({
        id: 'B30',
        status: 'disabled',
        combinedConfiguration: '29-Bravo',
        linkedPositionId: 'B29',
        updatedAt: nowIso,
      });
      return;
    }

    // Heartbeat: refresca updatedAt de las posiciones ocupadas para simular sincronización
    // periódica con el backend, sin inventar cambios de estado adicionales.
    onUpdate({ heartbeatAt: nowIso });
  }, UPDATE_INTERVAL_MS);

  return () => clearInterval(intervalId);
}
