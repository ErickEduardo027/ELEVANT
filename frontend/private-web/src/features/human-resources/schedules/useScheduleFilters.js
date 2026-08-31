import { useMemo, useState } from 'react';

const INITIAL_FILTERS = { search: '', terminal: 'all', agentId: 'all' };

function matchesSearch(agent, search) {
  if (!search.trim()) return true;
  const haystack = `${agent.agentName} ${agent.employeeNumber} ${agent.agentId}`.toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

// Filtra las FILAS del calendario (agentes), no los turnos — skill.md
// §"CALENDARIO DE TURNOS": "filtros por terminal, agente y semana" (la
// semana la resuelve useWeekNavigation). 100% cliente, preparado para
// migrar a filtrado server-side sin cambiar la firma que consume
// ShiftCalendar.
export function useScheduleFilters(agents) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const onFilterChange = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const onResetFilters = () => setFilters(INITIAL_FILTERS);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'search') return value.trim() !== '';
    return value !== INITIAL_FILTERS[key];
  });

  const filteredAgents = useMemo(() => {
    return agents.filter(agent => {
      if (!matchesSearch(agent, filters.search)) return false;
      if (filters.terminal !== 'all' && !agent.terminals.includes(filters.terminal)) return false;
      if (filters.agentId !== 'all' && agent.agentId !== filters.agentId) return false;
      return true;
    });
  }, [agents, filters]);

  return { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredAgents };
}
