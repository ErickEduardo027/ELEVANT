import { useMemo, useState } from 'react';
import { REVIEW_TABS, computeTabCounts, extractDateFromIso, getFilterOptions, getOrderReference } from './reviewMappers';

const INITIAL_FILTERS = {
  airline: '',
  agent: '',
  supervisor: '',
  position: '',
  serviceType: '',
  flightNumber: '',
  orderReference: '',
  dateFrom: '',
  dateTo: '',
  search: '',
};

const STATUS_BY_TAB = REVIEW_TABS.reduce((map, tab) => {
  map[tab.id] = tab.status;
  return map;
}, {});

function matchesFilters(operation, filters) {
  if (filters.airline && operation.flight.airline !== filters.airline) return false;
  if (filters.agent && operation.agent?.name !== filters.agent) return false;
  if (filters.supervisor && operation.supervisor?.name !== filters.supervisor) return false;
  if (filters.position && operation.position !== filters.position) return false;
  if (filters.serviceType && !(operation.services ?? []).some(service => service.name === filters.serviceType)) return false;
  if (filters.flightNumber && !operation.flight.number.toLowerCase().includes(filters.flightNumber.toLowerCase())) return false;
  if (filters.orderReference && !getOrderReference(operation).toLowerCase().includes(filters.orderReference.toLowerCase())) {
    return false;
  }

  const operationDate = extractDateFromIso(operation.schedule?.sta);
  if (filters.dateFrom && operationDate && operationDate < filters.dateFrom) return false;
  if (filters.dateTo && operationDate && operationDate > filters.dateTo) return false;

  if (filters.search) {
    const haystack = [
      operation.flight.number,
      operation.flight.airline,
      operation.agent?.name,
      operation.supervisor?.name,
      operation.position,
      getOrderReference(operation),
    ]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    if (!haystack.includes(filters.search.toLowerCase())) return false;
  }

  return true;
}

export function useReviewFilters(operations) {
  const [activeTab, setActiveTab] = useState('pending');
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  function setFilter(key, value) {
    setFilters(current => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setFilters(INITIAL_FILTERS);
  }

  const tabCounts = useMemo(() => computeTabCounts(operations), [operations]);
  const options = useMemo(() => getFilterOptions(operations), [operations]);

  const filteredOperations = useMemo(() => {
    const statusForTab = STATUS_BY_TAB[activeTab];
    return operations.filter(operation => operation.status === statusForTab && matchesFilters(operation, filters));
  }, [operations, activeTab, filters]);

  const hasActiveFilters = useMemo(() => Object.values(filters).some(value => value !== ''), [filters]);

  return {
    activeTab,
    setActiveTab,
    filters,
    setFilter,
    resetFilters,
    hasActiveFilters,
    options,
    tabCounts,
    filteredOperations,
  };
}
