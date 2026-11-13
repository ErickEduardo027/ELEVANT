import { useEffect, useState } from 'react';
import { getPositionsSnapshot, subscribeToPositionUpdates } from '../../services/positionsMapService';

function mergeUpdate(positions, update) {
  if (!update.id) return positions; // heartbeat-only update: no position field changed
  return positions.map(position => (position.id === update.id ? { ...position, ...update } : position));
}

export function usePositionsMapData(stationCode = 'PUJ', refreshToken = 0,
  forceDisconnected = false, accountId = null) {
  const scopeKey = `${accountId ?? ''}|${stationCode ?? ''}`;
  const [state, setState] = useState({ status: 'loading', data: null, error: null, scopeKey });
  const [connection, setConnection] = useState('syncing');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    if (!stationCode) {
      setState({ status: 'error', data: null,
        error: new Error('No hay una estación OCC autorizada.'), scopeKey });
      return undefined;
    }
    // A re-read of the station on screen (focus, the visible poll, occ_planning) keeps the snapshot on screen while it
    // is in flight, so the page does not fall back to its skeleton and re-mount the map. The first read and a change
    // of station or account start empty.
    setState(current => (current.scopeKey === scopeKey && current.status === 'success' && current.data
      ? current
      : { status: 'loading', data: null, error: null, scopeKey }));
    setConnection('syncing');

    getPositionsSnapshot(stationCode)
      .then(data => {
        if (cancelled) return;
        if (data.station?.code !== stationCode) {
          throw new Error('La respuesta no coincide con la estación seleccionada.');
        }
        setState({ status: 'success', data, error: null, scopeKey });
        setConnection('connected');
        setLastUpdatedAt(new Date().toISOString());
      })
      .catch(error => {
        if (cancelled) return;
        setState({ status: 'error', data: null, error, scopeKey });
        setConnection('disconnected');
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, refreshToken, scopeKey]);

  useEffect(() => {
    if (!stationCode || forceDisconnected) return undefined;
    let stopped = false;

    const unsubscribe = subscribeToPositionUpdates(update => {
      if (stopped) return;
      setState(current =>
        current.scopeKey === scopeKey && current.data
          ? { ...current, data: { ...current.data, positions: mergeUpdate(current.data.positions, update) } }
          : current
      );
      setLastUpdatedAt(new Date().toISOString());
    }, stationCode, {
      onSnapshot: snapshot => {
        if (stopped) return;
        if (snapshot.station?.code !== stationCode) {
          setState({ status: 'error', data: null,
            error: new Error('La respuesta no coincide con la estación seleccionada.'), scopeKey });
          setConnection('disconnected');
          return;
        }
        setState({ status: 'success', data: snapshot, error: null, scopeKey });
        setConnection('connected');
        setLastUpdatedAt(new Date().toISOString());
      },
      onError: error => {
        if (stopped) return;
        setState({ status: 'error', data: null, error, scopeKey });
        setConnection('disconnected');
        setLastUpdatedAt(null);
      },
    });

    return () => {
      stopped = true;
      unsubscribe();
    };
  }, [scopeKey, stationCode, forceDisconnected]);

  return state.scopeKey === scopeKey
    ? { status: state.status, data: state.data, error: state.error, connection, lastUpdatedAt }
    : { status: 'loading', data: null, error: null, connection: 'syncing', lastUpdatedAt: null };
}
