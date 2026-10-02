import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import PositionsMapPage from './PositionsMapPage';
import { usePositionsMapData } from './usePositionsMapData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

// `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
// por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext
// (mismo criterio que FlightMonitoringRoute).
export default function PositionsMapRoute() {
  const { session } = useAuth();
  const stationScopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode),
  [session?.stationScopes]);
  const [stationId, setStationId] = useState(stationScopes[0]?.stationId ?? '');
  const selected = stationScopes.find(scope => scope.stationId === stationId);
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const { theme } = useTheme();
  const positionsMap = usePositionsMapData(selected?.stationCode ?? '', retryToken,
    forceState === 'positionsMapDisconnected', session?.accountId);

  useEffect(() => {
    const refresh = () => setRetryToken(token => token + 1);
    const observer = createPrivateWebAccountChangeObserver(resources => {
      if (resources.includes('occ_planning')) refresh();
    });
    void observer.start().catch(() => {});
    window.addEventListener('focus', refresh);
    window.addEventListener('online', refresh);
    const poll = window.setInterval(() => {
      if (document.visibilityState === 'visible') refresh();
    }, 25_000);
    return () => {
      window.clearInterval(poll);
      window.removeEventListener('focus', refresh);
      window.removeEventListener('online', refresh);
      void observer.stop();
    };
  }, [session?.accountId]);
  const navigate = useNavigate();

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  return (
    <div className="space-y-3">
      {stationScopes.length > 0 && <label className="block w-fit text-xs font-semibold">
        Estación de posiciones
        <select aria-label="Estación de posiciones" value={selected?.stationId ?? ''}
          onChange={event => setStationId(event.target.value)}
          className="ml-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>}
      <PositionsMapPage
        key={`${session?.accountId ?? 'none'}|${selected?.stationId ?? 'none'}`}
        status={positionsMap.status}
        data={positionsMap.data}
        error={positionsMap.error}
        connection={positionsMap.connection}
        lastUpdatedAt={positionsMap.lastUpdatedAt}
        onRetry={() => setRetryToken(token => token + 1)}
        forceState={forceState}
        theme={theme}
        onNavigateToResource={(moduleId, resourceId) => {
          if (moduleId === 'flight-monitoring' && selected?.stationId) {
            const query = new URLSearchParams({ stationId: selected.stationId,
              flightId: String(resourceId) });
            navigate(`/admin-occ/flight-monitoring?${query}`);
          }
        }}
      />
    </div>
  );
}
