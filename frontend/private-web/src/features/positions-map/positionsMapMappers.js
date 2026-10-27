import { PUJ_COORDINATES } from '../flight-monitoring/flightMonitoringMappers';
import { createTranslator } from '../../i18n/languageStore';
import { positionsMapMessages } from './positionsMapMessages';

const spanish = createTranslator(positionsMapMessages, 'es');

export { PUJ_COORDINATES };

export const TERMINAL_FILTERS = [
  { id: 'all', label: 'Todas' },
  { id: 'A', label: 'Terminal A' },
  { id: 'B', label: 'Terminal B' },
  { id: 'FBO', label: 'FBO' },
];

export const TERMINAL_LABELS = {
  A: 'Terminal A',
  B: 'Terminal B',
  FBO: 'FBO / Aviación local',
};

export function matchesTerminalFilter(position, terminalFilter) {
  return terminalFilter === 'all' || position.terminal === terminalFilter;
}

export function matchesPositionSearch(position, query) {
  if (!query) return true;
  const haystack = `${position.id} ${position.flightNumber ?? ''} ${position.aircraftRegistration ?? ''}`.toLowerCase();
  return haystack.includes(query.trim().toLowerCase());
}

export function findPositionByQuery(positions, query) {
  const normalized = query.trim().toUpperCase();
  if (!normalized) return null;
  return (
    positions.find(position => position.id === normalized) ??
    positions.find(position => position.flightNumber?.toUpperCase() === normalized) ??
    positions.find(position => position.aircraftRegistration?.toUpperCase() === normalized) ??
    null
  );
}

export function computePositionsSummary(positions) {
  return positions.reduce(
    (summary, position) => {
      summary.total += 1;
      summary[position.status] = (summary[position.status] ?? 0) + 1;
      return summary;
    },
    { total: 0, planned: 0, unverified: 0, available: 0, occupied: 0, disabled: 0, releasing: 0 }
  );
}

// Deriva el texto explicativo de una posición inhabilitada por configuración combinada
// exclusivamente a partir del modelo de datos (combinedConfiguration/linkedPositionId) — nunca
// inventa la relación en el cliente.
export function getCombinedConfigExplanation(position, t = spanish) {
  if (position.status !== 'disabled' || !position.combinedConfiguration) return null;
  return {
    reason: t('combined.reason', { configuration: position.combinedConfiguration }),
    relation: position.linkedPositionId
      ? t('combined.relationLinked', { linked: position.linkedPositionId, position: position.id })
      : t('combined.relation', { position: position.id }),
  };
}

export function buildDisabledToast(position, t = spanish) {
  return {
    title: t('toast.disabledTitle', { position: position.id }),
    description: position.combinedConfiguration
      ? t('combined.reason', { configuration: position.combinedConfiguration })
      : t('toast.disabledFallback'),
  };
}

function plannedTurnaroundSummary(turnaround) {
  return {
    id: turnaround.id,
    operationCode: turnaround.operationCode,
    status: turnaround.status,
    airline: turnaround.airline?.name ?? null,
    arrivalFlight: turnaround.arrival?.flightNumber ?? null,
    departureFlight: turnaround.departure?.flightNumber ?? null,
    agents: (turnaround.agents ?? []).map(agent => agent.displayName).filter(Boolean),
  };
}

// Convierte las escalas planificadas de PUJ en el catálogo de posiciones del
// mapa. Varias escalas pueden compartir posición en el mismo día: todas se
// conservan en `plannedTurnarounds` y los campos sueltos describen la primera,
// por compatibilidad con el detalle existente. `planned` significa asignación
// planificada, nunca ocupación física verificada.
export function mapTurnaroundsToRampPositions(rampPositions, turnarounds = [], nowIso = new Date().toISOString()) {
  const plannedByStand = new Map();
  for (const turnaround of turnarounds) {
    const code = turnaround.stand?.code?.toUpperCase();
    if (!code) continue;
    if (!plannedByStand.has(code)) plannedByStand.set(code, []);
    plannedByStand.get(code).push(turnaround);
  }
  return rampPositions.map(coords => {
    const planned = plannedByStand.get(coords.id) ?? [];
    const first = planned[0];
    return {
      id: coords.id, terminal: coords.terminal,
      latitude: coords.lat, longitude: coords.lon,
      status: first ? 'planned' : 'unverified',
      flightId: first?.arrival?.id ?? first?.departure?.id ?? null,
      flightNumber: first?.arrival?.flightNumber ?? first?.departure?.flightNumber ?? null,
      airline: first?.airline?.name ?? null,
      aircraftRegistration: first?.aircraft?.registration ?? null,
      aircraftType: first?.aircraft?.model ?? null,
      assignedAgent: first?.agents?.[0]?.displayName ?? null,
      plannedTurnarounds: planned.map(plannedTurnaroundSummary),
      estimatedReleaseTime: null,
      updatedAt: nowIso,
      combinedConfiguration: null,
      linkedPositionId: null,
    };
  });
}

/** Stand codes in the database pad the number (A01); the map uses A1. */
export function mapStandCode(code) {
  const match = /^([A-Z]+)0*(\d+)$/.exec(String(code ?? '').toUpperCase());
  return match ? `${match[1]}${match[2]}` : String(code ?? '').toUpperCase();
}

function occupancyTurnaround(item) {
  return {
    id: item.turnaroundId, operationCode: item.operationCode, status: item.status, airline: item.airlineName,
    arrivalFlight: item.arrivalFlightNumber, departureFlight: item.departureFlightNumber,
    aircraftRegistration: item.aircraftRegistration, arrivalScheduledAt: item.arrivalScheduledAt,
    arrivedAt: item.arrivedAt, departureScheduledAt: item.departureScheduledAt, agents: [],
  };
}

// Real occupancy (teacher review, Phase 7): `occupied` means the aircraft arrived and is parked,
// `planned` an assignment whose aircraft has not arrived, `available` a registered free stand and
// `unverified` a map position with no stand registered for the station.
export function mapOccupancyToRampPositions(rampPositions, board, nowIso = new Date().toISOString()) {
  const byCode = new Map((board?.positions ?? []).map(position => [mapStandCode(position.code), position]));
  return rampPositions.map(coords => {
    const stand = byCode.get(coords.id);
    const parked = stand?.turnarounds ?? [];
    const current = parked.find(item => item.arrivedAt) ?? parked[0];
    return {
      id: coords.id, terminal: coords.terminal, latitude: coords.lat, longitude: coords.lon,
      standId: stand?.standId ?? null,
      status: stand ? stand.status : 'unverified',
      // Monitoring is keyed by flight leg, which the occupancy board does not carry.
      flightId: null,
      flightNumber: current?.arrivalFlightNumber ?? current?.departureFlightNumber ?? null,
      airline: current?.airlineName ?? null,
      aircraftRegistration: current?.aircraftRegistration ?? null,
      aircraftType: null,
      assignedAgent: null,
      arrivedAt: current?.arrivedAt ?? null,
      turnarounds: parked,
      plannedTurnarounds: parked.map(occupancyTurnaround),
      estimatedReleaseTime: current?.departureScheduledAt ?? null,
      updatedAt: board?.asOf ?? nowIso,
      combinedConfiguration: null,
      linkedPositionId: null,
    };
  });
}
