import { useMemo, useState } from 'react';

// `onlyUrgent` inicia en `true` (skill.md §"TABLA": 'opción "Solo
// vencidos/próximos" activa inicialmente').
const INITIAL_FILTERS = { search: '', terminal: 'all', status: 'all', document: 'all', onlyUrgent: true };

function matchesSearch(agent, search) {
  if (!search.trim()) return true;
  const haystack = `${agent.agentName} ${agent.employeeNumber} ${agent.agentId}`.toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

// El filtro de documento acota SOBRE QUÉ documento se evalúan el filtro de
// estado y el toggle "solo vencidos/próximos" — no oculta agentes por sí
// solo, ya que todo agente administra ambos documentos.
function relevantDocuments(agent, document) {
  if (document === 'carnet') return [agent.carnet].filter(Boolean);
  if (document === 'licencia') return [agent.licencia].filter(Boolean);
  return [agent.carnet, agent.licencia].filter(Boolean);
}

// Filtrado 100% cliente sobre los resúmenes por agente (skill.md
// §"TABLA"). El orden por urgencia ya llega aplicado desde
// sortAgentPermitsByUrgency (useAirportPermitsData); este hook solo lo
// preserva. Preparado para migrar a filtrado server-side sin cambiar la
// firma que consumen PermitFilters/AgentPermitsTable.
export function usePermitFilters(agentSummaries) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const onFilterChange = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const onResetFilters = () => setFilters(INITIAL_FILTERS);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) => {
    if (key === 'search') return value.trim() !== '';
    return value !== INITIAL_FILTERS[key];
  });

  const filteredItems = useMemo(() => {
    return agentSummaries.filter(agent => {
      if (!matchesSearch(agent, filters.search)) return false;
      if (filters.terminal !== 'all' && !agent.terminals.includes(filters.terminal)) return false;

      const documents = relevantDocuments(agent, filters.document);
      if (filters.status !== 'all' && !documents.some(item => item.status === filters.status)) return false;
      if (filters.onlyUrgent && !documents.some(item => item.status !== 'current')) return false;

      return true;
    });
  }, [agentSummaries, filters]);

  return { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems };
}
