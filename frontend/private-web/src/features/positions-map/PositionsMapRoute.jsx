import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth/AuthContext';
import { useOccStation } from '../admin-occ/useOccStation';
import PositionsMapPage from './PositionsMapPage';
import { usePositionsMapData } from './usePositionsMapData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';
import { aviationReferenceService } from '../../services/aviationReferenceService';
import AircraftRegistryFacts from '../aviation-reference/AircraftRegistryFacts';
import { AviationReferenceProvider } from '../aviation-reference/AviationReferenceContext';

// `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
// por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext
// (mismo criterio que FlightMonitoringRoute).
export default function PositionsMapRoute() {
  const { session } = useAuth();
  const { stationScopes } = useOccStation();
  const selected = stationScopes[0];
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
  const router = useRouter();

  return (
    // AeroDataBox (ADR-0028, note of 15 November 2026): the parked or arriving aircraft of a stand, on demand.
    <AviationReferenceProvider service={aviationReferenceService}>
      {/* The page fills the height of the OCC frame's content, so its grid and the map in it stay bounded by the screen. */}
      <div className="h-full">
        <PositionsMapPage
          aircraftFacts={aircraft => (aircraft?.isDemo || !aircraft?.registration ? null
            : <AircraftRegistryFacts stationId={selected?.stationId} registration={aircraft.registration} />)}
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
              router.push(`/admin-occ/flight-monitoring?${query}`);
            }
          }}
        />
      </div>
    </AviationReferenceProvider>
  );
}
