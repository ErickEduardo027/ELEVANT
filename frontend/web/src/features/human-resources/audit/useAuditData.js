import { useEffect, useState } from 'react';
import { exportAuditLog, getAuditEntries } from '../../../services/humanResourcesAuditService';

export function useAuditData() {
  const [status, setStatus] = useState('loading');
  const [entries, setEntries] = useState([]);
  const [error, setError] = useState(null);
  const [refreshToken, setRefreshToken] = useState(0);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setStatus('loading');
      setError(null);
      try {
        const data = await getAuditEntries();
        if (!mounted) return;
        setEntries(data);
        setStatus('success');
      } catch (loadError) {
        if (!mounted) return;
        setError(loadError);
        setStatus('error');
      }
    }

    load();

    return () => {
      mounted = false;
    };
  }, [refreshToken]);

  function refresh() {
    setRefreshToken(token => token + 1);
  }

  return {
    status,
    entries,
    error,
    refresh,
    exportAuditLog,
  };
}

