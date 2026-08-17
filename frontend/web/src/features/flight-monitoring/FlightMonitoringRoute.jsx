import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import FlightMonitoringPage from './FlightMonitoringPage';
import { useFlightMonitoringData } from './useFlightMonitoringData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';

// El `focusFlightId` que el `AppShell` original guardaba en estado local al
// navegar desde Notificaciones/Revisión (`handleNavigateToResource`) ahora se
// expresa como query param `?flightId=`, enlazable y persistente a un refresh.
export default function FlightMonitoringRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const [searchParams] = useSearchParams();
  const { forceState } = useAdminOccPreview();
  // `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
  // por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext.
  const { theme } = useTheme();
  const monitoring = useFlightMonitoringData('PUJ', retryToken, forceState === 'monitoringDisconnected');

  return (
    <FlightMonitoringPage
      status={monitoring.status}
      data={monitoring.data}
      error={monitoring.error}
      connection={monitoring.connection}
      lastUpdatedAt={monitoring.lastUpdatedAt}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
      theme={theme}
      focusFlightId={searchParams.get('flightId') ?? undefined}
      onStatusChange={monitoring.changeFlightStatus}
    />
  );
}
