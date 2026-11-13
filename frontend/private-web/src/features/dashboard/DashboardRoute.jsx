import { useEffect, useState } from 'react';
import { useAuth } from '../auth/AuthContext';
import { useTheme } from '../shell/useTheme';
import { useOccBoot } from '../admin-occ/boot/occBootContext';
import { useOccStation } from '../admin-occ/useOccStation';
import DashboardPage from './DashboardPage';
import { useDashboardData } from './useDashboardData';
import { useMdpcWeather } from '../weather/useMdpcWeather';
import { useRegionalTraffic } from './useRegionalTraffic';

export default function DashboardRoute() {
  const { session } = useAuth();
  const { theme } = useTheme();
  const station = useOccStation();
  const [retryToken, setRetryToken] = useState(0);
  const dashboard = useDashboardData({
    accountId: session?.accountId,
    stationId: station.stationId,
    stationCode: station.stationId ? station.stationCode : '',
    refreshToken: retryToken,
  });
  // La meteorología solo se consulta cuando la cuenta tiene el alcance PUJ.
  const weather = useMdpcWeather({ enabled: station.status === 'ready' });
  const traffic = useRegionalTraffic({ stationId: station.stationId, enabled: station.status === 'ready' });
  const retry = () => setRetryToken(value => value + 1);
  const pageStatus = station.status === 'unavailable' ? 'unavailable' : dashboard.status;
  // The OCC boot screen leaves once the console shows its first data, or a state that needs the user (contratos 2.6).
  const { markReady } = useOccBoot();
  useEffect(() => { if (pageStatus !== 'loading') markReady('console'); }, [markReady, pageStatus]);

  return <DashboardPage
    status={pageStatus}
    data={dashboard.data}
    refreshing={dashboard.refreshing}
    refreshFailed={dashboard.refreshFailed}
    fetchedAt={dashboard.fetchedAt}
    theme={theme}
    weather={weather}
    traffic={traffic}
    onRetry={retry}
  />;
}
