import { getPlanningSnapshot } from './planningService';
import { loadOccReviewQueue } from './occReviewService';
import { loadOperationalNotifications } from './operationalCommunicationService';

export async function getDashboardSnapshot({ stationId, stationCode, date }, { signal } = {}) {
  if (!stationId || !stationCode || !/^\d{4}-\d{2}-\d{2}$/.test(date ?? '')) {
    throw new TypeError('El panorama operativo requiere estación y fecha.');
  }

  const [planning, review, notices] = await Promise.all([
    getPlanningSnapshot({ stationId, date, signal }),
    loadOccReviewQueue(stationId, { signal }),
    loadOperationalNotifications({ signal }),
  ]);
  if (planning.station?.id !== stationId || planning.station?.code !== stationCode ||
      planning.date !== date || review.stationId !== stationId ||
      review.stationCode !== stationCode) {
    throw new Error('El panorama operativo no coincide con la estación solicitada.');
  }

  return {
    stationId, stationCode, date,
    turnarounds: planning.turnarounds,
    reviews: review.operations,
    reviewHasMore: review.hasMore,
    notifications: notices.notifications
      .filter(notification => notification.stationCode === stationCode),
    notificationsHasMore: notices.hasMore,
  };
}
