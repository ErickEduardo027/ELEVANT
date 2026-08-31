export function isPendingAssignment(flight) {
  return !flight.position || !flight.agents || flight.agents.length === 0;
}

export function computeKpis(flights) {
  const occupiedPositions = new Set(flights.filter(flight => flight.position).map(flight => flight.position));
  return {
    flightsToday: flights.length,
    pendingAssignment: flights.filter(isPendingAssignment).length,
    positionsOccupied: occupiedPositions.size,
    conflicts: flights.filter(flight => flight.conflict !== null).length,
  };
}

export function extractDateFromIso(iso) {
  const match = iso.match(/^(\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : '';
}

function hourLabel(iso) {
  const match = iso.match(/T(\d{2}):/);
  return match ? `${match[1]}:00` : '';
}

export function groupFlightsByHour(flights) {
  const sorted = [...flights].sort((a, b) => a.scheduledTime.localeCompare(b.scheduledTime));
  const groups = [];

  for (const flight of sorted) {
    const label = hourLabel(flight.scheduledTime);
    const currentGroup = groups[groups.length - 1];
    if (currentGroup && currentGroup.hourLabel === label) {
      currentGroup.flights.push(flight);
    } else {
      groups.push({ hourLabel: label, flights: [flight] });
    }
  }

  return groups;
}

export function formatCountdown(scheduledIso, nowIso) {
  const diffMinutes = Math.round((new Date(scheduledIso).getTime() - new Date(nowIso).getTime()) / 60000);
  if (diffMinutes === 0) return 'Ahora';
  if (diffMinutes > 0) return `En ${diffMinutes} min`;
  return `Hace ${Math.abs(diffMinutes)} min`;
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort();
}

export function getFilterOptions(flights) {
  return {
    dates: uniqueSorted(flights.map(flight => extractDateFromIso(flight.scheduledTime))),
    airports: uniqueSorted(flights.map(flight => flight.station)),
    airlines: uniqueSorted(flights.map(flight => flight.airlineIata)),
    statuses: uniqueSorted(flights.map(flight => flight.status)),
    aircraftTypes: uniqueSorted(flights.map(flight => flight.aircraftType)),
    positions: uniqueSorted(flights.map(flight => flight.position)),
    supervisors: uniqueSorted(flights.map(flight => flight.supervisor)),
    agents: uniqueSorted(flights.flatMap(flight => flight.agents)),
  };
}
