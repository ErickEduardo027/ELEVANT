import { useEffect, useState } from 'react';
import { getPlanningSnapshot } from '../../services/planningService';

export function usePlanningData(stationCode = 'PUJ', dateISO, refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    getPlanningSnapshot(stationCode, dateISO)
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode, dateISO, refreshToken]);

  return state;
}
