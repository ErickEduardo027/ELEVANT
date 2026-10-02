import { useEffect, useMemo, useState } from 'react';
import PlanningPage from './PlanningPage';
import { usePlanningData } from './usePlanningData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useAuth } from '../auth/AuthContext';
import { createPrivateWebAccountChangeObserver } from '../../services/accountChangeObserver';

export default function PlanningRoute() {
  const { session } = useAuth();
  const stationScopes = useMemo(
    () => (Array.isArray(session?.stationScopes) ? session.stationScopes : [])
      .filter(scope => scope?.stationId && scope?.stationCode),
    [session?.stationScopes]
  );
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [requestedDate, setRequestedDate] = useState('');
  const [resolvedScope, setResolvedScope] = useState({ stationId: '', date: '' });
  const [retryToken, setRetryToken] = useState(0);
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
  }, []);
  const planning = usePlanningData({
    stationId: stationId || undefined,
    date: requestedDate || undefined,
    refreshToken: retryToken,
    enabled: stationScopes.length > 0,
  });
  const { forceState } = useAdminOccPreview();
  const responseDate = planning.data?.station?.id === stationId ? planning.data.date : '';
  const resolvedDate = resolvedScope.stationId === stationId ? resolvedScope.date : '';
  const effectiveDate = requestedDate || responseDate || resolvedDate;

  useEffect(() => {
    if (!responseDate) return;
    setResolvedScope({ stationId, date: responseDate });
  }, [responseDate, stationId]);

  useEffect(() => {
    if (stationScopes.some(scope => scope.stationId === stationId)) return;
    setStationId(stationScopes[0]?.stationId ?? '');
    setRequestedDate('');
    setResolvedScope({ stationId: '', date: '' });
  }, [stationId, stationScopes]);

  function selectStation(nextStationId) {
    setStationId(nextStationId);
    setRequestedDate('');
    setResolvedScope({ stationId: '', date: '' });
  }

  function selectDate(nextDate) {
    setRequestedDate(nextDate);
    if (!nextDate) setResolvedScope({ stationId: '', date: '' });
  }

  return (
    <PlanningPage
      status={planning.status}
      data={planning.data}
      error={planning.error}
      onRetry={() => setRetryToken(token => token + 1)}
      stationScopes={stationScopes}
      selectedStationId={stationId}
      onStationChange={selectStation}
      selectedDate={effectiveDate}
      onDateChange={selectDate}
      filterScopeKey={`${stationId}|${effectiveDate}`}
      hasStationScope={stationScopes.length > 0}
      forceState={forceState}
      dataRevision={retryToken}
    />
  );
}
