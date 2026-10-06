import { useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ReviewPage from './ReviewPage';
import { useReviewData } from './useReviewData';
import { useAdminOccPreview } from '../admin-occ/AdminOccPreviewContext';

// El `focusOperationId` que el `AppShell` original guardaba en estado local al
// navegar desde Notificaciones/Monitoreo ahora se expresa como query param
// `?operationId=`, enlazable y persistente a un refresh (mismo patrón que
// FlightMonitoringRoute).
export default function ReviewRoute() {
  const [retryToken, setRetryToken] = useState(0);
  const [searchParams] = useSearchParams();
  const { forceState } = useAdminOccPreview();
  const review = useReviewData('PUJ', retryToken);

  return (
    <ReviewPage
      status={review.status}
      data={review.data}
      error={review.error}
      onRetry={() => setRetryToken(token => token + 1)}
      onApprove={review.approveOperation}
      onReturn={review.returnOperation}
      onBulkApprove={review.bulkApprove}
      onBulkReturn={review.bulkReturn}
      forceState={forceState}
      focusOperationId={searchParams.get('operationId') ?? undefined}
    />
  );
}
