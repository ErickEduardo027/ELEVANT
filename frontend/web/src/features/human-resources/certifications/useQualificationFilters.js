import { useMemo, useState } from 'react';

const INITIAL_FILTERS = { search: '', terminal: 'all', status: 'all', equipment: 'all' };

const SORTERS = {
  agentName: (a, b) => a.agentName.localeCompare(b.agentName, 'es'),
  terminal: (a, b) => (a.terminals[0] ?? '').localeCompare(b.terminals[0] ?? ''),
  activeCount: (a, b) => b.activeCount - a.activeCount,
  nextExpirationAt: (a, b) => new Date(a.nextExpirationAt ?? 0) - new Date(b.nextExpirationAt ?? 0),
  expiredCount: (a, b) => b.expiredCount - a.expiredCount,
  updatedAt: (a, b) => new Date(b.updatedAt ?? 0) - new Date(a.updatedAt ?? 0),
};

export const AGENT_SORT_OPTIONS = [
  { value: 'default', label: 'Orden predeterminado' },
  { value: 'agentName', label: 'Agente' },
  { value: 'terminal', label: 'Terminal' },
  { value: 'activeCount', label: 'Habilitaciones vigentes' },
  { value: 'nextExpirationAt', label: 'Próximo vencimiento' },
  { value: 'expiredCount', label: 'Cantidad de vencidas' },
  { value: 'updatedAt', label: 'Última actualización' },
];

function matchesSearch(agent, search) {
  if (!search.trim()) return true;
  const haystack = `${agent.agentName} ${agent.employeeNumber} ${agent.agentId}`.toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

// Filtrado y ordenamiento 100% cliente sobre los resúmenes por agente
// (skill.md §"FILTROS"/"ORDENAMIENTO"). El orden predeterminado
// (vencidos → próximos → vigentes) ya llega aplicado desde
// sortAgentSummariesByDefault; este hook solo lo preserva salvo que el
// usuario elija una columna explícita. Preparado para migrar a
// filtrado/orden server-side sin cambiar la firma que consumen
// QualificationFilters/AgentQualificationsTable.
export function useQualificationFilters(agentSummaries) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);
  const [sortBy, setSortBy] = useState('default');

  const onFilterChange = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const onResetFilters = () => setFilters(INITIAL_FILTERS);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => (key === 'search' ? value.trim() !== '' : value !== 'all'));

  const filteredItems = useMemo(() => {
    const matching = agentSummaries.filter(agent => {
      if (!matchesSearch(agent, filters.search)) return false;
      if (filters.terminal !== 'all' && !agent.terminals.includes(filters.terminal)) return false;
      if (filters.status !== 'all' && !agent.qualifications.some(item => item.status === filters.status)) return false;
      if (filters.equipment !== 'all' && !agent.qualifications.some(item => item.equipmentId === filters.equipment)) return false;
      return true;
    });

    if (sortBy === 'default') return matching;
    return [...matching].sort(SORTERS[sortBy]);
  }, [agentSummaries, filters, sortBy]);

  return { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems, sortBy, onSortChange: setSortBy };
}
