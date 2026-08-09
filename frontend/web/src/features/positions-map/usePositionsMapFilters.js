import { useMemo, useState } from 'react';
import { matchesPositionSearch, matchesTerminalFilter } from './positionsMapMappers';

export function usePositionsMapFilters(positions) {
  const [search, setSearch] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('all');

  const filteredPositions = useMemo(
    () =>
      positions
        .filter(position => matchesTerminalFilter(position, terminalFilter))
        .filter(position => matchesPositionSearch(position, search)),
    [positions, terminalFilter, search]
  );

  return { search, setSearch, terminalFilter, setTerminalFilter, filteredPositions };
}
