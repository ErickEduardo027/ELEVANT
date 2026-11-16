import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOccStation } from '../admin-occ/useOccStation';
import FlightMonitoringPage from './FlightMonitoringPage';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

// A flight linked from Notificaciones or Revisión arrives as `?flightId=` (contracts 2.1): the page reads it from the one
// URL selection (maps/core/useMapSelection.js), linkable and kept across a refresh. The route keeps its own
// account-change observer (OCC_OBSERVER_SITES, `movesIn: 'U5'`): the maps lane's budget test
// (maps/useMapSituation.budget.test.jsx) reads that entry, so moving it onto the frame's channel waits for that lane.
export default function FlightMonitoringRoute() {
  const { session } = useAuth();
  // OCC solo opera PUJ: un `?stationId=` de otra estación no cambia el alcance.
  const { stationScopes } = useOccStation();
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
    // The page fills the height of the OCC frame's content, so its grid and the map in it stay bounded by the screen.
    <div className="h-full">
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
        stationId={selected?.stationId ?? null}
        stationCode={selected?.stationCode ?? null}
      />
    </div>
  );
}
