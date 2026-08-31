import { useEffect, useState } from 'react';
import { getPositionsSnapshot, subscribeToPositionUpdates } from '../../services/positionsMapService';

function mergeUpdate(positions, update) {
  if (!update.id) return positions; // heartbeat-only update: no position field changed
  return positions.map(position => (position.id === update.id ? { ...position, ...update } : position));
}

export function usePositionsMapData(stationCode = 'PUJ', refreshToken = 0, forceDisconnected = false) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [connection, setConnection] = useState('syncing');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    setConnection('syncing');

    getPositionsSnapshot(stationCode)
      .then(data => {
        if (cancelled) return;
        setState({ status: 'success', data, error: null });
        setConnection('connected');
        setLastUpdatedAt(new Date().toISOString());
      })
      .catch(error => {
        if (cancelled) return;
        setState({ status: 'error', data: null, error });
        setConnection('disconnected');
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, refreshToken]);

  useEffect(() => {
    if (state.status !== 'success' || forceDisconnected) return undefined;

    const unsubscribe = subscribeToPositionUpdates(update => {
      setState(current =>
        current.data
          ? { ...current, data: { ...current.data, positions: mergeUpdate(current.data.positions, update) } }
          : current
      );
      setLastUpdatedAt(new Date().toISOString());
    });

    return unsubscribe;
  }, [state.status, forceDisconnected]);

  return { status: state.status, data: state.data, error: state.error, connection, lastUpdatedAt };
}
