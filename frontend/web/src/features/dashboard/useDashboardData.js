import { useEffect, useState } from 'react';
import { getDashboardSnapshot } from '../../services/dashboardService';

export function useDashboardData(stationCode = 'PUJ') {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    getDashboardSnapshot(stationCode)
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [stationCode]);

  return state;
}
