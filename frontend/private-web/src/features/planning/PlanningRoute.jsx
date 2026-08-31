import { useState } from 'react';
import PlanningPage from './PlanningPage';
import { usePlanningData } from './usePlanningData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function PlanningRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const planning = usePlanningData('PUJ', undefined, retryToken);
  const { forceState } = useAdminOccPreview();

  return (
    <PlanningPage
      status={planning.status}
      data={planning.data}
      error={planning.error}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
    />
  );
}
