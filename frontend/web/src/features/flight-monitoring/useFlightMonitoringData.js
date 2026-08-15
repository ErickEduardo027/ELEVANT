import { useEffect, useState } from 'react';
import { getFlightMonitoringSnapshot, subscribeToFlightUpdates, updateFlightStatus } from '../../services/flightMonitoringService';

function mergeUpdate(flights, update) {
  return flights.map(flight => (flight.id === update.id ? { ...flight, ...update } : flight));
}

export function useFlightMonitoringData(stationCode = 'PUJ', refreshToken = 0, forceDisconnected = false) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });
  const [connection, setConnection] = useState('syncing');
  const [lastUpdatedAt, setLastUpdatedAt] = useState(null);

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });
    setConnection('syncing');

    getFlightMonitoringSnapshot(stationCode)
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
    // Matches the design spec: forcing a "disconnected" preview state stops the simulated
    // update feed until reconnected, instead of merely relabeling the connection banner.
    if (state.status !== 'success' || forceDisconnected) return undefined;

    const unsubscribe = subscribeToFlightUpdates(update => {
      setState(current =>
        current.data
          ? { ...current, data: { ...current.data, flights: mergeUpdate(current.data.flights, update) } }
          : current
      );
      setLastUpdatedAt(new Date().toISOString());
    });

    return unsubscribe;
  }, [state.status, forceDisconnected]);

  async function changeFlightStatus(flightId, status) {
    const updated = await updateFlightStatus(flightId, status);
    setState(current => current.data
      ? { ...current, data: { ...current.data, flights: mergeUpdate(current.data.flights, updated) } }
      : current);
    setLastUpdatedAt(new Date().toISOString());
    return updated;
  }

  return { status: state.status, data: state.data, error: state.error, connection, lastUpdatedAt, changeFlightStatus };
}
