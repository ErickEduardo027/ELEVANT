import { useMemo, useState } from 'react';
import { sortByStandCode } from '../../services/standCodes';
import { matchesPositionSearch, matchesTerminalFilter } from './positionsMapMappers';

export function usePositionsMapFilters(positions) {
  const [search, setSearch] = useState('');
  const [terminalFilter, setTerminalFilter] = useState('all');

  const filteredPositions = useMemo(
    () =>
      // «Lista de posiciones» in natural order of the stand codes (services/standCodes.js): A1, A2… A10, AN1, B20.
      sortByStandCode(positions
        .filter(position => matchesTerminalFilter(position, terminalFilter))
        .filter(position => matchesPositionSearch(position, search)), position => position.id),
    [positions, terminalFilter, search]
  );

  return { search, setSearch, terminalFilter, setTerminalFilter, filteredPositions };
}
