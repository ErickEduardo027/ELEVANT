import { useEffect, useState } from 'react';
import { getFinanceHomeSnapshot } from '../../../services/financeHomeService';

export function useFinanceHomeData(refreshToken = 0) {
  const [state, setState] = useState({ status: 'loading', data: null, error: null });

  useEffect(() => {
    let cancelled = false;
    setState({ status: 'loading', data: null, error: null });

    getFinanceHomeSnapshot()
      .then(data => {
        if (!cancelled) setState({ status: 'success', data, error: null });
      })
      .catch(error => {
        if (!cancelled) setState({ status: 'error', data: null, error });
      });

    return () => {
      cancelled = true;
    };
  }, [refreshToken]);

  return state;
}
