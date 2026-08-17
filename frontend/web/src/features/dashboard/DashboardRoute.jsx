import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import DashboardPage from './DashboardPage';
import { useDashboardData } from './useDashboardData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

export default function DashboardRoute() {
  const navigate = useNavigate();
  const [retryToken, setRetryToken] = useState(0);
  const { status, data, error } = useDashboardData('PUJ', retryToken);
  const { forceState } = useAdminOccPreview();

  return (
    <DashboardPage
      status={status}
      data={data}
      error={error}
      onRetry={() => setRetryToken(token => token + 1)}
      forceState={forceState}
      onOpenPositionsMap={() => navigate('/admin-occ/positions-map')}
    />
  );
}
