import { useCallback, useEffect, useState } from 'react';
import { getHumanResourcesDashboardSnapshot } from '../../../services/humanResourcesDashboardService';

// Mismo patrón que useDashboardData en feat/adminocc: estado
// status/data/error derivado de una promesa, con un token para forzar
// recarga (botón "Actualizar") y la marca de última actualización exitosa.
export function useHumanResourcesDashboardData() {
  const [refreshToken, setRefreshToken] = useState(0);
  const [state, setState] = useState({ status: 'loading', data: null, error: null, lastUpdatedAt: null });

  useEffect(() => {
    let cancelled = false;
    setState(current => ({ ...current, status: 'loading', error: null }));

    getHumanResourcesDashboardSnapshot()
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null, lastUpdatedAt: new Date() });
      })
      .catch(error => {
        if (!cancelled) setState(current => ({ ...current, status: 'error', error }));
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  const refresh = useCallback(() => setRefreshToken(token => token + 1), []);

  return { ...state, refresh };
}
