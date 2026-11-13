'use client';

import { useCallback, useMemo } from 'react';
import { useAppSearchParams } from '../../../hooks/useAppSearchParams';
import { readSelection, writeSelection } from './mapSelection';

/**
 * The URL selection of the OCC screens (contracts 2.1). Every write starts from the current query, touches only the
 * selection keys and replaces the history entry, so selecting on the map never stacks history and never drops
 * stationId, operationId or any other key.
 *
 * Returns `{ selection, view, terminal, follow, focus, selectFlight, selectStand, selectAircraft, clear,
 * setView(view, { terminal }), setFollow, setFocus }`. `clear()` also stops following: there is nothing left to follow.
 */
export function useMapSelection() {
  const [searchParams, setSearchParams] = useAppSearchParams();
  const query = searchParams.toString();
  const state = useMemo(() => readSelection(query), [query]);

  const write = useCallback(patch => {
    setSearchParams(current => writeSelection(current, patch), { replace: true });
  }, [setSearchParams]);

  const selectFlight = useCallback(id => write({ selection: { kind: 'flight', id } }), [write]);
  const selectStand = useCallback(code => write({ selection: { kind: 'stand', id: code } }), [write]);
  const selectAircraft = useCallback(hex => write({ selection: { kind: 'aircraft', id: hex } }), [write]);
  const clear = useCallback(() => write({ selection: null, follow: false }), [write]);
  const setView = useCallback((view, { terminal = null } = {}) => write({ view, terminal }), [write]);
  const setFollow = useCallback(on => write({ follow: on === true }), [write]);
  const setFocus = useCallback(focus => write({ focus }), [write]);

  return useMemo(() => ({
    ...state, selectFlight, selectStand, selectAircraft, clear, setView, setFollow, setFocus,
  }), [state, selectFlight, selectStand, selectAircraft, clear, setView, setFollow, setFocus]);
}
