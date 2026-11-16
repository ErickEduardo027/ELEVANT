import { useMemo } from 'react';
import { useAuth } from '../auth/AuthContext';

// El espacio OCC opera solo Punta Cana. La estación no se elige: se toma el
// alcance PUJ que la sesión ya trae del servidor. Si la cuenta no tiene PUJ,
// la lista queda vacía y cada módulo muestra su estado sin estación
// autorizada; la autorización real sigue en la API.
export const OCC_STATION_CODE = 'PUJ';
export const OCC_STATION_NAME = 'Punta Cana International Airport';

export function selectOccStationScopes(stationScopes) {
  return (Array.isArray(stationScopes) ? stationScopes : [])
    .filter(scope => scope?.stationId && scope?.stationCode === OCC_STATION_CODE)
    .slice(0, 1);
}

export function useOccStation() {
  const { session } = useAuth();
  const stationScopes = useMemo(() => selectOccStationScopes(session?.stationScopes),
    [session?.stationScopes]);
  const scope = stationScopes[0];
  return {
    status: scope ? 'ready' : 'unavailable',
    stationScopes,
    stationId: scope?.stationId ?? '',
    stationCode: OCC_STATION_CODE,
    stationName: OCC_STATION_NAME,
  };
}
