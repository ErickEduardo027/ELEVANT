import { PUJ_COORDINATES } from '../flight-monitoring/flightMonitoringMappers';

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
    { total: 0, available: 0, occupied: 0, disabled: 0, releasing: 0 }
  );
}

// Deriva el texto explicativo de una posición inhabilitada por configuración combinada
// exclusivamente a partir del modelo de datos (combinedConfiguration/linkedPositionId) — nunca
// inventa la relación en el cliente.
export function getCombinedConfigExplanation(position) {
  if (position.status !== 'disabled' || !position.combinedConfiguration) return null;
  return {
    reason: `Configuración ${position.combinedConfiguration} activa.`,
    relation: position.linkedPositionId
      ? `Esta configuración utiliza ${position.linkedPositionId} y bloquea temporalmente ${position.id}.`
      : `Esta configuración bloquea temporalmente ${position.id}.`,
  };
}

export function buildDisabledToast(position) {
  return {
    title: `Posición ${position.id} inhabilitada`,
    description: position.combinedConfiguration
      ? `Configuración ${position.combinedConfiguration} activa.`
      : 'Posición inhabilitada por configuración combinada.',
  };
}
