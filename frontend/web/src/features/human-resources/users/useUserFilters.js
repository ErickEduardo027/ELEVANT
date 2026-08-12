import { useMemo, useState } from 'react';

const INITIAL_FILTERS = {
  search: '',
  userType: 'all',
  role: 'all',
  portal: 'all',
  status: 'all',
  terminal: 'all',
  airline: 'all',
  department: 'all',
};

function matchesSearch(item, search) {
  if (!search.trim()) return true;
  const haystack = `${item.fullName} ${item.email} ${item.identificationNumber}`.toLowerCase();
  return haystack.includes(search.trim().toLowerCase());
}

// Filtrado 100% cliente por ahora. Preparado para migrar a búsqueda
// server-side/debounce: bastará con pasar `filters` a
// `usersService.getUsers(filters)` y dejar de filtrar `items` aquí, sin
// cambiar la firma que consume UserFilterBar/UserTable.
export function useUserFilters(items) {
  const [filters, setFilters] = useState(INITIAL_FILTERS);

  const onFilterChange = (key, value) => setFilters(current => ({ ...current, [key]: value }));
  const onResetFilters = () => setFilters(INITIAL_FILTERS);

  const hasActiveFilters = Object.entries(filters).some(([key, value]) =>
    key === 'search' ? value.trim() !== '' : value !== 'all'
  );

  const filteredItems = useMemo(() => {
    return items.filter(item => {
      if (!matchesSearch(item, filters.search)) return false;
      if (filters.userType !== 'all' && item.userType !== filters.userType) return false;
      if (filters.role !== 'all' && item.roleName !== filters.role) return false;
      if (filters.portal !== 'all' && item.portal !== filters.portal) return false;
      if (filters.status !== 'all' && item.status !== filters.status) return false;
      if (filters.terminal !== 'all') {
        const terminals = item.record.rampAgent?.terminals ?? [];
        if (!terminals.includes(filters.terminal)) return false;
      }
      if (filters.airline !== 'all' && item.userType === 'airline_client' && item.stationOrDepartmentLabel !== filters.airline) return false;
      if (filters.department !== 'all' && item.userType !== 'ramp_agent' && item.userType !== 'airline_client' && item.stationOrDepartmentLabel !== filters.department) return false;
      return true;
    });
  }, [items, filters]);

  // Solo se muestran los filtros de faceta que tienen opciones reales en los
  // datos actuales (skill.md §5: "mostrar únicamente los filtros relevantes
  // según los datos disponibles").
  const availableOptions = useMemo(() => {
    const unique = mapper => Array.from(new Set(items.map(mapper).filter(Boolean)));
    return {
      roles: unique(item => item.roleName),
      terminals: Array.from(new Set(items.flatMap(item => item.record.rampAgent?.terminals ?? []))),
      airlines: unique(item => (item.userType === 'airline_client' ? item.stationOrDepartmentLabel : null)),
      departments: unique(item => (item.userType !== 'ramp_agent' && item.userType !== 'airline_client' ? item.stationOrDepartmentLabel : null)),
    };
  }, [items]);

  return { filters, onFilterChange, onResetFilters, hasActiveFilters, filteredItems, availableOptions };
}
