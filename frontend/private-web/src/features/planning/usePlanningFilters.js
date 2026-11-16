import { useEffect, useMemo, useState } from 'react';
import { hasEstimatedDelay, isPendingAssignment } from './planningMappers';

const INITIAL_FILTERS = {
  airlineIata: '',
  status: '',
  aircraftType: '',
  position: '',
  terminal: '',
  agent: '',
  search: '',
};

const SUPPORTED_QUICK_FILTERS = new Set(['delayed', 'unassigned']);
const SUPPORTED_FILTERS = new Set(Object.keys(INITIAL_FILTERS));

function normalize(value) {
  return typeof value === 'string' ? value.toLocaleLowerCase() : '';
}

function assignedAgentNames(flight) {
  return flight.assignedAgents?.map(agent => agent.displayName) ?? flight.agents ?? [];
}

function searchableValues(flight) {
  const arrival = flight.arrival;
  const departure = flight.departure;

  return [
    flight.operationCode,
    flight.flightNumber,
    flight.airline?.iataCode,
    flight.airline?.icaoCode,
    flight.airline?.name,
    flight.airlineIata,
    flight.airlineName,
    flight.aircraft?.icaoCode,
    flight.aircraft?.iataCode,
    flight.aircraft?.manufacturer,
    flight.aircraft?.model,
    flight.aircraft?.registration,
    flight.aircraftType,
    flight.stand?.code,
    flight.position,
    flight.terminal?.code,
    flight.terminal?.name,
    flight.terminalCode,
    arrival?.flightNumber,
    arrival?.origin?.iataCode,
    arrival?.origin?.icaoCode,
    arrival?.origin?.name,
    arrival?.destination?.iataCode,
    arrival?.destination?.icaoCode,
    arrival?.destination?.name,
    departure?.flightNumber,
    departure?.origin?.iataCode,
    departure?.origin?.icaoCode,
    departure?.origin?.name,
    departure?.destination?.iataCode,
    departure?.destination?.icaoCode,
    departure?.destination?.name,
    flight.origin,
    flight.destination,
    ...assignedAgentNames(flight),
    ...(flight.assignedAgents ?? []).flatMap(agent => [agent.employeeNumber, agent.positionCode, agent.positionName]),
    ...(flight.assignedEquipment ?? []).flatMap(equipment => [
      equipment.assetCode,
      equipment.equipmentTypeCode,
      equipment.equipmentTypeName,
    ]),
    ...(flight.assignedServices ?? []).flatMap(service => [service.code, service.name]),
  ];
}

function matchesFilters(flight, filters) {
  if (filters.airlineIata && (flight.airline?.iataCode ?? flight.airlineIata) !== filters.airlineIata) return false;
  if (filters.status && flight.status !== filters.status) return false;
  if (filters.aircraftType && (flight.aircraft?.icaoCode ?? flight.aircraftType) !== filters.aircraftType) return false;
  if (filters.position && (flight.stand?.code ?? flight.position) !== filters.position) return false;
  if (filters.terminal && (flight.terminal?.code ?? flight.terminalCode) !== filters.terminal) return false;
  if (filters.agent && !assignedAgentNames(flight).includes(filters.agent)) return false;
  if (filters.search) {
    const needle = normalize(filters.search).trim();
    const haystack = searchableValues(flight).map(normalize).join(' ');
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

function matchesQuickFilter(flight, quickFilter) {
  switch (quickFilter) {
    case 'delayed':
      return hasEstimatedDelay(flight);
    case 'unassigned':
      return isPendingAssignment(flight);
    default:
      return true;
  }
}

export function usePlanningFilters(flights, scopeKey = '') {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [quickFilter, setQuickFilterState] = useState('none');

  function setFilter(key, value) {
    if (!SUPPORTED_FILTERS.has(key)) return;
    setFilters(current => ({ ...current, [key]: value }));
  }

  function setQuickFilter(name) {
    if (!SUPPORTED_QUICK_FILTERS.has(name)) {
      setQuickFilterState('none');
      return;
    }
    setQuickFilterState(current => (current === name ? 'none' : name));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
    setQuickFilterState('none');
  }

  useEffect(() => {
    setFilters(INITIAL_FILTERS);
    setQuickFilterState('none');
  }, [scopeKey]);

  const filteredFlights = useMemo(
    () => flights.filter(flight => matchesFilters(flight, filters) && matchesQuickFilter(flight, quickFilter)),
    [flights, filters, quickFilter]
  );

  return { filters, setFilter, quickFilter, setQuickFilter, resetFilters, filteredFlights };
}
