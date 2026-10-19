import { useEffect, useState } from 'react';
import { useAppSearchParams as useSearchParams } from '../../hooks/useAppSearchParams';
import { useAuth } from '../auth/AuthContext';
import { useOccStation } from '../admin-occ/useOccStation';
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
  // OCC solo opera PUJ: un `?stationId=` de otra estación no cambia el alcance.
  const { stationScopes } = useOccStation();
  const [searchParams] = useSearchParams();
  const selected = stationScopes[0];
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

  return (
    <div className="space-y-3">
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
