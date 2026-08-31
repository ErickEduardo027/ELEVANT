import { useMemo, useState } from 'react';
import { REPORT_TABS, resolveDateRange } from './reportsMappers';

const INITIAL_FACETS = { airline: '', agent: '', terminal: '', position: '' };

export function useReportFilters() {
  const [activeReport, setActiveReport] = useState(REPORT_TABS[0].id);
  const [datePreset, setDatePreset] = useState('today');
  const [customRange, setCustomRange] = useState({ from: '', to: '' });
  const [facets, setFacets] = useState(INITIAL_FACETS);

  function setFacet(key, value) {
    setFacets(current => ({ ...current, [key]: value }));
  }

  function setCustomDate(key, value) {
    setDatePreset('custom');
    setCustomRange(current => ({ ...current, [key]: value }));
  }

  function resetFilters() {
    setDatePreset('today');
    setCustomRange({ from: '', to: '' });
    setFacets(INITIAL_FACETS);
  }

  const dateRange = useMemo(
    () => resolveDateRange(datePreset, customRange.from, customRange.to),
    [datePreset, customRange]
  );

  const resolvedFilters = useMemo(
    () => ({
      dateFrom: dateRange.from,
      dateTo: dateRange.to,
      airline: facets.airline,
      agent: facets.agent,
      terminal: facets.terminal,
      position: facets.position,
    }),
    [dateRange, facets]
  );

  const hasActiveFilters = useMemo(
    () => datePreset !== 'today' || Object.values(facets).some(value => value !== ''),
    [datePreset, facets]
  );

  return {
    activeReport,
    setActiveReport,
    datePreset,
    setDatePreset,
    customRange,
    setCustomDate,
    facets,
    setFacet,
    resetFilters,
    dateRange,
    resolvedFilters,
    hasActiveFilters,
  };
}
