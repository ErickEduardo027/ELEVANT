import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import PositionsMapPage from './PositionsMapPage';
import { usePositionsMapData } from './usePositionsMapData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useTheme } from '../shell/useTheme';

// `theme` es de alcance de la app (shell), no de la vista previa de Admin/OCC,
// por eso se resuelve aquí vía el hook compartido en vez de AdminOccPreviewContext
// (mismo criterio que FlightMonitoringRoute).
export default function PositionsMapRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const { forceState } = useAdminOccPreview();
  const { theme } = useTheme();
  const positionsMap = usePositionsMapData('PUJ', retryToken, forceState === 'positionsMapDisconnected');
  const navigate = useNavigate();

  return (
    <PositionsMapPage
      status={positionsMap.status}
      data={positionsMap.data}
      error={positionsMap.error}
      connection={positionsMap.connection}
      lastUpdatedAt={positionsMap.lastUpdatedAt}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
      theme={theme}
      onNavigateToResource={(moduleId, resourceId) => {
        if (moduleId === 'flight-monitoring') {
          navigate(`/admin-occ/flight-monitoring?flightId=${resourceId}`);
        }
      }}
    />
  );
}
