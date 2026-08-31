import { useMemo, useState } from 'react';
import { extractDateFromIso, isPendingAssignment } from './planningMappers';

const INITIAL_FILTERS = {
  date: '',
  airportCode: '',
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  supervisor: '',
  agent: '',
  search: '',
};

function matchesFilters(flight, filters) {
  if (filters.date && extractDateFromIso(flight.scheduledTime) !== filters.date) return false;
  if (filters.airportCode && flight.station !== filters.airportCode) return false;
  if (filters.airlineIata && flight.airlineIata !== filters.airlineIata) return false;
  if (filters.status && flight.status !== filters.status) return false;
  if (filters.aircraftType && flight.aircraftType !== filters.aircraftType) return false;
  if (filters.position && flight.position !== filters.position) return false;
  if (filters.supervisor && flight.supervisor !== filters.supervisor) return false;
  if (filters.agent && !flight.agents.includes(filters.agent)) return false;
  if (filters.search) {
    const haystack = `${flight.flightNumber} ${flight.airlineName} ${flight.origin} ${flight.destination}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

function matchesQuickFilter(flight, quickFilter) {
  switch (quickFilter) {
    case 'tomorrow':
      return false;
    case 'delayed':
      return flight.status === 'delayed';
    case 'unassigned':
      return isPendingAssignment(flight);
    case 'pending':
      return flight.status === 'scheduled';
    default:
      return true;
  }
}

export function usePlanningFilters(flights) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [quickFilter, setQuickFilterState] = useState('none');

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function setQuickFilter(name) {
    setQuickFilterState(current => (current === name ? 'none' : name));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setQuickFilterState('none');
  }

  const filteredFlights = useMemo(
    () => flights.filter(flight => matchesFilters(flight, filters) && matchesQuickFilter(flight, quickFilter)),
    [flights, filters, quickFilter]
  );

  return { filters, setFilter, quickFilter, setQuickFilter, resetFilters, filteredFlights };
}
