import { useMemo, useState } from 'react';
import { extractDateFromIso, isStationRelated, matchesChip } from './flightMonitoringMappers';

const INITIAL_FILTERS = { date: '', airline: '', status: '', origin: '', destination: '', search: '' };

function matchesFilters(flight, filters) {
  if (filters.date && extractDateFromIso(flight.eta ?? flight.etd) !== filters.date) return false;
  if (filters.airline && flight.airline !== filters.airline) return false;
  if (filters.status && flight.status !== filters.status) return false;
  if (filters.origin && flight.origin !== filters.origin) return false;
  if (filters.destination && flight.destination !== filters.destination) return false;
  if (filters.search) {
    const haystack = `${flight.flightNumber} ${flight.airline} ${flight.registration} ${flight.supervisor ?? ''}`.toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }
  return true;
}

export function useFlightMonitoringFilters(flights, stationCode = 'PUJ') {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [activeChip, setActiveChip] = useState('all');
  const [onlyStationRelated, setOnlyStationRelated] = useState(false);

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  const filteredFlights = useMemo(
    () =>
      flights
        .filter(flight => matchesFilters(flight, filters))
        .filter(flight => matchesChip(flight, activeChip))
        .filter(flight => !onlyStationRelated || isStationRelated(flight, stationCode)),
    [flights, filters, activeChip, onlyStationRelated, stationCode]
  );

  return { filters, setFilter, activeChip, setActiveChip, onlyStationRelated, setOnlyStationRelated, filteredFlights };
}
