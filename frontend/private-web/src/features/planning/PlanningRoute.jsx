import { useEffect, useState } from 'react';
import PlanningPage from './PlanningPage';
import { usePlanningData } from './usePlanningData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';
import { useOccStation } from '../admin-occ/useOccStation';
import { useOccScreenRefresh } from '../admin-occ/live/useOccScreenRefresh';

// The planning follows `occ_planning` on the shell's single observer (useOccScreenRefresh: coalesced, joined with a read
// in flight, paused while the tab is hidden, with its 60 s safety poll); it opens no observer of its own. Each re-read
// also re-reads what the page reads on `dataRevision` (the readiness marks, the open drawer, the map's stands).
const PLANNING_RESOURCES = Object.freeze(['occ_planning']);

export default function PlanningRoute() {
  const { stationScopes } = useOccStation();
  const [stationId, setStationId] = useState(() => stationScopes[0]?.stationId ?? '');
  const [requestedDate, setRequestedDate] = useState('');
  const [resolvedScope, setResolvedScope] = useState({ stationId: '', date: '' });
  const { token: retryToken, refresh, busy } = useOccScreenRefresh({ resources: PLANNING_RESOURCES,
    enabled: stationScopes.length > 0 });
  const planning = usePlanningData({
    stationId: stationId || undefined,
    date: requestedDate || undefined,
    refreshToken: retryToken,
    enabled: stationScopes.length > 0,
  });
  const reading = planning.status === 'loading' || planning.refreshing === true;
  // After every render: whether the read the last token started is still running (the in-flight join).
  useEffect(() => { busy(reading); });
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

  function selectDate(nextDate) {
    setRequestedDate(nextDate);
    if (!nextDate) setResolvedScope({ stationId: '', date: '' });
  }

  return (
    <PlanningPage
      status={planning.status}
      data={planning.data}
      error={planning.error}
      onRetry={refresh}
      stationScopes={stationScopes}
      selectedStationId={stationId}
      selectedDate={effectiveDate}
      onDateChange={selectDate}
      filterScopeKey={`${stationId}|${effectiveDate}`}
      hasStationScope={stationScopes.length > 0}
      forceState={forceState}
      dataRevision={retryToken}
    />
  );
}
