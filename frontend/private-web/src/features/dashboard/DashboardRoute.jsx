import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '../auth/AuthContext';
import DashboardPage from './DashboardPage';
import { useDashboardData } from './useDashboardData';

export default function DashboardRoute() {
  const router = useRouter();
  const { session } = useAuth();
  const stationScopes = useMemo(() => (session?.stationScopes ?? [])
    .filter(scope => scope?.stationId && scope?.stationCode),
  [session?.stationScopes]);
  const [stationId, setStationId] = useState(stationScopes[0]?.stationId ?? '');
  const [retryToken, setRetryToken] = useState(0);
  const selected = stationScopes.find(scope => scope.stationId === stationId);
  const dashboard = useDashboardData({
    accountId: session?.accountId,
    stationId: selected?.stationId ?? '',
    stationCode: selected?.stationCode ?? '',
    refreshToken: retryToken,
  });

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
  }, [stationId, stationScopes]);

  return <DashboardPage
    status={dashboard.status}
    data={dashboard.data}
    stationScopes={stationScopes}
    selectedStationId={selected?.stationId ?? ''}
    onStationChange={setStationId}
    onRetry={() => setRetryToken(value => value + 1)}
    onOpenPlanning={() => router.push('/admin-occ/planning')}
    onOpenReview={() => router.push('/admin-occ/review')}
    onOpenNotifications={() => router.push('/admin-occ/notifications')}
  />;
}
