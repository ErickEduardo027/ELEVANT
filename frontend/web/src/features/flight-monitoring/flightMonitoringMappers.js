export const PUJ_COORDINATES = { latitude: 18.5674, longitude: -68.3634 };

export function isStationRelated(flight, stationCode = 'PUJ') {
  return flight.origin === stationCode || flight.destination === stationCode;
}

export function extractDateFromIso(iso) {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

export const FLIGHT_FILTER_CHIPS = [
  { id: 'all', label: 'Todos' },
  { id: 'scheduled', label: 'Programados' },
  { id: 'enRoute', label: 'En ruta' },
  { id: 'delayed', label: 'Retrasados' },
  { id: 'landed', label: 'Aterrizados' },
  { id: 'cancelled', label: 'Cancelados' },
  { id: 'diverted', label: 'Desviados' },
];

const CHIP_STATUS_GROUPS = {
  scheduled: ['scheduled'],
  enRoute: ['enRoute', 'approaching', 'taxiing', 'leftGate', 'taxiingToGate'],
  delayed: ['delayed'],
  landed: ['landed', 'arrived'],
  cancelled: ['cancelled'],
  diverted: ['diverted'],
};

export function matchesChip(flight, chipId) {
  if (chipId === 'all') return true;
  const statuses = CHIP_STATUS_GROUPS[chipId];
  return statuses ? statuses.includes(flight.status) : true;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getFilterOptions(flights) {
  return {
    dates: uniqueSorted(flights.map(flight => extractDateFromIso(flight.eta))),
    airlines: uniqueSorted(flights.map(flight => flight.airline)),
    statuses: uniqueSorted(flights.map(flight => flight.status)),
    origins: uniqueSorted(flights.map(flight => flight.origin)),
    destinations: uniqueSorted(flights.map(flight => flight.destination)),
  };
}

export function formatRemaining(etaIso, nowIso) {
  const diffMinutes = Math.round((new Date(etaIso).getTime() - new Date(nowIso).getTime()) / 60000);
  if (diffMinutes === 0) return 'Ahora';
  if (diffMinutes > 0) return `En ${diffMinutes} min`;
  return `Hace ${Math.abs(diffMinutes)} min`;
}
