import { useEffect } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useOccStation } from '../admin-occ/useOccStation';
import FlightMonitoringPage from './FlightMonitoringPage';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { useOccScreenRefresh } from '../admin-occ/live/useOccScreenRefresh';

// The screen's flights follow `occ_planning` on the shell's single observer (useOccScreenRefresh: coalesced, joined
// with a read in flight, paused while the tab is hidden, with its 60 s safety poll); it opens no observer of its own.
const MONITORING_RESOURCES = Object.freeze(['occ_planning']);

// A flight linked from Notificaciones or Revisión arrives as `?flightId=` (contracts 2.1): the page reads it from the one
// URL selection (maps/core/useMapSelection.js), linkable and kept across a refresh.
export default function FlightMonitoringRoute() {
  const { session } = useAuth();
  // OCC solo opera PUJ: un `?stationId=` de otra estación no cambia el alcance.
  const { stationScopes } = useOccStation();
  const selected = stationScopes[0];
  const { forceState } = useAdminOccPreview();
  // `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
  // por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext.
  const { theme } = useTheme();
  const { token, refresh, busy } = useOccScreenRefresh({ resources: MONITORING_RESOURCES });
  const monitoring = useFlightMonitoringData(selected?.stationCode ?? '', token,
    forceState === 'monitoringDisconnected', session?.accountId);
  const reading = monitoring.connection === 'syncing';
  // After every render: whether the read the last token started is still running (the in-flight join).
  useEffect(() => { busy(reading); });

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
        onRetry={refresh}
        forceState={forceState}
        theme={theme}
        stationId={selected?.stationId ?? null}
        stationCode={selected?.stationCode ?? null}
      />
    </div>
  );
}
