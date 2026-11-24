import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth/AuthContext';
import { useOccStation } from '../admin-occ/useOccStation';
import PositionsMapPage from './PositionsMapPage';
import { usePositionsMapData } from './usePositionsMapData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';
import { useOccScreenRefresh } from '../admin-occ/live/useOccScreenRefresh';
import { aviationReferenceService } from '../../services/aviationReferenceService';
import AircraftRegistryFacts from '../aviation-reference/AircraftRegistryFacts';
import { AviationReferenceProvider } from '../aviation-reference/AviationReferenceContext';

// `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
// por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext
// (mismo criterio que FlightMonitoringRoute).
// Las posiciones siguen `occ_planning` en el único observador del marco (useOccScreenRefresh: agrupado, unido a la
// lectura en curso, en pausa con la pestaña oculta, con su sondeo de seguridad de 60 s); no abre observador propio.
const POSITIONS_RESOURCES = Object.freeze(['occ_planning']);

export default function PositionsMapRoute() {
  const { session } = useAuth();
  const { stationScopes } = useOccStation();
  const selected = stationScopes[0];
  const { forceState } = useAdminOccPreview();
  const { theme } = useTheme();
  const { token, refresh, busy } = useOccScreenRefresh({ resources: POSITIONS_RESOURCES });
  const positionsMap = usePositionsMapData(selected?.stationCode ?? '', token,
    forceState === 'positionsMapDisconnected', session?.accountId);
  const reading = positionsMap.connection === 'syncing';
  // Tras cada render: si la lectura que pidió el último token sigue en curso (la unión con la lectura en vuelo).
  useEffect(() => { busy(reading); });
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
          onRetry={refresh}
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
