import { useEffect, useMemo, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import FlightMonitoringPage from './FlightMonitoringPage';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

// El `focusFlightId` que el `AppShell` original guardaba en estado local al
// navegar desde Notificaciones/Revisión (`handleNavigateToResource`) ahora se
// expresa como query param `?flightId=`, enlazable y persistente a un refresh.
export default function FlightMonitoringRoute() {
  const { session } = useAuth();
  const stationScopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode),
  [session?.stationScopes]);
  const [searchParams, setSearchParams] = useSearchParams();
  const [stationId, setStationId] = useState(() => {
    const requested = searchParams.get('stationId');
    return stationScopes.some(scope => scope.stationId === requested)
      ? requested : stationScopes[0]?.stationId ?? '';
  });
  const selected = stationScopes.find(scope => scope.stationId === stationId);
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  // `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
  // por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext.
  const { theme } = useTheme();
  const monitoring = useFlightMonitoringData(selected?.stationCode ?? '', retryToken,
    forceState === 'monitoringDisconnected', session?.accountId);

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

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  return (
    <div className="space-y-3">
      {stationScopes.length > 0 && <label className="block w-fit text-xs font-semibold">
        Estación de monitoreo
        <select aria-label="Estación de monitoreo" value={selected?.stationId ?? ''}
          onChange={event => {
            const nextId = event.target.value;
            setStationId(nextId);
            setSearchParams(current => {
              const next = new URLSearchParams(current);
              next.set('stationId', nextId);
              next.delete('flightId');
              return next;
            });
          }}
          className="ml-2 rounded-lg border border-black/10 bg-white px-3 py-2 text-sm dark:bg-surface-dark-card">
          {stationScopes.map(scope => <option key={scope.stationId} value={scope.stationId}>
            {scope.stationCode}</option>)}
        </select>
      </label>}
      <FlightMonitoringPage
        key={`${session?.accountId ?? 'none'}|${selected?.stationId ?? 'none'}`}
        status={monitoring.status}
        data={monitoring.data}
        error={monitoring.error}
        connection={monitoring.connection}
        lastUpdatedAt={monitoring.lastUpdatedAt}
        onRetry={() => setRetryToken(token => token + 1)}
        forceState={forceState}
        theme={theme}
        focusFlightId={searchParams.get('flightId') ?? undefined}
      />
    </div>
  );
}
